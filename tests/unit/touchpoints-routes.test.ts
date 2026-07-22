/**
 * /v1/touchpoints over HTTP. Coverage: discovery listing (filtered by caller authority),
 * dispatch through a real session (department view from the body, like every other
 * surface), customer-session denial, unknown-key 404, and the audit trail on writes.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.SERVER_CRM_URL = 'https://crm.example.com';
  process.env.SERVER_CRM_KEY = 'srv-key';
});

const { executeFallbackMock, serverCrmRequestMock, assertOwnedMock } = vi.hoisted(() => ({
  executeFallbackMock: vi.fn(),
  serverCrmRequestMock: vi.fn(),
  assertOwnedMock: vi.fn(),
}));
vi.mock('../../src/integrations/zohoFunctions.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoFunctions.js')>();
  return { ...mod, executeZohoFunctionWithFallback: executeFallbackMock };
});
vi.mock('../../src/integrations/serverCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/serverCrm.js')>();
  return { ...mod, serverCrmRequest: serverCrmRequestMock };
});
vi.mock('../../src/modules/tools/serverCrmScope.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/tools/serverCrmScope.js')>();
  return { ...mod, assertCarrierOwned: assertOwnedMock };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

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
  assertOwnedMock.mockResolvedValue(undefined);
  serverCrmRequestMock.mockResolvedValue({ success: true });
  executeFallbackMock.mockResolvedValue({ status: 'success' });
});

const API_KEY_HEADERS = { 'x-api-key': 'test-secret-key', 'content-type': 'application/json' };

async function salesToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId: '42', userName: 'Robiya', profile: 'Sales Rep' },
  });
}

describe('GET /v1/touchpoints (discovery)', () => {
  it('lists the full catalog for the API key (admin system identity)', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/touchpoints', headers: API_KEY_HEADERS });
    expect(res.statusCode).toBe(200);
    const { touchpoints } = res.json() as { touchpoints: Array<{ key: string }> };
    expect(touchpoints.length).toBe(106);
    expect(touchpoints.map((t) => t.key)).toContain('dwh.carrier_balance');
  });

  it('lists sales entries for a sales worker declaring the department view', async () => {
    const token = await salesToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/touchpoints?department_access=sales',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { touchpoints: unknown[] }).touchpoints.length).toBeGreaterThan(0);
  });
});

describe('POST /v1/touchpoints/:key', () => {
  it('executes a read for a sales worker and returns { key, data }', async () => {
    serverCrmRequestMock.mockResolvedValueOnce({ success: true, balance: 812.4 });
    const token = await salesToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/dwh.carrier_balance',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { departmentAccess: ['sales'], params: { carrierId: '123' } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ key: 'dwh.carrier_balance', data: { balance: 812.4 } });
    // reads are not audited on success
    expect(auditFromContext).not.toHaveBeenCalled();
  });

  it('denies a worker whose department view lacks sales (audited)', async () => {
    const token = await salesToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/dwh.carrier_balance',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { departmentAccess: ['billing'], params: { carrierId: '123' } },
    });
    expect(res.statusCode).toBe(403);
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'touchpoint.dwh.carrier_balance', status: 'denied' }),
    );
  });

  it('denies a carrier-client (customer) session outright', async () => {
    const token = await signAccessToken({
      userId: 'client:cu_1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: 'cu_1', clientProfile: 'owner', carrierId: '123' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/dwh.carrier_balance',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { params: { carrierId: '123' } },
    });
    expect(res.statusCode).toBe(403);
  });

  it('audits a destructive invocation (ok) with business detail', async () => {
    executeFallbackMock.mockResolvedValueOnce({ newStatus: 'INACTIVE' });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/cards.status',
      headers: API_KEY_HEADERS,
      payload: { params: { carrierId: '9', cardNumber: '7083051234', action: 'DEACTIVATE' } },
    });
    expect(res.statusCode).toBe(200);
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'touchpoint.cards.status',
        status: 'ok',
        resourceType: 'touchpoint',
        detail: expect.objectContaining({ riskClass: 'destructive', carrierId: '9' }),
      }),
    );
  });

  it('404s an unknown key and 400s invalid params', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/not.a.touchpoint',
      headers: API_KEY_HEADERS,
      payload: { params: {} },
    });
    expect(missing.statusCode).toBe(404);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/cards.status',
      headers: API_KEY_HEADERS,
      payload: { params: { carrierId: '9', cardNumber: '7083051234', action: 'DELETE' } },
    });
    expect(invalid.statusCode).toBe(400);
    expect(executeFallbackMock).not.toHaveBeenCalled();
  });

  it('accepts GET for a read touchpoint (clients.by_agent) — proxy/redirect safety', async () => {
    serverCrmRequestMock.mockResolvedValueOnce({ success: true, data: [] });
    const token = await salesToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/touchpoints/clients.by_agent?department_access=sales',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ key: 'clients.by_agent' });
    expect(serverCrmRequestMock).toHaveBeenCalledWith(
      'GET',
      expect.stringMatching(/\/api\/clients\/by-agent\//),
      expect.anything(),
    );
  });

  it('rejects GET for a write/destructive touchpoint', async () => {
    const token = await salesToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/touchpoints/cards.status',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(405);
    expect(executeFallbackMock).not.toHaveBeenCalled();
  });
});
