/**
 * Marketing → Loyalty Program EXPORT (`/v1/marketing/loyalty/export`).
 *
 * The route is a bulk extract of the ENTIRE company book — every carrier, its owning agent and its
 * fuel volumes — for a caller-chosen month, so it gets the same gate regression suite as the board
 * read (CLAUDE.md rule 9): a 403 must also mean the warehouse was never touched, not merely that the
 * body was withheld after the query ran.
 *
 * Beyond authorization, three behaviours are pinned because getting any of them wrong produces a file
 * that LOOKS right and is not:
 *   • the month is bound to the DWH query exactly as asked, and a future month is refused rather than
 *     clamped — a silently clamped month means the sheet is titled with a period it does not hold;
 *   • `basisMonth` is always the month BEFORE the reported one, including across a year boundary;
 *   • the stored warehouse tier is forwarded ONLY for the current month, because `dim_company.
 *     tier_name` is today's tier and a past-month export must not backdate it.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/integrations/dwhLoyaltyMonth.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhLoyaltyMonth.js')>();
  return { ...mod, fetchLoyaltyClientsForMonth: vi.fn(async () => []) };
});
vi.mock('../../src/repos/loyaltyClientOverrideRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/loyaltyClientOverrideRepo.js')>();
  return {
    ...mod,
    loyaltyClientOverrideRepo: {
      ...mod.loyaltyClientOverrideRepo,
      list: vi.fn(async () => []),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchLoyaltyClientsForMonth } from '../../src/integrations/dwhLoyaltyMonth.js';
import { clearLoyaltyMonthRosterCache } from '../../src/modules/manager/loyaltyMonthRoster.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { loyaltyClientOverrideRepo } from '../../src/repos/loyaltyClientOverrideRepo.js';

const monthMock = vi.mocked(fetchLoyaltyClientsForMonth);
const overrideListMock = vi.mocked(loyaltyClientOverrideRepo.list);

const SAMPLE = {
  carrierId: '5794015',
  companyName: 'KBUFF TRUCKING LTD',
  agentName: 'Diana Rose',
  trucks: 1,
  activeCards: 85,
  currentStoredTierName: 'Gold',
  basisActiveCards: 67,
  basisInNetworkGallons: 112000,
  basisTotalGallons: 117186.96,
  basisTransactions: 902,
  monthActiveCards: 70,
  monthInNetworkGallons: 90000,
  monthTotalGallons: 93171.08,
  monthTransactions: 811,
  cycleGallons: 2712.5,
  lastTransactionAt: '2026-07-24',
};

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  monthMock.mockResolvedValue([]);
  overrideListMock.mockResolvedValue([]);
  // The route caches a month for two minutes; without this every test after the first would assert
  // against the previous test's snapshot instead of its own mock.
  clearLoyaltyMonthRosterCache();
});

async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'CI Test Admin', profile },
  });
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

/** A month that is definitely closed, whenever the suite runs. */
function closedMonth(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-01`;
}
const url = (month: string): string => `/v1/marketing/loyalty/export?month=${month}`;

describe('the export is marketing-gated', () => {
  it('refuses an unauthenticated caller and never reads the warehouse', async () => {
    const res = await app.inject({ method: 'GET', url: url(closedMonth()) });
    expect(res.statusCode).toBe(401);
    expect(monthMock).not.toHaveBeenCalled();
  });

  it.each(['Sales Rep', 'Billing Clerk', 'Management'])(
    'refuses a %s — the company-wide book is not theirs to extract',
    async (profile) => {
      const token = await workerToken(profile);
      const res = await app.inject({ method: 'GET', url: url(closedMonth()), headers: bearer(token) });
      expect(res.statusCode).toBe(403);
      expect(monthMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['x-department-access: marketing', { 'x-department-access': 'marketing' }],
    ['x-all-departments: true', { 'x-all-departments': 'true' }],
  ])('a sales rep asserting %s is still refused', async (_label, headers) => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: url(closedMonth()),
      headers: { ...bearer(token), ...headers },
    });
    expect(res.statusCode).toBe(403);
    expect(monthMock).not.toHaveBeenCalled();
  });

  it('allows a marketing worker', async () => {
    monthMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url(closedMonth()), headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 1 });
  });
});

describe('the month is the month that was asked for', () => {
  it('binds the requested month to the warehouse query verbatim', async () => {
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url('2026-03-01'), headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(monthMock).toHaveBeenCalledWith('2026-03-01');
    expect(res.json()).toMatchObject({ month: '2026-03-01', basisMonth: '2026-02-01' });
  });

  it('crosses a year boundary backwards, not to month zero', async () => {
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url('2026-01-01'), headers: bearer(token) });
    expect(res.json()).toMatchObject({ month: '2026-01-01', basisMonth: '2025-12-01' });
  });

  it('refuses a future month instead of clamping it to today', async () => {
    const token = await workerToken('Marketing');
    const next = new Date();
    const future = `${next.getUTCFullYear() + 1}-05-01`;
    const res = await app.inject({ method: 'GET', url: url(future), headers: bearer(token) });
    expect(res.statusCode).toBe(400);
    expect(monthMock).not.toHaveBeenCalled();
  });

  it.each(['2026-07', '2026-07-15', 'july', ''])('rejects the malformed month %o', async (month) => {
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url(month), headers: bearer(token) });
    expect(res.statusCode).toBe(400);
    expect(monthMock).not.toHaveBeenCalled();
  });

  it('refuses a month beyond the 36-month window', async () => {
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url('2015-01-01'), headers: bearer(token) });
    expect(res.statusCode).toBe(400);
    expect(monthMock).not.toHaveBeenCalled();
  });
});

describe('a stored tier is never backdated', () => {
  it('withholds the warehouse tier for a closed month', async () => {
    monthMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url(closedMonth()), headers: bearer(token) });
    const body = res.json() as { monthComplete: boolean; clients: { retainedTierName: string }[] };
    expect(body.monthComplete).toBe(true);
    // `dim_company.tier_name` still says Gold; that is TODAY's tier, so it must not leak into a
    // historical row where it would silently promote a dormant carrier.
    expect(body.clients[0]!.retainedTierName).toBe('');
  });

  it('forwards the warehouse tier for the month in progress, so the export matches the board', async () => {
    monthMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url(currentMonth()), headers: bearer(token) });
    const body = res.json() as { monthComplete: boolean; clients: { retainedTierName: string }[] };
    expect(body.monthComplete).toBe(false);
    expect(body.clients[0]!.retainedTierName).toBe('Gold');
  });
});

describe('failure modes stay distinguishable', () => {
  it('reports a warehouse failure as a retryable 502', async () => {
    monthMock.mockRejectedValueOnce(new Error('statement timeout'));
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url(closedMonth()), headers: bearer(token) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'LOYALTY_DATA_UNAVAILABLE' } });
  });

  it('still exports the automatic program when override storage is unavailable', async () => {
    monthMock.mockResolvedValue([SAMPLE]);
    overrideListMock.mockRejectedValueOnce(new Error('relation does not exist'));
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: url(closedMonth()), headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ clients: [{ loyaltyOverride: null }] });
  });
});
