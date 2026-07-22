import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/dwh.js', () => ({ dwhQuery: vi.fn() }));

import { dwhQuery } from '../../src/integrations/dwh.js';
import { listDwhTransactions, resolveDwhTxnRange } from '../../src/integrations/dwhTransactions.js';

const query = vi.mocked(dwhQuery);

/** listDwhTransactions fires the page query and the totals query together, in that order. */
function mockPageAndTotals(rows: Array<Record<string, unknown>>) {
  query.mockResolvedValueOnce(rows).mockResolvedValueOnce([
    { line_items_total: String(rows.length), transactions_total: String(rows.length), sum_amount: '0', sum_fuel_quantity: '0', sum_discount_amount: '0' },
  ]);
}

beforeEach(() => {
  query.mockReset();
});

describe('listDwhTransactions', () => {
  it('sends the DB timestamp back unshifted, not re-serialised through UTC', async () => {
    // What `pg` hands back for a `timestamp without time zone` of '2026-07-16 21:59:00': a Date
    // built in the SERVER's timezone. JSON.stringify would emit 16:59Z on a +05 host — a five-hour
    // lie that also made this phase disagree with servercrm's merged phase (which reports 21:59).
    mockPageAndTotals([{ transaction_id: 't1', transaction_date: new Date(2026, 6, 16, 21, 59, 0) }]);

    const r = await listDwhTransactions({ carrierId: '5765985', range: 'month' });

    expect(r.data[0]!['transaction_date']).toBe('2026-07-16 21:59:00');
    // The precise trap: whatever we emit must not be the UTC re-encoding of that Date.
    expect(JSON.stringify(r.data[0])).not.toContain('16:59');
  });

  it('leaves a non-Date timestamp alone', async () => {
    mockPageAndTotals([{ transaction_id: 't1', transaction_date: '2026-07-16 21:59:00' }]);
    const r = await listDwhTransactions({ carrierId: '5765985', range: 'month' });
    expect(r.data[0]!['transaction_date']).toBe('2026-07-16 21:59:00');
  });

  it('scopes to one card at the SQL level rather than filtering afterwards', async () => {
    mockPageAndTotals([]);
    await listDwhTransactions({ carrierId: '5765985', cardNumber: '7083050030880417593', range: 'month' });

    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toContain('t.card_number = $2');
    expect(params).toContain('7083050030880417593');
  });

  it('accumulates totals over the whole window, not just the returned page', async () => {
    query.mockResolvedValueOnce([{ transaction_id: 't1' }]).mockResolvedValueOnce([
      { line_items_total: '9600', transactions_total: '7186', sum_amount: '802136.02', sum_fuel_quantity: '181094.39', sum_discount_amount: '76542.87' },
    ]);
    const r = await listDwhTransactions({ carrierId: '5776046', range: 'year', limit: 1 });

    expect(r.data).toHaveLength(1);
    // Key names mirror servercrm's countDwhTransactions RETURN value, not its SQL aliases.
    expect(r.totals).toMatchObject({
      transactions: 7186,
      line_items: 9600,
      funded_total: 802136.02,
      fuel_quantity: 181094.39,
      total_fuel_quantity: 181094.39,
      discount_amount: 76542.87,
    });
  });
});

describe('resolveDwhTxnRange', () => {
  it('starts the week on Monday, matching servercrm', () => {
    // Both phases must resolve the SAME window or rows jump between the fast paint and the refresh.
    const r = resolveDwhTxnRange('week');
    expect(new Date(`${r.from}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('rejects an unknown preset and a custom range missing its bounds', () => {
    expect(() => resolveDwhTxnRange('fortnight')).toThrow(/Unknown range/);
    expect(() => resolveDwhTxnRange('custom')).toThrow(/requires both from and to/);
  });

  it('leaves all_time without a lower bound', () => {
    expect(resolveDwhTxnRange('all_time').from).toBeNull();
  });
});
