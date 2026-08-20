/**
 * Check B's Zoho side — the duplicate scan over the DEAL population, and Citifuel status.
 *
 * WHY THE DEAL SCAN EXISTS. `matchDuplicates` scans `verification_cases`, which is not the applicant
 * history but a recent window of it: the poller ingests seven stages from a watermark that defaults
 * to today. An applicant who applied last quarter is invisible to it. These tests pin what the Deal
 * query may and may not claim to match on — three of the fields are absent from Zoho `Deals` and a
 * later "completeness" edit that adds them would produce a criterion that silently never fires.
 *
 * WHY CITIFUEL IS A VERDICT AND NOT A STRING COMPARE. `citifuel_Status` is a TEXT field. The live
 * values include `Lead Converted`, `no`, `NO`, `yes`, `App Filled` and `active`; the credit
 * platform's check compared the exact string `Lead Converted`, so the Deals sitting on `yes` passed
 * the pre-stop silently.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runCoql = vi.fn();
vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: { runCoql: (q: string) => runCoql(q) },
}));

const { screenDealsForCase, citifuelVerdict } = await import(
  '../../src/integrations/verificationDealScreening.js'
);

const NEEDLES = {
  dealId: '6227679000199195022',
  email: 'Ops@Kaiser.TEST',
  mc: 'MC-778211',
  dot: '3921884',
  companyName: 'Kaiser Freight LLC',
};

beforeEach(() => {
  runCoql.mockReset();
  runCoql.mockResolvedValue({ rows: [], count: 0, moreRecords: false });
});

describe('the COQL it builds', () => {
  it('matches on both email columns, MC, DOT1 and the deal name', async () => {
    await screenDealsForCase(NEEDLES);
    const sql = String(runCoql.mock.calls[0]![0]);
    expect(sql).toContain("Email = 'ops@kaiser.test'");
    expect(sql).toContain("Secondary_Email = 'ops@kaiser.test'");
    // MC arrives as "MC-778211" and has to reach COQL as digits.
    expect(sql).toContain("MC = '778211'");
    // DOT1 is an INTEGER on Deals, so it must NOT be quoted.
    expect(sql).toContain('DOT1 = 3921884');
    expect(sql).toContain("Deal_Name = 'Kaiser Freight LLC'");
  });

  /**
   * The three fields the Deal population cannot answer for, each for a measured reason. If a later
   * change adds one of these to the WHERE, it becomes a criterion that can never fire — the exact
   * failure mode that left the ban list's phone probe matching 0 of 871 rows.
   */
  it('never claims to match on EIN, phone or SSN', async () => {
    await screenDealsForCase(NEEDLES);
    const sql = String(runCoql.mock.calls[0]![0]);
    expect(sql).not.toMatch(/\bEIN\b/i);
    expect(sql).not.toMatch(/Phone\s*=/);
    expect(sql).not.toMatch(/Cell\s*=/);
    expect(sql).not.toMatch(/SSN/i);
  });

  it('includes in-flight deals — no Stage filter', async () => {
    await screenDealsForCase(NEEDLES);
    expect(String(runCoql.mock.calls[0]![0])).not.toMatch(/Stage\s+(in|=)/);
  });

  it('reads the case own deal in the SAME statement, so Citifuel costs no second call', async () => {
    await screenDealsForCase(NEEDLES);
    expect(runCoql).toHaveBeenCalledTimes(1);
    expect(String(runCoql.mock.calls[0]![0])).toContain("id = '6227679000199195022'");
  });

  it('escapes a quote in a company name rather than breaking out of the literal', async () => {
    await screenDealsForCase({ ...NEEDLES, companyName: "O'Brien Hauling" });
    expect(String(runCoql.mock.calls[0]![0])).toContain("Deal_Name = 'O''Brien Hauling'");
  });

  /** Zoho's MC column is full of "No assigned number" / "DOT" / 0 — none of those is an authority. */
  it('drops sentinel authority values instead of searching for them', async () => {
    await screenDealsForCase({ ...NEEDLES, mc: 'No assigned number', dot: '0' });
    const sql = String(runCoql.mock.calls[0]![0]);
    expect(sql).not.toContain('MC =');
    expect(sql).not.toContain('DOT1 =');
  });

  it('asks nothing at all when there is no needle and no own deal', async () => {
    const out = await screenDealsForCase({ dealId: null, email: null, mc: null, dot: null, companyName: null });
    expect(runCoql).not.toHaveBeenCalled();
    // A successful empty answer, NOT an unavailable one — there was nothing to ask.
    expect(out).toMatchObject({ available: true, duplicates: [], error: null });
  });

  it('refuses a non-numeric deal id rather than interpolating it', async () => {
    await screenDealsForCase({ ...NEEDLES, dealId: "1' or '1'='1" });
    expect(String(runCoql.mock.calls[0]![0])).not.toContain("or '1'='1");
  });
});

