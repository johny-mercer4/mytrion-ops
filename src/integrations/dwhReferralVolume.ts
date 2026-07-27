/**
 * Referral-bonus fuel volume, read from the DWH mart. Read-only.
 *
 * One query answers all four bonus logics for a set of carriers in a given month:
 *   · `gallons`            — eligible gallons IN the month        (gallons_legacy)
 *   · `newCards`           — cards whose FIRST-EVER transaction falls in the month (swipes_legacy)
 *   · `cumulativeGallons`  — eligible gallons from the beginning of time THROUGH the month end
 *                            (the one-time gallons_parent / gallons_child thresholds)
 *
 * "Swipe" is the dashboard's NEW-CARD metric, not a transaction count: a card counts once, in the
 * month it first appears (`min(transaction_date) over (partition by carrier_id, card_number)`).
 * The field literally named `swipes_*` elsewhere is `count(distinct transaction_id)` and is NOT
 * this — see the note on SWIPES_LEGACY in referralBonusTypes.ts.
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
  /** Cards whose first-ever eligible transaction landed inside the period month. */
  newCards: number;
  /** Eligible gallons from the start of time through the END of the period month. */
  cumulativeGallons: number;
}

interface VolumeRow {
  carrier_id: number | string;
  gallons: number | string | null;
  new_cards: number | string | null;
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
    ),
    first_seen as (
      select carrier_id, card_number, min(transaction_date) as first_tx
        from eligible
       where card_number is not null
       group by carrier_id, card_number
    )
    select e.carrier_id,
           coalesce(sum(e.gal) filter (
             where e.transaction_date >= $3::date
           ), 0) as gallons,
           coalesce(sum(e.gal), 0) as cumulative_gallons,
           (
             select count(*)
               from first_seen f
              where f.carrier_id = e.carrier_id
                and f.first_tx >= $3::date
                and f.first_tx < ($3::date + interval '1 month')
           ) as new_cards
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
      newCards: num(r.new_cards),
      cumulativeGallons: num(r.cumulative_gallons),
    });
  }
  return out;
}
