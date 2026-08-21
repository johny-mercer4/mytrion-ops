/**
 * Data Center Blacklist search — three parallel probes, never a merged BLOCKED.
 *
 * Pins hash matching on the own list, Deal/case duplicate shape, and a down probe
 * staying `{ available: false }` rather than looking like a clear.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { hashIdentifier } from '../../src/modules/verificationFlow/screening.js';

const matchBlacklist = vi.fn();
const matchDuplicates = vi.fn();
const matchCreditPlatformBanList = vi.fn();
const screenDealsForCase = vi.fn();
const searchVerificationDebtors = vi.fn();
const dwhState = { configured: true };

vi.mock('../../src/repos/verificationScreeningRepo.js', () => ({
  verificationScreeningRepo: {
    matchBlacklist: (...args: unknown[]) => matchBlacklist(...args),
    matchDuplicates: (...args: unknown[]) => matchDuplicates(...args),
  },
}));

vi.mock('../../src/integrations/creditPlatformBlacklist.js', () => ({
  matchCreditPlatformBanList: (...args: unknown[]) => matchCreditPlatformBanList(...args),
}));

vi.mock('../../src/integrations/verificationDealScreening.js', () => ({
  screenDealsForCase: (...args: unknown[]) => screenDealsForCase(...args),
}));

vi.mock('../../src/repos/dwhVerificationDebtorRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/dwhVerificationDebtorRepo.js')>();
  return {
    ...actual,
    searchVerificationDebtors: (...args: unknown[]) => searchVerificationDebtors(...args),
  };
});

vi.mock('../../src/integrations/dwh.js', () => ({
  dwh: { isConfigured: () => dwhState.configured },
}));

const { searchBlacklist } = await import('../../src/modules/verificationFlow/blacklistSearch.js');

const ctx = { tenantId: 't1', userId: 'u1' } as never;

beforeEach(() => {
  dwhState.configured = true;
  matchBlacklist.mockReset();
  matchDuplicates.mockReset();
  matchCreditPlatformBanList.mockReset();
  screenDealsForCase.mockReset();
  searchVerificationDebtors.mockReset();
  matchBlacklist.mockResolvedValue([]);
  matchDuplicates.mockResolvedValue([]);
  matchCreditPlatformBanList.mockResolvedValue({ available: true, hits: [], error: null });
  screenDealsForCase.mockResolvedValue({
    available: true,
    error: null,
    duplicates: [],
    truncated: false,
    citifuel: { status: null, verdict: 'absent' },
  });
  searchVerificationDebtors.mockResolvedValue([]);
});

describe('ban hash match', () => {
  it('hashes the typed key the same way Phase 3 does', async () => {
    const hash = hashIdentifier('usdot', '987654');
    matchBlacklist.mockResolvedValue([
      {
        id: 'vbl_1',
        entryType: 'usdot',
        valueHash: hash,
        valueDisplay: '987654',
        reason: 'Fraud',
        sourceCaseId: 'vc_banned',
        addedBy: 'agent',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
    const out = await searchBlacklist(ctx, { by: 'dot', q: '987654' });
    expect(matchBlacklist).toHaveBeenCalledWith(ctx, [hash]);
    expect(out.ban.hits[0]).toMatchObject({
      list: 'own',
      entryType: 'usdot',
      display: '987654',
      reason: 'Fraud',
      sourceCaseId: 'vc_banned',
    });
    expect(out.ban.available).toBe(true);
  });
});

describe('duplicate shape', () => {
  it('returns case and Deal hits with matched field, id, stage, date', async () => {
    matchDuplicates.mockResolvedValue([
      {
        id: 'vc_other',
        entryType: 'email',
        display: 'ops@kaiser.test',
        statusCode: 'in_review',
        createdAt: new Date('2026-07-01T00:00:00.000Z'),
        applicationDate: '2026-07-01',
        zohoDealId: '6227679000111111111',
        zohoStage: 'Application Filled',
      },
    ]);
    screenDealsForCase.mockResolvedValue({
      available: true,
      error: null,
      truncated: false,
      citifuel: { status: null, verdict: 'absent' },
      duplicates: [
        {
          dealId: '6227679000122222222',
          dealName: 'Kaiser Freight LLC',
          stage: 'Application Filled',
          applicationDate: '2026-03-04',
          matchedOn: 'email',
          citifuelStatus: null,
        },
      ],
    });
    const out = await searchBlacklist(ctx, { by: 'email', q: 'ops@kaiser.test' });
    expect(matchDuplicates).toHaveBeenCalledWith(ctx, null, { email: 'ops@kaiser.test' });
    expect(screenDealsForCase).toHaveBeenCalledWith({
      dealId: null,
      email: 'ops@kaiser.test',
      mc: null,
      dot: null,
      companyName: null,
    });
    expect(out.duplicates.hits).toEqual([
      expect.objectContaining({
        source: 'case',
        matchedField: 'email',
        id: 'vc_other',
        stage: 'Application Filled',
        date: '2026-07-01',
      }),
      expect.objectContaining({
        source: 'deal',
        matchedField: 'email',
        id: '6227679000122222222',
        stage: 'Application Filled',
        date: '2026-03-04',
      }),
    ]);
  });

  it('does not invent a Zoho phone query — local cases still search by phone', async () => {
    await searchBlacklist(ctx, { by: 'phone', q: '(614) 555-0110' });
    expect(matchDuplicates).toHaveBeenCalledWith(ctx, null, { phone: '(614) 555-0110' });
    expect(screenDealsForCase).toHaveBeenCalledWith({
      dealId: null,
      email: null,
      mc: null,
      dot: null,
      companyName: null,
    });
  });
});

describe('debtor needle', () => {
  it('folds a legal name without stripping the comma the warehouse still stores', async () => {
    await searchBlacklist(ctx, { by: 'name', q: 'Kaiser Freight, LLC' });
    expect(searchVerificationDebtors).toHaveBeenCalledWith('name', 'kaiser freight, llc', {
      page: 1,
      pageSize: 50,
    });
  });

  it('pages debtors with LIMIT+1 hasMore and does not hide the remainder', async () => {
    searchVerificationDebtors.mockResolvedValue(
      Array.from({ length: 51 }, (_, i) => ({
        carrier_id: String(i + 1),
        company_name: `Carrier ${i + 1}`,
        computed_debt: 150,
        computed_debt_days: 11,
        open_invoices: 2,
      })),
    );
    const out = await searchBlacklist(ctx, { by: 'name', q: 'Kaiser Freight', page: 1, pageSize: 50 });
    expect(out.debtors.records).toHaveLength(50);
    expect(out.debtors.truncated).toBe(true);
    expect(out.debtors.pagination).toEqual({ page: 1, pageSize: 50, hasMore: true });
  });
});

describe('unavailable probes', () => {
  it('marks a down Credit Platform list as available: false and still returns own hits', async () => {
    matchBlacklist.mockResolvedValue([
      {
        id: 'vbl_1',
        entryType: 'name',
        reason: 'Fraud',
        sourceCaseId: 'vc_1',
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);
    matchCreditPlatformBanList.mockResolvedValue({
      available: false,
      hits: [],
      error: 'VERIFICATION_DATABASE_URL is not configured',
    });
    const out = await searchBlacklist(ctx, { by: 'name', q: 'Kaiser Freight' });
    expect(out.ban.available).toBe(false);
    expect(out.ban.platformAvailable).toBe(false);
    expect(out.ban.ownAvailable).toBe(true);
    expect(out.ban.hits).toHaveLength(1);
    expect(out.duplicates.available).toBe(true);
    expect(out.debtors.available).toBe(true);
  });

  it('marks a down DWH debtor probe as available: false, not a clear', async () => {
    dwhState.configured = false;
    const out = await searchBlacklist(ctx, { by: 'dot', q: '987654' });
    expect(out.debtors).toEqual({
      available: false,
      error: 'DWH_DATABASE_URL is not configured',
      records: [],
      truncated: false,
      pagination: { page: 1, pageSize: 50, hasMore: false },
    });
    expect(out.ban.available).toBe(true);
    expect(out.duplicates.available).toBe(true);
  });
});
