/**
 * DWH loyalty stats — per-client (carrier) monthly gallons + active-card counts that back the Sales
 * Mytrion loyalty-tier program (Data Center → Clients). Read-only DWH via `dwhQuery`
 * (octane.mart_transaction_line_items).
 *
 * Semantics that matter:
 * - "Active cards" = `count(distinct card_number)` with >=1 transaction that CALENDAR month — NOT the
 *   all-time `dim_company.total_active_cards` nor the status-based mart `active_cards`.
 * - Gallons = `sum(line_item_fuel_quantity)` (line-item grain, as analytics/service.ts + the dashboard
 *   use; `transaction_fuel_quantity` double-counts across a transaction's line items).
 * - Owner scope: a carrier maps to its CURRENT owning agent via `dim_company` (newest row per carrier),
 *   matched on the LAST 12 DIGITS of the Zoho user id — the session id and the warehouse id share the
 *   record suffix but carry different org prefixes (mirrors `warehouse_gallons.ts`). A verbatim
 *   `= $1::bigint` match risks returning zero rows for every agent.
 * - ZERO-PAD SAFETY (the fix for "0 this-month gallons for every client"): warehouse agent ids are
 *   19 digits, so `right(id, 12)` is a zero-PADDED 12-char string (e.g. `000000676127`). If the app's
 *   session id is shorter, `slice(-12)` yields `676127` (no leading zeros) and a bare `right(...,12) =
 *   $1` matches NOTHING for every agent. Both sides are `lpad(...,12,'0')`-normalized so the leading
 *   zeros can't cause a universal miss. (Confirmed via a read-only DWH probe: July data exists and the
 *   only failure mode was this suffix shape, not a join/lag issue.)
 */
import { dwhQuery } from './dwh.js';

export interface LoyaltyCarrierStats {
  gallonsThisMonth: number;
  activeCardsThisMonth: number;
  transactionsThisMonth: number;
  gallonsPrevMonth: number;
  activeCardsPrevMonth: number;
}

interface LoyaltyRow {
  carrier_id: number | string;
  gallons_this_month: string | number | null;
  active_cards_this_month: string | number | null;
  transactions_this_month: string | number | null;
  gallons_prev_month: string | number | null;
  active_cards_prev_month: string | number | null;
}

/** pg returns sum/count as strings and int4 as number — coerce everything to a finite number. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Last 12 digits of a Zoho id — matches across the DWH org-prefix mismatch (see warehouse_gallons.ts). */
function zohoIdSuffix(id: string): string {
  return id.replace(/\D+/g, '').slice(-12);
}

/**
 * Per-carrier loyalty stats for every carrier CURRENTLY owned by `ownerZohoUserId`, for this and the
 * previous calendar month, keyed by carrier id (string). Returns `{}` when the id has no digits or no
 * rows match. The owner id is validated numeric and bound as `$1` — never string-interpolated.
 */
export async function fetchLoyaltyStatsByAgent(
  ownerZohoUserId: string,
): Promise<Record<string, LoyaltyCarrierStats>> {
  if (!/^\d+$/.test(ownerZohoUserId)) {
    throw new Error(`[dwh-loyalty] invalid owner id: ${ownerZohoUserId.slice(0, 40)}`);
  }
  const suffix = zohoIdSuffix(ownerZohoUserId);
  if (!suffix) return {};

  const rows = await dwhQuery<LoyaltyRow>(
    `select t.carrier_id,
        coalesce(sum(t.line_item_fuel_quantity) filter (
          where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)), 0) as gallons_this_month,
        count(distinct t.card_number) filter (
          where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)) as active_cards_this_month,
        count(distinct t.transaction_id) filter (
          where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)) as transactions_this_month,
        coalesce(sum(t.line_item_fuel_quantity) filter (
          where date_trunc('month', t.transaction_date) = date_trunc('month', current_date - interval '1 month')), 0) as gallons_prev_month,
        count(distinct t.card_number) filter (
          where date_trunc('month', t.transaction_date) = date_trunc('month', current_date - interval '1 month')) as active_cards_prev_month
       from octane.mart_transaction_line_items t
       join (
         select distinct on (carrier_id) carrier_id, agent_zoho_user_id
           from octane.dim_company
          where carrier_id is not null
          order by carrier_id, update_date desc nulls last
       ) c on c.carrier_id = t.carrier_id
      where t.carrier_id is not null
        and lpad(right(c.agent_zoho_user_id::text, 12), 12, '0') = lpad($1, 12, '0')
        and t.transaction_date >= date_trunc('month', current_date - interval '1 month')
      group by t.carrier_id`,
    [suffix],
  );

  const out: Record<string, LoyaltyCarrierStats> = {};
  for (const r of rows) {
    out[String(r.carrier_id)] = {
      gallonsThisMonth: num(r.gallons_this_month),
      activeCardsThisMonth: num(r.active_cards_this_month),
      transactionsThisMonth: num(r.transactions_this_month),
      gallonsPrevMonth: num(r.gallons_prev_month),
      activeCardsPrevMonth: num(r.active_cards_prev_month),
    };
  }
  return out;
}
