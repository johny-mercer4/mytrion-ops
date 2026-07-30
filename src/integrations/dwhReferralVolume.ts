/**
 * Referral-bonus fuel volume, read from the DWH mart. Read-only.
 *
 * One query answers all four bonus logics for a set of carriers in a given month:
 *   · `gallons`            — eligible gallons IN the month        (gallons_legacy)
 *   · `swipes`             — DISTINCT CARDS that transacted in the month (swipes_legacy)
 *   · `cumulativeGallons`  — eligible gallons from the beginning of time THROUGH the month end
 *                            (the one-time gallons_parent / gallons_child thresholds)
 *
 * THE BONUS PROGRAM DEFINES ITS OWN SWIPE. Per the calculation spec: "a card qualifies as a new swipe
 * in a given month only via its FIRST transaction that month — further transactions on the same card
 * in the same month do not generate additional swipe bonuses." That is exactly one count per card per
 * month, i.e. `count(distinct card_number)` inside the month.
 *
 * It is deliberately NEITHER of the Sales Mytrion dashboard's metrics, and this used to borrow one of
 * them, which under-counted the bonus by roughly 6x:
 *   · the dashboard's `new_cards_*` is a card's FIRST-EVER appearance — a card counts once in its
 *     lifetime, so a card fuelling every month earned the referrer a single $50 ever. That was the old
 *     behaviour here.
 *   · the dashboard's `swipes_*` is `count(distinct transaction_id)` — transactions, which would pay
 *     per fill-up.
 * The dashboard is a separate surface with its own definitions and is not touched by this file.
 *
 * Fuel filtering is by `line_item_category`, per the calculation PDF. Note ~23% of mart rows carry a
 * NULL category and are therefore excluded by every bonus type; that is the PDF's rule, and it is
 * why these figures legitimately differ from the Sales dashboard, which applies no fuel filter.
 */
import { dwhQuery } from './dwh.js';

/** Per-carrier volume for one month, for one fuel-code set. */
export interface ReferralCarrierVolume {
  carrierId: number;
  /** Eligible gallons inside the period month. */
  gallons: number;
  /**
   * Distinct cards that made at least one eligible transaction inside the period month — the program's
   * "unique new swipes". Recurs monthly: a card that fuels in March and again in April is one swipe in
   * each of those months.
   */
  swipes: number;
  /** Eligible gallons from the start of time through the END of the period month. */
  cumulativeGallons: number;
}

interface VolumeRow {
  carrier_id: number | string;
  gallons: number | string | null;
  swipes: number | string | null;
  cumulative_gallons: number | string | null;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

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
             coalesce(line_item_fuel_quantity, 0)::numeric as gal
        from octane.mart_transaction_line_items
       where carrier_id = any($1::bigint[])
         and upper(trim(line_item_category)) = any($2::text[])
         -- Everything is bounded by the period END: the cumulative figure must not count fuel that
         -- had not happened yet when the month closed, or a backfill would award a one-time bonus
         -- in a month the client had not actually reached the threshold.
         and transaction_date < ($3::date + interval '1 month')
    )
    select e.carrier_id,
           coalesce(sum(e.gal) filter (
             where e.transaction_date >= $3::date
           ), 0) as gallons,
           coalesce(sum(e.gal), 0) as cumulative_gallons,
           -- One count per CARD per MONTH: the card's first transaction that month qualifies it, and
           -- further transactions that month add nothing. Cards with no number cannot be a "unique
           -- card", so they are excluded rather than collapsed into one phantom swipe.
           count(distinct e.card_number) filter (
             where e.transaction_date >= $3::date
               and e.card_number is not null
           ) as swipes
      from eligible e
     group by e.carrier_id
    `,
    [carrierIds, fuelCodes.map((c) => c.toUpperCase()), periodMonth],
  );

  for (const r of rows) {
    const id = Number(r.carrier_id);
    if (!Number.isFinite(id)) continue;
    out.set(id, {
      carrierId: id,
      gallons: num(r.gallons),
      swipes: num(r.swipes),
      cumulativeGallons: num(r.cumulative_gallons),
    });
  }
  return out;
}
