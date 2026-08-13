/**
 * MONTH-ANCHORED loyalty roster — the read behind Marketing → Loyalty Program → Export.
 *
 * The board (integrations/dwhClientRoster.ts → `fetchAllClients`) is anchored on the DWH's
 * `current_date`: "previous month" is always the month that just closed. An export has to answer the
 * same question about an arbitrary month, so the windows here are anchored on a BOUND month instead.
 *
 * THE PROGRAM RULE, RESTATED BECAUSE IT IS THE WHOLE POINT OF THIS FILE
 *
 *   Export month M  →  the tier is earned in M-1, and the activity reported is M's own.
 *
 * So for an export of July, June sets the track (transacting cards) and the tier (ULSR + ULSD
 * gallons), and July supplies the gallons/cards/transactions shown next to it. That is not a new
 * rule invented for the export: it is exactly what `_shared/loyalty.ts` scores against, with
 * `current_date` swapped for the caller's month. Two windows, named by their ROLE (`basis_*` = the
 * closed month that earns the tier, `month_*` = the reported month), never by "prev"/"this" — those
 * names are only meaningful relative to today and this query has no today.
 *
 * WINDOWS (all half-open, all against the same single mart scan)
 *   basis   [1st of M-1, 1st of M)                — earns the tier
 *   month   [1st of M,   1st of M+1)              — the reported activity
 *   cycle   [26th of M-1, 26th of M)              — the billing cycle that CLOSES in M (see
 *                                                   lib/salesCycle.ts for why 26→25 is the cycle)
 * The scan therefore only ever needs `[1st of M-1, 1st of M+1)`, which contains the cycle window.
 *
 * WHAT IS DELIBERATELY *NOT* HERE: `dim_company.tier_name` is the carrier's tier as persisted NOW,
 * not the tier it held in some past month, so it is no use as a historical dormant-month fallback
 * and this query does not pretend otherwise — see modules/manager/loyaltyMonthRoster.ts, which
 * forwards it only when the requested month IS the current one.
 *
 * Read-only, one query, no caller-controlled SQL: the month is bound as `$1` and every predicate is
 * a fixed literal. NOT owner-filtered (it reuses `allCarriersCte`), so the route must be
 * marketing-gated.
 */
import { dwhQuery } from './dwh.js';
import { allCarriersCte } from './dwhClientRoster.js';

/** The dim columns the export surfaces. Narrower than the board's — no debt/phone/DOT/money-code. */
const EXPORT_COLS = `carrier_id, company_name, agent, total_active_cards, tier_name, trucks`;

/** One carrier, measured against a caller-chosen month. Field names state the WINDOW'S ROLE. */
export interface LoyaltyMonthClientRow {
  carrierId: string;
  companyName: string;
  /** Current owning agent (`dim_company.agent`) — the dim carries no history, so this is today's. */
  agentName: string;
  /** Declared fleet size — reference only; the track uses closed-month transacting cards. */
  trucks: number | null;
  /** Account-level active cards from the dim (today's figure, not the month's). */
  activeCards: number;
  /** `dim_company.tier_name` as persisted NOW. Only meaningful for the current month. */
  currentStoredTierName: string;
  /** M-1: distinct cards that transacted — the track basis. */
  basisActiveCards: number;
  /** M-1: ULSR + ULSD gallons — the tier's only volume basis. */
  basisInNetworkGallons: number;
  /** M-1: all gallons regardless of fuel category — reference. */
  basisTotalGallons: number;
  /** M-1: distinct transactions — reference, and the audit trail for a zero-gallon basis. */
  basisTransactions: number;
  /** M: distinct cards that transacted. */
  monthActiveCards: number;
  /** M: ULSR + ULSD gallons — progress toward the tier that M earns for M+1. */
  monthInNetworkGallons: number;
  /** M: all gallons regardless of fuel category. */
  monthTotalGallons: number;
  /** M: distinct transactions. */
  monthTransactions: number;
  /** The 26th-of-M-1 → 25th-of-M billing cycle's gallons. */
  cycleGallons: number;
  /** Latest transaction inside the scanned window, ISO date, or null when the carrier was silent. */
  lastTransactionAt: string | null;
}

