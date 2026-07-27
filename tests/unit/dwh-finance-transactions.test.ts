/**
 * finance.main_transactions — pagination + search actually reach SQL.
 *
 * Regression guard: this touchpoint moved from a servercrm passthrough (looseFilters, which carried
 * `page` / `search`) to a local DWH query that only understood `limit`. Because the params schema
 * was a plain z.object, zod SILENTLY STRIPPED the two extra keys — a caller asking for page 3 or a
 * company search got 200 and the unfiltered first page. The schema is strict now and the query
 * honours both, so assert on the emitted SQL and args rather than just the schema shape.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/dwh.js', () => ({ dwhQuery: vi.fn(async () => []) }));

import { dwhQuery } from '../../src/integrations/dwh.js';
import { fetchFinanceTransactions } from '../../src/integrations/dwhFinance.js';
import { getTouchpoint } from '../../src/modules/touchpoints/catalog/index.js';

const q = vi.mocked(dwhQuery);
/** Collapse whitespace so assertions don't depend on SQL indentation. */
const sqlOf = () => String(q.mock.calls[0]?.[0] ?? '').replace(/\s+/g, ' ').trim();
const argsOf = () => q.mock.calls[0]?.[1] as unknown[];

beforeEach(() => q.mockClear());

describe('fetchFinanceTransactions', () => {
  it('defaults to the first page with no WHERE clause', async () => {
    await fetchFinanceTransactions();
    expect(sqlOf()).toContain('LIMIT $1 OFFSET $2');
    expect(sqlOf()).not.toContain('WHERE');
    expect(argsOf()).toEqual([100, 0]);
  });

  it('turns page into the matching OFFSET', async () => {
    await fetchFinanceTransactions({ limit: 25, page: 4 });
    expect(argsOf()).toEqual([25, 75]); // (4 - 1) * 25
  });

  it('searches company, carrier, card and location', async () => {
    await fetchFinanceTransactions({ search: 'ZHU LLC' });
    const sql = sqlOf();
    expect(sql).toContain('WHERE');
    for (const col of ['company_name', 'carrier_id::text', 'card_number', 'location_name']) {
      expect(sql).toContain(`${col} ILIKE $3`);
    }
    expect(argsOf()).toEqual([100, 0, '%ZHU LLC%']);
  });

  it('escapes LIKE metacharacters so % and _ match themselves', async () => {
    await fetchFinanceTransactions({ search: '50%_off' });
    expect(argsOf()[2]).toBe('%50\\%\\_off%');
  });

  it('keeps WHERE before ORDER BY (valid SQL)', async () => {
    await fetchFinanceTransactions({ search: 'x' });
    const sql = sqlOf();
    expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('ORDER BY'));
    expect(sql.indexOf('ORDER BY')).toBeLessThan(sql.indexOf('LIMIT'));
  });
});

describe('finance.main_transactions params', () => {
  const schema = () => getTouchpoint('finance.main_transactions')!.paramsSchema;

  it('carries page and search through instead of dropping them', () => {
    expect(schema().parse({ limit: 50, page: 2, search: 'ZHU LLC' })).toEqual({
      limit: 50,
      page: 2,
      search: 'ZHU LLC',
    });
  });

  it('rejects an unsupported filter rather than silently ignoring it', () => {
    // The whole point: a wrong-but-successful read is worse than a 400.
    expect(() => schema().parse({ limit: 10, carrier: '5806565' })).toThrow();
    expect(() => schema().parse({ 'bad key!': 'x' })).toThrow();
  });

  it('bounds page so a deep OFFSET cannot stall the warehouse', () => {
    expect(() => schema().parse({ page: 0 })).toThrow();
    expect(() => schema().parse({ page: 1001 })).toThrow();
  });
});
