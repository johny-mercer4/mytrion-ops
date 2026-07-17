/**
 * Driver row scoping for the mini-app's self-service reads.
 *
 * servercrm's DWH endpoints are CARRIER-scoped — they have no per-card filter — so a driver's
 * balance/transactions/last-used/status calls come back holding the whole fleet's rows. These
 * helpers cut them down to the caller's own card BEFORE the payload leaves our backend.
 *
 * Filtering here (server side) rather than in the mini-app is the whole point: a client-side filter
 * can only hide rows the device has already received.
 */
import type { CarrierTransactions } from '../../wrappers/serverCrmWrapper.js';

/** servercrm caps `limit` at 5000. Driver reads request the ceiling so the own-card filter runs over
 *  the whole requested window — with the default 100, page 1 of a busy fleet can contain none of the
 *  driver's rows and the filter would render an empty list that looks like "no transactions". */
export const DRIVER_TXN_FETCH_LIMIT = 5000;

/** Digits-only view of a card number — both DWH sources store bare 19-digit strings, but callers
 *  (and any future formatted source) may carry spaces/dashes. Normalizing keeps `===` honest. */
function cardDigits(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/\D/g, '');
}

const num = (value: unknown): number => {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : 0;
};

/**
 * Keep only the rows belonging to `cardNumber`, matched on the FULL number.
 *
 * Deliberately not a last-4 match: last-4 is not unique within a carrier (a live DWH probe found one
 * carrier with 11 active cards sharing last-4 `7593`), so a last-4 filter both leaks other drivers'
 * rows and misattributes them. `octane.stg_cmp_card.card_number` and
 * `octane.mart_transaction_line_items.card_number` are both bare 19-digit strings, so an exact
 * compare is the correct join.
 */
export function scopeRowsToCard<T extends Record<string, unknown>>(rows: readonly T[], cardNumber: string): T[] {
  const own = cardDigits(cardNumber);
  if (!own) return [];
  return rows.filter((row) => cardDigits(row['card_number']) === own);
}

/**
 * Accumulated totals over a set of line-item rows.
 *
 * The key names mirror servercrm's `countDwhTransactions` return value EXACTLY — note those are the
 * JS object's keys (`transactions`, `line_items`, `funded_total`, …), NOT the SQL column aliases
 * (`transactions_total`, `sum_amount`, …), which differ. `total_fuel_quantity` duplicates
 * `fuel_quantity`; servercrm keeps it as a widget back-compat alias, so we do too.
 */
export function totalsFromRows(rows: readonly Record<string, unknown>[]): Record<string, unknown> {
  const fuel = rows.reduce((sum, r) => sum + num(r['line_item_fuel_quantity']), 0);
  return {
    transactions: new Set(rows.map((r) => String(r['transaction_id'] ?? ''))).size,
    line_items: rows.length,
    funded_total: rows.reduce((sum, r) => sum + num(r['line_item_amount']), 0),
    fuel_quantity: fuel,
    total_fuel_quantity: fuel,
    discount_amount: rows.reduce((sum, r) => sum + num(r['line_item_discount_amount']), 0),
  };
}

/**
 * Reduce a carrier-wide transactions payload to one card's rows.
 *
 * The totals servercrm sends are accumulated over the CARRIER's whole filter set, so passing them
 * through would leak fleet spend even with the rows filtered — they are recomputed from the scoped
 * rows instead, preserving servercrm's key names (see countDwhTransactions).
 */
export function scopeTransactionsToCard(result: CarrierTransactions, cardNumber: string): CarrierTransactions {
  const rows = scopeRowsToCard(result.data ?? [], cardNumber);
  const upstreamTruncated = result.pagination?.['more_records'] === true;
  return {
    ...result,
    data: rows,
    totals: totalsFromRows(rows),
    pagination: { page: 1, limit: rows.length, count: rows.length, more_records: false },
    // The fleet-wide fetch hit servercrm's 5000-row ceiling, so rows beyond it were never seen by
    // the filter and this card's list may be short. Surfaced rather than silently under-reported.
    ...(upstreamTruncated ? { scope_truncated: true } : {}),
  };
}
