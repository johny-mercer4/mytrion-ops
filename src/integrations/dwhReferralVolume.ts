/**
 * Referral-bonus fuel volume, read from the DWH mart. Read-only.
 *
 * One query answers all four bonus logics for a set of carriers in a given window:
 *   · `gallons`            — In Station eligible gallons IN the day window (gallons_legacy)
 *   · `swipes`             — cards whose FIRST eligible fuel lands in that window (swipes_legacy)
 *   · `cumulativeGallons`  — In Station gallons from the beginning of time THROUGH the window end
 *                            (the one-time gallons_parent / gallons_child thresholds)
 *
 * NEW SWIPES (Billing 2026-08, Al Aziz REF-000322): a swipe is a card's first ULSD/ULSR fuel, once.
 * The peak-to-date-of-monthly-counts rule paid $0 for July when Logixpress 5804841 used 16 cards
 * after a May/June peak of 17. Billing's July figure is 8, which is the first-use count across the
 * parent fleet (AL AZIZ EXPRESS INC 5789458 = 6) plus the referred child deal (Logixpress = 2).
 * Station type does not apply to swipes — In Station (`is_in_network`) filters gallons only.
 *
 *   swipes(window) = count of distinct cards whose min(eligible transaction_date) is inside the window
 *
 * This is the Sales dashboard's `new_cards_*` idea, scoped to the bonus fuel-code set. It is not
 * `count(distinct transaction_id)` and not "cards used this month".
 *
 * GALLONS (Legacy) — YILKI REF-000197: July ULSD/ULSR on the three child deal carriers is 25,140.39
 * unfiltered and 24,917.89 with `is_in_network is true` (Billing 24,916, rounding). Parent-owned
 * fleet gallons are not added; gallons stay on related Deal carriers only.
 *
 * First-use needs every prior eligible row so min(date) is lifetime, so the eligible CTE has no
 * lower date bound — only `transaction_date < window_end + 1 day`. A day-level window clips gallons
 * and that window's first-use count; earlier first-use dates stay visible so a July-new card is not
 * mistaken for a card that first fueled in May.
 *
 * Fuel filtering is by `line_item_category`, per the calculation PDF. Note ~23% of mart rows carry a
 * NULL category and are therefore excluded by every bonus type; that is the PDF's rule, and it is
 * why these figures legitimately differ from the Sales dashboard, which applies no fuel filter.
 */
import { dwhQuery } from './dwh.js';

/** Per-carrier volume for one month, for one fuel-code set. */
export interface ReferralCarrierVolume {
  carrierId: number;
  /** In Station eligible gallons inside the period window. */
  gallons: number;
  /** First-use cards whose first eligible fuel lands inside the period window. */
  swipes: number;
  /** In Station eligible gallons from the start of time through the window end. */
  cumulativeGallons: number;
}

export interface ReferralVolumeSet {
  /** Caller-owned stable key, normally the sorted eligible fuel-code list. */
  key: string;
  fuelCodes: readonly string[];
}

/** Inclusive YYYY-MM-DD clip for one period month. Omit to use the full calendar month. */
export interface ReferralVolumeWindow {
  from: string;
  to: string;
}

