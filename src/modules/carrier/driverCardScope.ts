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

/**
 * servercrm caps `limit` at 5000; every mini-app transactions read asks for the ceiling.
 *
 * Two reasons, and BOTH phases must use it:
 *  - Driver: the own-card filter has to run over the whole window. With the default 100, page 1 of a
 *    busy fleet can hold none of the driver's rows, rendering an empty "no transactions" list.
 *  - Owner: the fast phase and the live phase must return the SAME window. Letting the live phase
 *    fall back to 100 makes an owner's year view visibly shrink from 318 rows to 100 the moment the
 *    refresh lands (measured, carrier 5765985).
 */
export const TXN_FETCH_LIMIT = 5000;

/** Digits-only view of a card number — both DWH sources store bare 19-digit strings, but callers
 *  (and any future formatted source) may carry spaces/dashes. Normalizing keeps `===` honest.
 *
 *  Exported because self-registration needs the SAME normalization before its exact-match lookup:
 *  the number is printed on the card in groups of four and the mini-app's own input renders it that
 *  way, so a caller that forwards what the driver sees would otherwise miss a valid card. */
export function cardDigits(value: unknown): string {
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
 * Drop rows outside the period the caller actually asked for, and re-total from what survives.
 *
 * servercrm's EFS gap-fill over-reaches: it asks EFS from the newest DWH row (or the window start)
 * to the window end, and EFS answers with rows either side of that. Its `totals` come from a
 * DWH-only count over the window, so the two disagree — measured on "Today", which returned
 * $0.00/0 gal alongside two rows dated 2026-07-16, transactions that were ALREADY in the mart and
 * only escaped de-duplication because an empty window meant an empty id set to de-dupe against.
 *
 * Compared on the date prefix because the two sources disagree on shape: the mart's rows are naive
 * ('2026-07-16 21:59:00'), EFS's carry an offset ('2026-07-16T22:59:00.000-05:00'). The calendar day
 * is the only part both agree on, and it is what the SQL window filters on anyway.
 *
 * Totals are recomputed from the surviving rows so the summary can never contradict the list — but
 * only when the page holds the whole window. If servercrm truncated at its row ceiling, its
 * window-wide totals are the more honest number and are kept.
 */
export function clampToWindow(result: CarrierTransactions, window: { from: string | null; to: string | null }): CarrierTransactions {
  const day = (row: Record<string, unknown>) => String(row['transaction_date'] ?? '').slice(0, 10);
  const rows = (result.data ?? []).filter((r) => {
    const d = day(r);
    if (!d) return true; // no date to judge by — keep it rather than silently drop a real row
    return (!window.from || d >= window.from) && (!window.to || d <= window.to);
  });
  const truncated = result.pagination?.['more_records'] === true;
  return {
    ...result,
    data: rows,
    totals: truncated ? (result.totals ?? {}) : totalsFromRows(rows),
    ...(truncated ? { scope_truncated: true } : {}),
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
