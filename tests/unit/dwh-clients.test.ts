/**
 * DWH client directory — search semantics over octane.intm_zoho_deals (mocked dwhQuery)
 * and the admin route gate. Clients must be searchable by company name, carrier id, or
 * application id, newest applications first, active rows only.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.DWH_DATABASE_URL = 'postgres://dwh.example/analytics';
});

vi.mock('../../src/integrations/dwh.js', () => ({
  dwhQuery: vi.fn(async () => []),
  getDwhPool: vi.fn(),
  closeDwhPool: vi.fn(async () => undefined),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { dwhQuery } from '../../src/integrations/dwh.js';
import { searchDwhClients } from '../../src/integrations/dwhClients.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const query = vi.mocked(dwhQuery);

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

beforeEach(() => query.mockClear());

describe('searchDwhClients — query construction', () => {
  it('browse mode: active rows only, newest application first', async () => {
    await searchDwhClients({});
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('octane.intm_zoho_deals');
    expect(sql).toContain('is_active = true');
    expect(sql).toContain('order by application_date desc nulls last');
    expect(sql).toContain('limit 25');
    expect(params).toEqual([]);
  });

  it('text search matches the company name (ILIKE, contains)', async () => {
    await searchDwhClients({ q: 'grant express' });
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('deal_name ilike $1');
    expect(sql).not.toContain('carrier_id::text');
    expect(params).toEqual(['%grant express%']);
  });

  it('numeric search matches company name AND carrier/application ids by prefix', async () => {
    await searchDwhClients({ q: '58353' });
    const [sql, params] = query.mock.calls.at(-1) as [string, unknown[]];
    expect(sql).toContain('deal_name ilike $1');
    expect(sql).toContain('carrier_id::text like $2');
    expect(sql).toContain('application_id::text like $2');
    expect(params).toEqual(['%58353%', '58353%']);
  });

  it('maps rows to the wire DTO (string ids, ISO date)', async () => {
    query.mockResolvedValueOnce([
      {
        deal_name: 'GRANT EXPRESS LLC',
        stage: 'Application Approved',
        carrier_id: 5837332,
        application_id: 892408,
        application_date: new Date('2026-07-02T19:00:00.000Z'),
        owner_id: '6227679000162257005',
      },
    ]);
    const clients = await searchDwhClients({ q: 'grant' });
    expect(clients[0]).toEqual({
      companyName: 'GRANT EXPRESS LLC',
      stage: 'Application Approved',
      carrierId: '5837332',
      applicationId: '892408',
      applicationDate: '2026-07-02',
      ownerZohoUserId: '6227679000162257005',
    });
  });

  it('caps the limit at 100', async () => {
    await searchDwhClients({ limit: 5000 });
    expect((query.mock.calls.at(-1) as [string])[0]).toContain('limit 100');
  });
});

describe('GET /v1/carrier-clients — admin gate + wiring', () => {
  it('returns directory results for the API key admin', async () => {
    query.mockResolvedValueOnce([
      {
        deal_name: 'Acme',
        stage: 'Card Funded',
        carrier_id: 1,
        application_id: 2,
        application_date: '2026-07-01',
        owner_id: null,
      },
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-clients?q=acme&limit=10',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { clients: Array<{ companyName: string }> };
    expect(body.clients[0]?.companyName).toBe('Acme');
  });

  it('denies non-admin workers', async () => {
    const token = await signAccessToken({
      userId: 'zoho:42',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'admin',
      worker: { zohoUserId: '42', profile: 'Sales Rep' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-clients',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('maps DWH failures to a 502 (not a raw 500)', async () => {
    query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-clients',
      headers: { 'x-api-key': 'test-secret-key' },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'DWH_ERROR' } });
  });
});