function lastDayOfMonth(periodMonth: string): string {
  const year = Number(periodMonth.slice(0, 4));
  const month = Number(periodMonth.slice(5, 7));
  const date = new Date(Date.UTC(year, month, 0));
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${periodMonth.slice(0, 7)}-${day}`;
}

interface VolumeRow {
  carrier_id: number | string;
  gallons: number | string | null;
  cumulative_gallons: number | string | null;
  swipes: number | string | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

function volumeFromRow(
  carrierId: number,
  gallons: unknown,
  cumulativeGallons: unknown,
  swipes: unknown,
): ReferralCarrierVolume {
  return {
    carrierId,
    gallons: num(gallons as number | string | null | undefined),
    swipes: Math.max(0, Math.trunc(num(swipes as number | string | null | undefined))),
    cumulativeGallons: num(cumulativeGallons as number | string | null | undefined),
  };
}

/**
 * Volume for every given carrier in `periodMonth` (a 'YYYY-MM-01' date string).
 *
 * Carriers and fuel codes are BOUND, never interpolated — the fuel list comes from a constant today,
 * but binding keeps it safe if it ever becomes configurable. Carriers with no eligible transactions
 * are simply absent from the result; callers treat a miss as zero.
 */
export async function fetchReferralVolume(
  carrierIds: readonly number[],
  periodMonth: string,
  fuelCodes: readonly string[],
): Promise<Map<number, ReferralCarrierVolume>> {
  const out = new Map<number, ReferralCarrierVolume>();
  if (carrierIds.length === 0 || fuelCodes.length === 0) return out;

  const rows = await dwhQuery<VolumeRow>(
    `
    with eligible as (
      select carrier_id,
             card_number,
             transaction_date,
             is_in_network is true as in_station,
             coalesce(line_item_fuel_quantity, 0)::numeric as gal
        from octane.mart_transaction_line_items
       where carrier_id = any($1::bigint[])
         and upper(trim(line_item_category)) = any($2::text[])
         -- No lower bound: first-use needs the card's lifetime min date, and cumulative gallons
         -- need lifetime In Station volume. Only the period END is closed so a backfill cannot
         -- count fuel that had not happened yet when the month closed.
         and transaction_date < ($3::date + interval '1 month')
    ),
    first_use as (
      select carrier_id, card_number, min(transaction_date) as first_dt
        from eligible
       where card_number is not null
       group by 1, 2
    )
    select e.carrier_id,
           coalesce(sum(e.gal) filter (
             where e.transaction_date >= $3::date
               and e.in_station
           ), 0) as gallons,
           coalesce(sum(e.gal) filter (where e.in_station), 0) as cumulative_gallons,
           coalesce((
             select count(*)::int
               from first_use f
              where f.carrier_id = e.carrier_id
                and f.first_dt >= $3::date
                and f.first_dt < ($3::date + interval '1 month')
           ), 0) as swipes
      from eligible e
     group by e.carrier_id
    `,
    [carrierIds, fuelCodes.map((c) => c.toUpperCase()), periodMonth],
  );

  for (const r of rows) {
    const id = Number(r.carrier_id);
    if (!Number.isFinite(id)) continue;
    out.set(id, volumeFromRow(id, r.gallons, r.cumulative_gallons, r.swipes));
  }
  return out;
}

/**
 * Calculate several referral fuel-code sets in ONE MART scan.
 *
 * Referrals has two economic code sets today (ULSD+ULSR and ULSD+ULSR+DSL). Running one historical
 * query per set scanned the same large MART range twice and made the first workspace load needlessly
 * slow. The generated SQL contains only numeric aliases/placeholders; carrier ids and every code
 * remain bound parameters.
 */
export async function fetchReferralVolumeSets(
  carrierIds: readonly number[],
  periodMonth: string,
  sets: readonly ReferralVolumeSet[],
  window?: ReferralVolumeWindow,
): Promise<Map<string, Map<number, ReferralCarrierVolume>>> {
  const result = new Map<string, Map<number, ReferralCarrierVolume>>(
    sets.map((set) => [set.key, new Map()]),
  );
  if (carrierIds.length === 0 || sets.length === 0) return result;

  const normalizedSets = sets.map((set) => ({
    key: set.key,
    fuelCodes: [...new Set(set.fuelCodes.map((code) => code.trim().toUpperCase()).filter(Boolean))],
  }));
  const allCodes = [...new Set(normalizedSets.flatMap((set) => set.fuelCodes))];
  if (allCodes.length === 0) return result;

  const windowFrom = window?.from ?? periodMonth;
  const windowTo = window?.to ?? lastDayOfMonth(periodMonth);
  // $1 carriers, $2 window start, $3 window end. periodMonth only defaults the window in JS —
  // binding it unused made Postgres reject the query ("could not determine data type of parameter $2").
  const params: unknown[] = [carrierIds, windowFrom, windowTo];
  const firstUseCtes: string[] = [];
  const expressions: string[] = [];
  normalizedSets.forEach((set, index) => {
    params.push(set.fuelCodes);
    const codeBind = `$${params.length}::text[]`;
    firstUseCtes.push(
      `first_use_${index} as (
         select carrier_id, card_number, min(transaction_date) as first_dt
           from eligible
          where fuel_code = any(${codeBind})
            and card_number is not null
          group by 1, 2
       )`,
    );
    expressions.push(
      `coalesce(sum(e.gal) filter (
         where e.fuel_code = any(${codeBind})
           and e.transaction_date >= $2::date
           and e.transaction_date < ($3::date + interval '1 day')
           and e.in_station
       ), 0) as gallons_${index}`,
      `coalesce(sum(e.gal) filter (
         where e.fuel_code = any(${codeBind})
           and e.in_station
       ), 0) as cumulative_gallons_${index}`,
      `coalesce((
         select count(*)::int
           from first_use_${index} f
          where f.carrier_id = e.carrier_id
            and f.first_dt >= $2::date
            and f.first_dt < ($3::date + interval '1 day')
       ), 0) as swipes_${index}`,
    );
  });
  params.push(allCodes);
  const allCodesBind = `$${params.length}::text[]`;

  const rows = await dwhQuery<Record<string, unknown>>(
    `with eligible as (
       select carrier_id,
              card_number,
              transaction_date,
              upper(trim(line_item_category)) as fuel_code,
              is_in_network is true as in_station,
              coalesce(line_item_fuel_quantity, 0)::numeric as gal
         from octane.mart_transaction_line_items
        where carrier_id = any($1::bigint[])
          and upper(trim(line_item_category)) = any(${allCodesBind})
          and transaction_date < ($3::date + interval '1 day')
     ),
     ${firstUseCtes.join(',\n     ')}
     select e.carrier_id,
            ${expressions.join(',\n            ')}
       from eligible e
      group by e.carrier_id`,
    params,
  );

  for (const row of rows) {
    const id = Number(row.carrier_id);
    if (!Number.isFinite(id)) continue;
    normalizedSets.forEach((set, index) => {
      result.get(set.key)?.set(
        id,
        volumeFromRow(
          id,
          row[`gallons_${index}`],
          row[`cumulative_gallons_${index}`],
          row[`swipes_${index}`],
        ),
      );
    });
  }
  return result;
}

/**
 * Unique dim_company carrier for each exact company name, or absent when the name is missing or
 * ambiguous. Used only to add a swipe parent's own fleet next to related Deal carriers.
 */
export async function fetchReferralParentCarriers(
  names: readonly string[],
): Promise<Map<string, number>> {
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const out = new Map<string, number>();
  if (unique.length === 0) return out;

  const rows = await dwhQuery<{ company_name: string | null; carrier_id: number | string }>(
    `select company_name, carrier_id
       from octane.dim_company
      where upper(trim(company_name)) = any($1::text[])`,
    [unique.map((name) => name.toUpperCase())],
  );
  const carriersByName = new Map<string, Set<number>>();
  for (const row of rows) {
    const key = (row.company_name ?? '').trim().toUpperCase();
    const id = Number(row.carrier_id);
    if (!key || !Number.isSafeInteger(id) || id <= 0) continue;
    const bucket = carriersByName.get(key) ?? new Set<number>();
    bucket.add(id);
    carriersByName.set(key, bucket);
  }
  for (const name of unique) {
    const bucket = carriersByName.get(name.toUpperCase());
    if (bucket?.size !== 1) continue;
    const carrierId = bucket.values().next().value;
    if (carrierId !== undefined) out.set(name, carrierId);
  }
  return out;
}