interface MonthDbRow {
  carrier_id: number | string;
  company_name: string | null;
  agent: string | null;
  total_active_cards: number | string | null;
  tier_name: string | null;
  trucks: number | string | null;
  basis_active_cards: string | number | null;
  basis_in_network_gallons: string | number | null;
  basis_total_gallons: string | number | null;
  basis_transactions: string | number | null;
  month_active_cards: string | number | null;
  month_in_network_gallons: string | number | null;
  month_total_gallons: string | number | null;
  month_transactions: string | number | null;
  cycle_gallons: string | number | null;
  /** Already a `YYYY-MM-DD` day — the query casts it, so no timezone re-reading happens here. */
  last_tx: string | null;
}

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Declared counts only; null stays null. 0 means "unfilled Zoho field", never "zero trucks". */
function intOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? NaN);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Accept only the `YYYY-MM-DD` the query casts to; anything else is dropped rather than guessed. */
function isoDay(v: string | null): string | null {
  return v != null && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

/** The two fuel categories the loyalty program counts as in-network. */
const IN_NETWORK_SQL = `upper(trim(t.line_item_category)) in ('ULSD', 'ULSR')`;

/**
 * `sum(fuel)`/`count(distinct …)` over one named window, as a FILTER clause. Every aggregate below
 * goes through this so the basis and month columns can never drift into different window arithmetic —
 * they are the same expression with a different pair of bounds.
 */
const inWindow = (from: string, to: string): string =>
  `t.transaction_date >= (select ${from} from bounds)
     and t.transaction_date < (select ${to} from bounds)`;

function monthAggregates(prefix: 'basis' | 'month', from: string, to: string): string {
  const w = inWindow(from, to);
  return `coalesce(sum(t.line_item_fuel_quantity) filter (where ${w}), 0) as ${prefix}_total_gallons,
          coalesce(sum(t.line_item_fuel_quantity) filter (
            where ${w} and ${IN_NETWORK_SQL}), 0) as ${prefix}_in_network_gallons,
          count(distinct t.card_number) filter (where ${w}) as ${prefix}_active_cards,
          count(distinct t.transaction_id) filter (where ${w}) as ${prefix}_transactions`;
}

/**
 * Every carrier in the warehouse measured against `monthStartIso` (a `YYYY-MM-01` day).
 *
 * `$1::date` is the ONLY bind; `date_trunc('month', …)` around it means a caller who somehow passes
 * a mid-month day still gets whole-month windows rather than a rolling 30 days.
 */
export async function fetchLoyaltyClientsForMonth(
  monthStartIso: string,
): Promise<LoyaltyMonthClientRow[]> {
  const rows = await dwhQuery<MonthDbRow>(
    `with ${allCarriersCte(EXPORT_COLS)},
     bounds as (
       select date_trunc('month', $1::date)                                   as month_start,
              date_trunc('month', $1::date) + interval '1 month'               as month_end,
              date_trunc('month', $1::date) - interval '1 month'               as basis_start,
              -- The 26th: the 1st plus 25 days. Cycle = 26th of M-1 through the 25th of M.
              date_trunc('month', $1::date) - interval '1 month' + interval '25 days'
                                                                              as cycle_start,
              date_trunc('month', $1::date) + interval '25 days'               as cycle_end
     ),
     activity as (
       select t.carrier_id,
              max(t.transaction_date) as last_tx,
              ${monthAggregates('basis', 'basis_start', 'month_start')},
              ${monthAggregates('month', 'month_start', 'month_end')},
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where ${inWindow('cycle_start', 'cycle_end')}), 0) as cycle_gallons
         from octane.mart_transaction_line_items t
         join owned o on o.carrier_id = t.carrier_id
        -- Contains the cycle window ([26th of M-1, 26th of M) ⊂ [1st of M-1, 1st of M+1)), so one
        -- scan feeds all three. Bounding it at all is what keeps this off a full mart scan.
        where t.transaction_date >= (select basis_start from bounds)
          and t.transaction_date < (select month_end from bounds)
        group by t.carrier_id
     )
     select o.carrier_id, o.company_name, o.agent, o.total_active_cards, o.tier_name, o.trucks,
            coalesce(a.basis_total_gallons, 0)      as basis_total_gallons,
            coalesce(a.basis_in_network_gallons, 0) as basis_in_network_gallons,
            coalesce(a.basis_active_cards, 0)       as basis_active_cards,
            coalesce(a.basis_transactions, 0)       as basis_transactions,
            coalesce(a.month_total_gallons, 0)      as month_total_gallons,
            coalesce(a.month_in_network_gallons, 0) as month_in_network_gallons,
            coalesce(a.month_active_cards, 0)       as month_active_cards,
            coalesce(a.month_transactions, 0)       as month_transactions,
            coalesce(a.cycle_gallons, 0)            as cycle_gallons,
            -- Cast to a DAY in SQL, not in JS: max(transaction_date) arrives as a JS Date and
            -- toISOString() on it re-reads the instant in UTC, which slides a late-evening
            -- transaction onto the next day for any server not running in UTC.
            a.last_tx::date::text as last_tx
       from owned o
       left join activity a on a.carrier_id = o.carrier_id
      -- Heaviest TIER-BASIS volume first, so the carriers that actually hold a tier lead the file.
      order by a.basis_in_network_gallons desc nulls last,
               o.company_name asc nulls last,
               o.carrier_id asc`,
    [monthStartIso],
  );
  return rows.map((r) => ({
    carrierId: str(r.carrier_id),
    companyName: str(r.company_name) || '(unnamed)',
    agentName: str(r.agent) || '—',
    trucks: intOrNull(r.trucks),
    activeCards: num(r.total_active_cards),
    currentStoredTierName: str(r.tier_name),
    basisActiveCards: num(r.basis_active_cards),
    basisInNetworkGallons: num(r.basis_in_network_gallons),
    basisTotalGallons: num(r.basis_total_gallons),
    basisTransactions: num(r.basis_transactions),
    monthActiveCards: num(r.month_active_cards),
    monthInNetworkGallons: num(r.month_in_network_gallons),
    monthTotalGallons: num(r.month_total_gallons),
    monthTransactions: num(r.month_transactions),
    cycleGallons: num(r.cycle_gallons),
    lastTransactionAt: isoDay(r.last_tx),
  }));
}
