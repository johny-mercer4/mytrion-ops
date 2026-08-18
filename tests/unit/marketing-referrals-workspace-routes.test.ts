import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { workspaceMock } = vi.hoisted(() => ({
  workspaceMock: vi.fn(async (_ctx: unknown, periodMonth: string) => ({
    periodMonth,
    generatedAt: '2026-07-29T00:00:00.000Z',
    parents: { module: 'Parent_Referrers', moduleKey: 'parents', fields: [], rows: [], total: 0 },
    children: { module: 'Child_Referrals', moduleKey: 'children', fields: [], rows: [], total: 0 },
    associations: {
      leads: { module: 'Leads', fields: [], rows: [], total: 0 },
      deals: { module: 'Deals', fields: [], rows: [], total: 0 },
    },
    previews: [],
    unresolvedChildIds: [],
    skippedNoCalculationChildIds: [],
    summary: {
      parents: 0,
      configuredParents: 0,
      children: 0,
      relatedDeals: 0,
      connectedCarriers: 0,
      needsDealLink: 0,
      needsCalculation: 0,
      earned: 0,
      tracking: 0,
      paid: 0,
      payableAmountUsd: '0.00',
    },
  })),
}));

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/manager/referralWorkspace.js', () => ({
  fetchReferralWorkspace: workspaceMock,
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => workspaceMock.mockClear());

async function token(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Manager', profile },
  });
}

const bearer = async (profile: string): Promise<Record<string, string>> => ({
  authorization: `Bearer ${await token(profile)}`,
});

describe('Marketing referral workspace route', () => {
  it('requires authentication before touching Zoho or MART', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/marketing/referrals/workspace' });
    expect(response.statusCode).toBe(401);
    expect(workspaceMock).not.toHaveBeenCalled();
  });

  it('rejects workers outside Marketing', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace',
      headers: await bearer('Sales Rep'),
    });
    expect(response.statusCode).toBe(403);
    expect(workspaceMock).not.toHaveBeenCalled();
  });

  it('passes an explicit calendar month and tenant context to the workspace', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_month=2026-06-01',
      headers: await bearer('Marketing'),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ periodMonth: '2026-06-01' });
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      '2026-06-01',
      { force: false, periodTo: '2026-06-30' },
    );
  });

  it('forces a new calculation only when Refresh requests it', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_month=2026-06-01&refresh=1',
      headers: await bearer('Marketing'),
    });
    expect(response.statusCode).toBe(200);
    expect(workspaceMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      '2026-06-01',
      { force: true, periodTo: '2026-06-30' },
    );
  });

  it('passes an inclusive day range without dropping period_month shorthand', async () => {
    const range = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_from=2026-07-15&period_to=2026-08-20',
      headers: await bearer('Marketing'),
    });
    const sameDay = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_from=2026-08-16&period_to=2026-08-16',
      headers: await bearer('Marketing'),
    });
    expect(range.statusCode).toBe(200);
    expect(sameDay.statusCode).toBe(200);
    expect(workspaceMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      '2026-07-15',
      { force: false, periodTo: '2026-08-20' },
    );
    expect(workspaceMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      '2026-08-16',
      { force: false, periodTo: '2026-08-16' },
    );
  });

  it('rejects a partial month before any source read', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_month=2026-06-15',
      headers: await bearer('Marketing'),
    });
    expect(response.statusCode).toBe(400);
    expect(workspaceMock).not.toHaveBeenCalled();
  });

  it('rejects a one-sided range, an impossible day, and a span longer than a year', async () => {
    const missingTo = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_from=2026-01-01',
      headers: await bearer('Marketing'),
    });
    const impossible = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_from=2026-02-31&period_to=2026-03-01',
      headers: await bearer('Marketing'),
    });
    const tooLong = await app.inject({
      method: 'GET',
      url: '/v1/marketing/referrals/workspace?period_from=2025-01-01&period_to=2026-02-01',
      headers: await bearer('Marketing'),
    });
    expect(missingTo.statusCode).toBe(400);
    expect(impossible.statusCode).toBe(400);
    expect(tooLong.statusCode).toBe(400);
    expect(workspaceMock).not.toHaveBeenCalled();
  });
});
