import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.DWH_DATABASE_URL = 'postgres://user:pass@localhost:5432/dwh';
});

vi.mock('../../src/modules/analytics/mytrionUsageService.js', () => ({
  getSalesMytrionUsage: vi.fn(async () => ({
    scope: { mytrion: 'sales', population: 'sales_agent' },
    timeZone: 'America/New_York',
    range: { preset: 'today', from: '2026-08-18', to: '2026-08-18' },
    computedAt: '2026-08-18T12:00:00Z',
    population: { eligibleAgents: 0 },
    coverage: [], summary: {}, days: [], agents: [], breakdowns: {},
  })),
}));
vi.mock('../../src/modules/analytics/cache.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/analytics/cache.js')>();
  return { ...mod, getAnalyticsSnapshot: vi.fn(async () => ({ block: {} })) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { AppError } from '../../src/lib/errors.js';
import { getAnalyticsSnapshot } from '../../src/modules/analytics/cache.js';
import { getSalesMytrionUsage } from '../../src/modules/analytics/mytrionUsageService.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const usageMock = vi.mocked(getSalesMytrionUsage);
const genericMock = vi.mocked(getAnalyticsSnapshot);
let app: FastifyInstance;

async function token(profile: string, id = '42', audience: 'internal' | 'customer' = 'internal'): Promise<string> {
  if (audience === 'customer') {
    return signAccessToken({
      userId: 'client:1', tenantId: DEFAULT_TENANT_ID, audience, role: 'viewer',
      client: { carrierUserId: '1', clientProfile: 'owner', carrierId: '9' },
    });
  }
  return signAccessToken({
    userId: `zoho:${id}`,
    tenantId: DEFAULT_TENANT_ID,
    audience,
    role: 'admin',
    worker: { zohoUserId: id, userName: `Worker ${id}`, profile },
  });
}

const bearer = (value: string): Record<string, string> => ({ authorization: `Bearer ${value}` });

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());
beforeEach(() => vi.clearAllMocks());

describe('GET /v1/analytics/mytrion/sales', () => {
  it('is session-only and refuses API-key, Sales, and customer callers', async () => {
    const apiKey = await app.inject({ method: 'GET', url: '/v1/analytics/mytrion/sales', headers: { 'x-api-key': 'test-secret-key' } });
    expect(apiKey.statusCode).toBe(401);
    for (const auth of [await token('Sales Agent'), await token('Carrier', 'c1', 'customer')]) {
      const response = await app.inject({ method: 'GET', url: '/v1/analytics/mytrion/sales', headers: bearer(auth) });
      expect(response.statusCode).toBe(403);
    }
    expect(usageMock).not.toHaveBeenCalled();
  });

  it('allows Analytics and administrator sessions and passes the tenant context', async () => {
    for (const profile of ['Analytics', 'Administrator']) {
      const response = await app.inject({
        method: 'GET',
        url: '/v1/analytics/mytrion/sales?range=custom&from=2026-08-01&to=2026-08-02&fresh=1',
        headers: bearer(await token(profile)),
      });
      expect(response.statusCode, response.body).toBe(200);
    }
    expect(usageMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({ preset: 'custom', from: '2026-08-01', to: '2026-08-02' }),
      true,
    );
    expect(usageMock.mock.calls.some(([context]) => context.allDepartmentAccess)).toBe(true);
  });

  it('returns 503 instead of a subset-derived snapshot when the directory is unusable', async () => {
    usageMock.mockRejectedValueOnce(new AppError('Directory unavailable', {
      statusCode: 503, code: 'MYTRION_USAGE_DIRECTORY_UNAVAILABLE', expose: true,
    }));
    const response = await app.inject({
      method: 'GET', url: '/v1/analytics/mytrion/sales',
      headers: bearer(await token('Analytics')),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      error: { code: 'MYTRION_USAGE_DIRECTORY_UNAVAILABLE' },
    });
  });
});

describe('generic Analytics self scope', () => {
  it('forces a non-elevated session to itself when agent filters are omitted', async () => {
    const response = await app.inject({
      method: 'GET', url: '/v1/analytics/sales', headers: bearer(await token('Sales Agent', '42')),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(genericMock).toHaveBeenCalledWith(
      'sales',
      expect.objectContaining({ filters: expect.objectContaining({ agentId: '42' }) }),
    );
  });

  it('drops a forged agent name while forcing the caller id', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/analytics/sales?agent_name=Victim',
      headers: bearer(await token('Sales Agent', '42')),
    });
    const options = genericMock.mock.calls.at(-1)?.[1];
    expect(options?.filters).toEqual(expect.objectContaining({ agentId: '42' }));
    expect(options?.filters).not.toHaveProperty('agentName');
  });

  it('fails closed when a non-elevated internal session has no agent identity', async () => {
    const auth = await signAccessToken({
      userId: 'local-user', tenantId: DEFAULT_TENANT_ID, audience: 'internal', role: 'viewer',
    });
    const response = await app.inject({
      method: 'GET', url: '/v1/analytics/sales', headers: bearer(auth),
    });
    expect(response.statusCode).toBe(403);
    expect(genericMock).not.toHaveBeenCalled();
  });
});
