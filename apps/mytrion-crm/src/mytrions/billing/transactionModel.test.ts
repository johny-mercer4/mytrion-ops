/**
 * Transactions search matching — amount / carrier-id / text. Amount search was missing entirely
 * (a digits-only query meant "carrier id" only, and the haystack holds the raw number so "500.00"
 * and "$1,234.56" never matched as text), so these lock the parse + match rules in place.
 */
import { describe, expect, it } from 'vitest';

import { normalizeTx, parseTxSearch, txMatchesSearch, type TxRow } from './transactionModel';

function row(over: Partial<Record<string, unknown>> = {}): TxRow {
  return normalizeTx({
    record_id: 'r1',
    source: 'zelle',
    sender_name: 'ACME TRUCKING LLC',
    memo: 'invoice payment',
    transaction_number: 'ZL9911',
    amount: 1234.56,
    posting_date: '2026-07-20 10:00:00',
    ...over,
  });
}

const matches = (q: string, r: TxRow): boolean => txMatchesSearch(r, parseTxSearch(q));

describe('parseTxSearch', () => {
  it('reads a plain amount, a currency-formatted amount and whole dollars', () => {
    expect(parseTxSearch('1234.56').amount).toEqual({ value: 1234.56, exact: true });
    expect(parseTxSearch('$1,234.56').amount).toEqual({ value: 1234.56, exact: true });
    expect(parseTxSearch('1234').amount).toEqual({ value: 1234, exact: false });
  });

  it('keeps the digits-only carrier-id reading alongside the amount reading', () => {
    const q = parseTxSearch('5551234');
    expect(q.carrierId).toBe('5551234');
    expect(q.amount).toEqual({ value: 5551234, exact: false });
  });

  it('is not an amount query for text', () => {
    expect(parseTxSearch('acme').amount).toBeNull();
    expect(parseTxSearch('zl9911').amount).toBeNull();
  });
});

describe('txMatchesSearch — amount', () => {
  it('matches the exact amount, with or without currency formatting', () => {
    expect(matches('1234.56', row())).toBe(true);
    expect(matches('$1,234.56', row())).toBe(true);
    expect(matches('1234.55', row())).toBe(false);
  });

  it('matches whole dollars against the cents range', () => {
    expect(matches('1234', row())).toBe(true); // 1234.56 is in [1234, 1235)
    expect(matches('1235', row())).toBe(false);
    expect(matches('500', row({ amount: 500 }))).toBe(true);
    expect(matches('500.00', row({ amount: 500 }))).toBe(true);
  });

  it('matches a negative (returned / refunded) amount by its absolute value', () => {
    expect(matches('1234.56', row({ amount: -1234.56 }))).toBe(true);
  });
});

describe('txMatchesSearch — carrier id and text', () => {
  it('matches an exact carrier id and rejects a partial one', () => {
    const r = row({ carrier_id: '5551234' });
    expect(matches('5551234', r)).toBe(true);
    expect(matches('555123', r)).toBe(false);
  });

  it('still matches sender / memo / transaction number as text', () => {
    expect(matches('acme', row())).toBe(true);
    expect(matches('invoice', row())).toBe(true);
    expect(matches('zl9911', row())).toBe(true);
    expect(matches('nope', row())).toBe(false);
  });
});
