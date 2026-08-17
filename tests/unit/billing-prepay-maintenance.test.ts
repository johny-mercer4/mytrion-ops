/**
 * The prepay ledger's maintenance/zelle/chase/merchant terms now come from OUR Postgres, not from
 * servercrm's Zoho read.
 *
 * Three things here are easy to get wrong and impossible to notice from a passing screen:
 *   - a carrier servercrm still reports from Zoho must not keep that stale figure, so the maintenance
 *     override zeroes every reported carrier before writing ours in;
 *   - `difference` in the daily ledger is a RUNNING balance, so replacing one day's maintenance/zelle/
 *     chase/merchant invalidates that day and every day after it. A partial recompute produces a
 *     plausible, wrong closing balance;
 *   - zelle/chase/merchant read Zoho's Zelle_Transactions/Chase_Transactions modules directly in
 *     servercrm, which payments landing straight in payment_transactions since the Postgres migration
 *     never get written back into — confirmed live 2026-08-18 (carrier 5788724): four real top-ups
 *     had a matching Postgres Zelle row the modal showed as unmatched, inflating a running Difference
 *     from $0 to $3,200 even though the company list (already Postgres-sourced) correctly showed a
 *     $66.70 residual. Same override treatment as maintenance, just three columns instead of one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/serverCrm.js', () => ({
  serverCrmGet: vi.fn(),
  serverCrm: { get: vi.fn() },
}));
vi.mock('../../src/repos/maintenanceCaseRepo.js', () => ({
  maintenanceCaseRepo: {
    sumPrepayByCarrier: vi.fn(async () => new Map<string, number>()),
    sumPrepayByDay: vi.fn(async () => new Map<string, number>()),
  },
}));
vi.mock('../../src/integrations/dwh.js', () => ({ dwh: { query: vi.fn(async () => []) } }));
vi.mock('../../src/repos/paymentTransactionRepo.js', () => ({
  paymentTransactionRepo: { sumForPrepay: vi.fn(async () => []), sumForPrepayByDay: vi.fn(async () => []) },
}));

import { serverCrmGet } from '../../src/integrations/serverCrm.js';
import { maintenanceCaseRepo } from '../../src/repos/maintenanceCaseRepo.js';
import { paymentTransactionRepo } from '../../src/repos/paymentTransactionRepo.js';
import { getPrepayExternalsBatch, getPrepayLedgerProxy } from '../../src/modules/billing/prepayLedger.js';

const proxied = vi.mocked(serverCrmGet);
const repo = vi.mocked(maintenanceCaseRepo, true);
const pgRepo = vi.mocked(paymentTransactionRepo, true);

/** Shape `sumForPrepayByDay` returns: one row per (day, source) that had any amount. */
const pgSum = (...rows: Array<{ day: string; source: 'zelle' | 'chase' | 'mx'; total: number }>) => rows;

beforeEach(() => {
  vi.clearAllMocks();
  repo.sumPrepayByCarrier.mockResolvedValue(new Map());
  repo.sumPrepayByDay.mockResolvedValue(new Map());
  pgRepo.sumForPrepayByDay.mockResolvedValue([]);
});

describe('externals batch', () => {
  it('replaces servercrm\'s Zoho maintenance with ours, keeping money codes and Stripe', async () => {
    proxied.mockResolvedValue({
      externals: { '5000010': { money_code: 100, maintenance: 999.99, stripe: 42 } },
      warnings: [],
    });
    repo.sumPrepayByCarrier.mockResolvedValue(new Map([['5000010', 100.00]]));

    const out = await getPrepayExternalsBatch('2026-07-01', '2026-08-01');
    expect(out.externals?.['5000010']).toEqual({
      money_code: 100,
      maintenance: 100.00, // ours, not 999.99
      stripe: 42,
    });
  });

  it('ZEROES a carrier servercrm reported but we have no rows for', async () => {
    // Otherwise a carrier whose maintenance now lives only in our table (or was deleted from the
    // window) silently keeps Zoho's stale number and the Difference column stays wrong.
    proxied.mockResolvedValue({ externals: { '5000011': { money_code: 5, maintenance: 250.00 } } });
    repo.sumPrepayByCarrier.mockResolvedValue(new Map());

    const out = await getPrepayExternalsBatch('2026-07-01', '2026-08-01');
    expect(out.externals?.['5000011']).toEqual({ money_code: 5, maintenance: 0 });
  });

  it('adds a carrier that only WE know about', async () => {
    proxied.mockResolvedValue({ externals: {} });
    repo.sumPrepayByCarrier.mockResolvedValue(new Map([['5000020', 777.25]]));

    const out = await getPrepayExternalsBatch('2026-07-01', '2026-08-01');
    expect(out.externals?.['5000020']).toEqual({ maintenance: 777.25 });
  });

  it('passes the window through unchanged (endDate is EXCLUSIVE by widget convention)', async () => {
    proxied.mockResolvedValue({ externals: {} });
    await getPrepayExternalsBatch('2026-07-01', '2026-08-01');
    expect(repo.sumPrepayByCarrier).toHaveBeenCalledWith('2026-07-01', '2026-08-01');
    expect(proxied.mock.calls[0]?.[0]).toContain('startDate=2026-07-01');
    expect(proxied.mock.calls[0]?.[0]).toContain('endDate=2026-08-01');
  });

  it('survives a reply with no externals block', async () => {
    proxied.mockResolvedValue({});
    repo.sumPrepayByCarrier.mockResolvedValue(new Map([['1', 5]]));
    const out = await getPrepayExternalsBatch('2026-07-01', '2026-08-01');
    expect(out.externals?.['1']?.maintenance).toBe(5);
    expect(out.warnings).toEqual([]);
  });

  it('rounds to cents', async () => {
    proxied.mockResolvedValue({ externals: {} });
    repo.sumPrepayByCarrier.mockResolvedValue(new Map([['1', 10.005999]]));
    const out = await getPrepayExternalsBatch('2026-07-01', '2026-08-01');
    expect(out.externals?.['1']?.maintenance).toBe(10.01);
  });
});