describe('what it reports back', () => {
  const row = (over: Record<string, unknown>) => ({
    id: '6227679000111111111',
    Deal_Name: 'Kaiser Freight LLC',
    Stage: 'Application Filled',
    Application_Date: '2026-03-04',
    Email: 'ops@kaiser.test',
    Secondary_Email: null,
    MC: '778211',
    DOT1: 3921884,
    citifuel_Status: null,
    ...over,
  });

  it('excludes the case own deal from the duplicate set and reads Citifuel off it', async () => {
    runCoql.mockResolvedValue({
      rows: [
        row({ id: NEEDLES.dealId, citifuel_Status: 'yes' }),
        row({ id: '6227679000122222222' }),
      ],
      count: 2,
      moreRecords: false,
    });
    const out = await screenDealsForCase(NEEDLES);
    expect(out.duplicates.map((d) => d.dealId)).toEqual(['6227679000122222222']);
    expect(out.citifuel).toEqual({ status: 'yes', verdict: 'flagged' });
  });

  /** MC before name: "same MC as Kaiser Freight" is actionable, "same name as" is often a coincidence. */
  it('attributes a hit to the most specific identifier that collided', async () => {
    runCoql.mockResolvedValue({ rows: [row({})], count: 1, moreRecords: false });
    expect((await screenDealsForCase(NEEDLES)).duplicates[0]?.matchedOn).toBe('mc');

    runCoql.mockResolvedValue({ rows: [row({ MC: null, DOT1: null })], count: 1, moreRecords: false });
    expect((await screenDealsForCase(NEEDLES)).duplicates[0]?.matchedOn).toBe('email');

    runCoql.mockResolvedValue({
      rows: [row({ MC: null, DOT1: null, Email: null })],
      count: 1,
      moreRecords: false,
    });
    expect((await screenDealsForCase(NEEDLES)).duplicates[0]?.matchedOn).toBe('name');
  });

  it('carries each duplicate own Citifuel status, since the query already returned it', async () => {
    runCoql.mockResolvedValue({
      rows: [row({ citifuel_Status: 'Lead Converted' })],
      count: 1,
      moreRecords: false,
    });
    expect((await screenDealsForCase(NEEDLES)).duplicates[0]?.citifuelStatus).toBe('Lead Converted');
  });

  it('flags a truncated answer so the desk does not read 50 as the whole story', async () => {
    runCoql.mockResolvedValue({ rows: [row({})], count: 50, moreRecords: true });
    expect((await screenDealsForCase(NEEDLES)).truncated).toBe(true);
  });

  /**
   * THE ONE THAT MATTERS, and the same rule the ban-list probe follows: Phase 3 runs four independent
   * reads and an unreachable Zoho must not take the other three down, nor be recorded as a clear.
   */
  it('degrades to UNAVAILABLE rather than to no-duplicates when COQL fails', async () => {
    runCoql.mockRejectedValue(new Error('[zoho-crm] COQL HTTP 500'));
    const out = await screenDealsForCase(NEEDLES);
    expect(out.available).toBe(false);
    expect(out.duplicates).toEqual([]);
    expect(out.error).toMatch(/COQL HTTP 500/);
    expect(out.citifuel.verdict).toBe('absent');
  });

  it('never throws', async () => {
    runCoql.mockRejectedValue(new Error('boom'));
    await expect(screenDealsForCase(NEEDLES)).resolves.toBeTruthy();
  });
});

describe('the Citifuel value set', () => {
  it('flags every live value that means an existing Citifuel relationship', () => {
    // `yes` and `active` are the two the exact-string check was missing.
    for (const value of ['Lead Converted', 'lead converted', 'yes', 'YES', 'active', ' Active ']) {
      expect(citifuelVerdict(value)).toBe('flagged');
    }
  });

  it('clears only an explicit no, in whatever case it was typed', () => {
    for (const value of ['no', 'NO', ' No ']) expect(citifuelVerdict(value)).toBe('clear');
  });

  /**
   * `App Filled` is a real live value whose operational meaning this desk has not been told. It must
   * not resolve to clear — a check that cannot answer says so, exactly as the ban-list probe does.
   */
  it('treats App Filled and anything unrecognised as UNKNOWN, never as clear', () => {
    expect(citifuelVerdict('App Filled')).toBe('unknown');
    expect(citifuelVerdict('pending review')).toBe('unknown');
  });

  it('reports an empty or missing status as absent rather than unknown', () => {
    for (const value of ['', '   ', null, undefined]) expect(citifuelVerdict(value)).toBe('absent');
  });
});
