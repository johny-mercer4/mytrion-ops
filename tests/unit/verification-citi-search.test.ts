/**
 * Data Center CITI Fuel search (`GET /v1/verification/flow/citi/search`).
 *
 * Thin wrap of `searchCitifuel`: verification-gated, no case write. Zoho down is 200.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const searchCitifuel = vi.fn();

vi.mock('../../src/modules/verificationFlow/citiSearch.js', () => ({
  searchCitifuel: (...args: unknown[]) => searchCitifuel(...args),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
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
  searchCitifuel.mockReset();
  searchCitifuel.mockResolvedValue({
    available: true,
    error: null,
    matchedOn: 'dot',
    notFound: false,
    truncated: false,
    records: [{ dealId: '1', dealName: 'Kaiser Freight LLC', citifuelStatus: 'yes' }],
  });
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('GET /verification/flow/citi/search', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=dot&q=3921884',
    });
    expect(res.statusCode).toBe(401);
    expect(searchCitifuel).not.toHaveBeenCalled();
  });

  it('refuses a sales-only worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=dot&q=3921884',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(searchCitifuel).not.toHaveBeenCalled();
  });

  it('asks Deals by USDOT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=dot&q=3921884',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchCitifuel).toHaveBeenCalledWith(expect.objectContaining({ by: 'dot', q: '3921884' }));
    expect(res.json().records[0].dealName).toBe('Kaiser Freight LLC');
  });

  it('accepts MC, email, and name keys', async () => {
    const mc = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=mc&q=778211',
      headers: bearer(await workerToken('Verification')),
    });
    expect(mc.statusCode).toBe(200);
    expect(searchCitifuel).toHaveBeenCalledWith(expect.objectContaining({ by: 'mc', q: '778211' }));

    const email = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=email&q=ops%40kaiser.test',
      headers: bearer(await workerToken('Verification')),
    });
    expect(email.statusCode).toBe(200);
    expect(searchCitifuel).toHaveBeenCalledWith(expect.objectContaining({ by: 'email', q: 'ops@kaiser.test' }));

    const name = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=name&q=Kaiser%20Freight',
      headers: bearer(await workerToken('Verification')),
    });
    expect(name.statusCode).toBe(200);
    expect(searchCitifuel).toHaveBeenCalledWith(expect.objectContaining({ by: 'name', q: 'Kaiser Freight' }));
  });

  it('forwards page and pageSize onto queryDealsForNeedles', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=dot&q=3921884&page=2&pageSize=200',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchCitifuel).toHaveBeenCalledWith(
      expect.objectContaining({ by: 'dot', q: '3921884', page: 2, pageSize: 200 }),
    );
  });

  it('rejects phone — that COQL does not filter on it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=phone&q=6145550110',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(searchCitifuel).not.toHaveBeenCalled();
  });

  it('passes Zoho down through as 200, not 403', async () => {
    searchCitifuel.mockResolvedValue({
      available: false,
      error: '[zoho-crm] COQL HTTP 500',
      matchedOn: null,
      notFound: false,
      truncated: false,
      records: [],
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/citi/search?by=dot&q=3921884',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
  });
});