describe('daily ledger', () => {
  /** servercrm's row shape. maintenance/delta/difference are the stale values we must replace. */
  const day = (date: string, over: Partial<Record<string, number>> = {}) => ({
    date,
    top_up: 0,
    rmve: 0,
    money_code: 0,
    maintenance: 0,
    stripe: 0,
    zelle: 0,
    chase: 0,
    merchant: 0,
    delta: 0,
    difference: 0,
    ...over,
  });

  it('recomputes the RUNNING difference for every day after a changed one', async () => {
    proxied.mockResolvedValue({
      rows: [
        day('2026-07-01', { top_up: 1000, maintenance: 0, delta: 1000, difference: 1000 }),
        day('2026-07-02', { maintenance: 0, delta: 0, difference: 1000 }),
        day('2026-07-03', { stripe: 200, maintenance: 0, delta: -200, difference: 800 }),
      ],
      totals: { top_up: 1000, maintenance: 0, stripe: 200, net: 800 },
    });
    // A $50 fee on day 2 must shift day 2 AND day 3's closing balance.
    repo.sumPrepayByDay.mockResolvedValue(new Map([['2026-07-02', 50]]));

    const out = (await getPrepayLedgerProxy('5000010', '2026-07-01', '2026-08-01')) as {
      rows: Array<{ date: string; maintenance: number; delta: number; difference: number }>;
      totals: Record<string, number>;
    };

    expect(out.rows.map((r) => r.maintenance)).toEqual([0, 50, 0]);
    expect(out.rows.map((r) => r.delta)).toEqual([1000, 50, -200]);
    expect(out.rows.map((r) => r.difference)).toEqual([1000, 1050, 850]);
    expect(out.totals.maintenance).toBe(50);
    expect(out.totals.net).toBe(850);
  });

  it('applies servercrm\'s exact delta formula, with zelle/chase/merchant from OUR Postgres', async () => {
    // delta = top_up - rmve + maintenance + money_code - stripe - zelle - chase - merchant
    // top_up/rmve/money_code/stripe still pass through from servercrm's reply unmodified; only
    // zelle/chase/merchant are ours (servercrm's own 2/3/4 on this row must be ignored).
    proxied.mockResolvedValue({
      rows: [
        day('2026-07-01', {
          top_up: 100,
          rmve: 10,
          money_code: 5,
          stripe: 1,
          zelle: 2,
          chase: 3,
          merchant: 4,
        }),
      ],
      totals: {},
    });
    repo.sumPrepayByDay.mockResolvedValue(new Map([['2026-07-01', 20]]));
    pgRepo.sumForPrepayByDay.mockResolvedValue(
      pgSum({ day: '2026-07-01', source: 'zelle', total: 2 }, { day: '2026-07-01', source: 'chase', total: 3 }, { day: '2026-07-01', source: 'mx', total: 4 }),
    );

    const out = (await getPrepayLedgerProxy('1', '2026-07-01', '2026-08-01')) as {
      rows: Array<{ delta: number; difference: number }>;
    };
    // 100 - 10 + 20 + 5 - 1 - 2 - 3 - 4 = 105
    expect(out.rows[0]!.delta).toBe(105);
    expect(out.rows[0]!.difference).toBe(105);
  });

  it('replaces servercrm\'s stale Zoho zelle/chase/merchant with ours, recomputing the running balance', async () => {
    // Regression pin for the live 2026-08-18 bug: servercrm shows a top-up as unmatched (zelle: 0)
    // even though Postgres has the real matching Zelle row, inflating Difference day after day.
    proxied.mockResolvedValue({
      rows: [
        day('2026-07-25', { top_up: 1000, zelle: 0, delta: 1000, difference: 1000 }),
        day('2026-07-26', { delta: 0, difference: 1000 }),
      ],
      totals: { top_up: 1000, zelle: 0, net: 1000 },
    });
    pgRepo.sumForPrepayByDay.mockResolvedValue(pgSum({ day: '2026-07-25', source: 'zelle', total: 1000 }));

    const out = (await getPrepayLedgerProxy('5788724', '2026-07-25', '2026-08-01')) as {
      rows: Array<{ zelle: number; delta: number; difference: number }>;
      totals: Record<string, number>;
    };
    expect(out.rows.map((r) => r.zelle)).toEqual([1000, 0]);
    expect(out.rows.map((r) => r.delta)).toEqual([0, 0]);
    expect(out.rows.map((r) => r.difference)).toEqual([0, 0]);
    expect(out.totals.zelle).toBe(1000);
    expect(out.totals.net).toBe(0);
  });

  it('zeroes a stale merchant value servercrm reported for a day we have nothing on', async () => {
    proxied.mockResolvedValue({
      rows: [day('2026-07-01', { merchant: 300, delta: -300, difference: -300 })],
      totals: { merchant: 300, net: -300 },
    });
    pgRepo.sumForPrepayByDay.mockResolvedValue([]);

    const out = (await getPrepayLedgerProxy('1', '2026-07-01', '2026-08-01')) as {
      rows: Array<{ merchant: number; difference: number }>;
      totals: Record<string, number>;
    };
    expect(out.rows[0]!.merchant).toBe(0);
    expect(out.rows[0]!.difference).toBe(0);
    expect(out.totals.merchant).toBe(0);
    expect(out.totals.net).toBe(0);
  });

  it('keeps chase isolated from zelle/merchant on the same day (per-source grouping)', async () => {
    proxied.mockResolvedValue({
      rows: [day('2026-07-01', { delta: 0, difference: 0 })],
      totals: {},
    });
    pgRepo.sumForPrepayByDay.mockResolvedValue(
      pgSum({ day: '2026-07-01', source: 'chase', total: 60 }, { day: '2026-07-01', source: 'zelle', total: 0 }),
    );

    const out = (await getPrepayLedgerProxy('1', '2026-07-01', '2026-08-01')) as {
      rows: Array<{ zelle: number; chase: number; merchant: number; delta: number }>;
    };
    expect(out.rows[0]).toMatchObject({ zelle: 0, chase: 60, merchant: 0, delta: -60 });
  });

  it('zeroes a stale maintenance value servercrm reported for a day we have nothing on', async () => {
    proxied.mockResolvedValue({
      rows: [day('2026-07-01', { maintenance: 500, delta: 500, difference: 500 })],
      totals: { maintenance: 500, net: 500 },
    });
    repo.sumPrepayByDay.mockResolvedValue(new Map());

    const out = (await getPrepayLedgerProxy('1', '2026-07-01', '2026-08-01')) as {
      rows: Array<{ maintenance: number; difference: number }>;
      totals: Record<string, number>;
    };
    expect(out.rows[0]!.maintenance).toBe(0);
    expect(out.rows[0]!.difference).toBe(0);
    expect(out.totals.maintenance).toBe(0);
    expect(out.totals.net).toBe(0);
  });

  it('passes a reply through untouched when it carries no rows array', async () => {
    // e.g. servercrm returned an error envelope — do not fabricate a ledger from it.
    proxied.mockResolvedValue({ success: false, warnings: ['boom'] });
    const out = await getPrepayLedgerProxy('1', '2026-07-01', '2026-08-01');
    expect(out).toEqual({ success: false, warnings: ['boom'] });
  });

  it('preserves keys it does not own (carrier_id, company_name, range)', async () => {
    proxied.mockResolvedValue({
      success: true,
      carrier_id: '5000010',
      company_name: 'ACME',
      range: { startDate: '2026-07-01', endDate: '2026-08-01' },
      rows: [day('2026-07-01')],
      totals: { rmve: 0 },
    });
    const out = (await getPrepayLedgerProxy('5000010', '2026-07-01', '2026-08-01')) as Record<string, unknown>;
    expect(out.carrier_id).toBe('5000010');
    expect(out.company_name).toBe('ACME');
    expect(out.range).toEqual({ startDate: '2026-07-01', endDate: '2026-08-01' });
    expect((out.totals as Record<string, number>).rmve).toBe(0);
  });

  it('scopes the DB read to the carrier being viewed', async () => {
    proxied.mockResolvedValue({ rows: [] });
    await getPrepayLedgerProxy('5000010', '2026-07-01', '2026-08-01');
    expect(repo.sumPrepayByDay).toHaveBeenCalledWith('5000010', '2026-07-01', '2026-08-01');
    expect(pgRepo.sumForPrepayByDay).toHaveBeenCalledWith(
      ['zelle', 'chase', 'mx'],
      '5000010',
      '2026-07-01',
      '2026-08-01',
    );
  });
});
