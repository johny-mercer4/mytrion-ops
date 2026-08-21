/**
 * Data Center CITI Fuel — wraps `queryDealsForNeedles`, the existing Citifuel Deal COQL.
 *
 * Pins the keys that query already filters (USDOT / MC / email / name) and refuses to invent
 * a phone clause, an Owner scope, or a second SELECT list.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCoql = vi.fn();
vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: { runCoql: (q: string) => runCoql(q) },
}));

const { searchCitifuel } = await import('../../src/modules/verificationFlow/citiSearch.js');
const {
  CITI_SEARCH_DEFAULT_PAGE_SIZE,
  DEAL_SCREENING_LIMIT,
  queryDealsForNeedles,
  screenDealsForCase,
} = await import('../../src/integrations/verificationDealScreening.js');

function withoutLimit(sql: string): string {
  return sql.replace(/\s+limit\s+\d+\s*,\s*\d+\s*$/i, '');
}

const ROW = {
  id: '6227679000111111111',
  Deal_Name: 'Kaiser Freight LLC',
  Stage: 'Application Filled',
  Application_Date: '2026-03-04',
  Email: 'ops@kaiser.test',
  Secondary_Email: null,
  MC: '778211',
  DOT1: 3921884,
  citifuel_Status: 'yes',
};

beforeEach(() => {
  runCoql.mockReset();
  runCoql.mockResolvedValue({ rows: [ROW], count: 1, moreRecords: false });
});

describe('searchCitifuel COQL', () => {
  it('is the same statement queryDealsForNeedles / screenDealsForCase already build', async () => {
    await searchCitifuel({ by: 'dot', q: '3921884' });
    const citiSql = String(runCoql.mock.calls[0]![0]);
    expect(citiSql).toContain(`limit 0, ${CITI_SEARCH_DEFAULT_PAGE_SIZE}`);
    runCoql.mockClear();
    await queryDealsForNeedles({
      dealId: null,
      email: null,
      mc: null,
      dot: '3921884',
      companyName: null,
    });
    const phaseSql = String(runCoql.mock.calls[0]![0]);
    expect(phaseSql).toContain(`limit 0, ${DEAL_SCREENING_LIMIT}`);
    expect(withoutLimit(citiSql)).toBe(withoutLimit(phaseSql));

    runCoql.mockClear();
    await screenDealsForCase({
      dealId: null,
      email: null,
      mc: null,
      dot: '3921884',
      companyName: null,
    });
    expect(withoutLimit(String(runCoql.mock.calls[0]![0]))).toBe(withoutLimit(citiSql));
  });

  it('filters USDOT on DOT1, MC, both emails, and exact Deal_Name', async () => {
    await searchCitifuel({ by: 'dot', q: '3921884' });
    expect(String(runCoql.mock.calls[0]![0])).toContain('DOT1 = 3921884');

    runCoql.mockClear();
    await searchCitifuel({ by: 'mc', q: 'MC-778211' });
    expect(String(runCoql.mock.calls[0]![0])).toContain("MC = '778211'");

    runCoql.mockClear();
    await searchCitifuel({ by: 'email', q: 'Ops@Kaiser.TEST' });
    const emailSql = String(runCoql.mock.calls[0]![0]);
    expect(emailSql).toContain("Email = 'ops@kaiser.test'");
    expect(emailSql).toContain("Secondary_Email = 'ops@kaiser.test'");

    runCoql.mockClear();
    await searchCitifuel({ by: 'name', q: "O'Brien Hauling" });
    expect(String(runCoql.mock.calls[0]![0])).toContain("Deal_Name = 'O''Brien Hauling'");
  });

  it('does not invent phone, Owner, Stage, or EIN filters', async () => {
    await searchCitifuel({ by: 'name', q: 'Kaiser Freight LLC' });
    const sql = String(runCoql.mock.calls[0]![0]);
    expect(sql).not.toMatch(/Phone\s*=/);
    expect(sql).not.toMatch(/Cell\s*=/);
    expect(sql).not.toMatch(/\bOwner\s*=/);
    expect(sql).not.toMatch(/Stage\s+(in|=)/);
    expect(sql).not.toMatch(/\bEIN\b/i);
    expect(sql).toContain('citifuel_Status');
  });

  it('asks nothing when a sentinel authority would be the only needle', async () => {
    const out = await searchCitifuel({ by: 'dot', q: '0' });
    expect(runCoql).not.toHaveBeenCalled();
    expect(out).toMatchObject({ available: true, notFound: true, records: [] });
  });
});

describe('searchCitifuel payload', () => {
  it('returns the selected Deal fields plus a Citifuel verdict', async () => {
    const out = await searchCitifuel({ by: 'dot', q: '3921884' });
    expect(out.available).toBe(true);
    expect(out.matchedOn).toBe('dot');
    expect(out.notFound).toBe(false);
    expect(out.records[0]).toMatchObject({
      dealId: ROW.id,
      dealName: 'Kaiser Freight LLC',
      dotNumber: '3921884',
      mcNumber: '778211',
      citifuelStatus: 'yes',
      citifuelVerdict: 'flagged',
    });
    expect(out.records[0]?.fields).toMatchObject({
      Deal_Name: 'Kaiser Freight LLC',
      DOT1: 3921884,
      citifuel_Status: 'yes',
    });
    expect(out.pagination).toEqual({
      page: 1,
      pageSize: CITI_SEARCH_DEFAULT_PAGE_SIZE,
      hasMore: false,
    });
  });

  it('pages the same COQL with Zoho offset and surfaces more_records as hasMore', async () => {
    runCoql.mockResolvedValue({
      rows: Array.from({ length: 200 }, (_, i) => ({ ...ROW, id: `id-${i}` })),
      count: 200,
      moreRecords: true,
    });
    const out = await searchCitifuel({ by: 'name', q: 'Kaiser Freight LLC', page: 2, pageSize: 200 });
    expect(String(runCoql.mock.calls[0]![0])).toContain('limit 200, 200');
    expect(out.truncated).toBe(true);
    expect(out.pagination).toEqual({ page: 2, pageSize: 200, hasMore: true });
  });

  it('degrades to available:false when Zoho is down', async () => {
    runCoql.mockRejectedValue(new Error('[zoho-crm] COQL HTTP 500'));
    const out = await searchCitifuel({ by: 'email', q: 'ops@kaiser.test' });
    expect(out.available).toBe(false);
    expect(out.records).toEqual([]);
    expect(out.error).toMatch(/COQL HTTP 500/);
  });
});
