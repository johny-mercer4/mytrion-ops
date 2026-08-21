/**
 * Data Center Blacklist search (`GET /v1/verification/flow/blacklist/search`).
 *
 * Thin wrap of `searchBlacklist`: verification-gated, no case write. A down probe is 200.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const searchBlacklist = vi.fn();

vi.mock('../../src/modules/verificationFlow/blacklistSearch.js', () => ({
  searchBlacklist: (...args: unknown[]) => searchBlacklist(...args),
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
  searchBlacklist.mockReset();
  searchBlacklist.mockResolvedValue({
    matchedOn: 'dot',
    ban: { available: true, error: null, hits: [], ownAvailable: true, platformAvailable: true },
    duplicates: { available: true, error: null, hits: [], casesAvailable: true, dealsAvailable: true },
    debtors: { available: true, error: null, records: [] },
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

describe('GET /verification/flow/blacklist/search', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=dot&q=987654',
    });
    expect(res.statusCode).toBe(401);
    expect(searchBlacklist).not.toHaveBeenCalled();
  });

  it('refuses a sales-only worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=dot&q=987654',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(searchBlacklist).not.toHaveBeenCalled();
  });

  it('asks the three probes by USDOT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=dot&q=987654',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchBlacklist).toHaveBeenCalledWith(expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }), {
      by: 'dot',
      q: '987654',
    });
    expect(res.json().matchedOn).toBe('dot');
  });

  it('accepts email and phone keys', async () => {
    const email = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=email&q=ops%40kaiser.test',
      headers: bearer(await workerToken('Verification')),
    });
    expect(email.statusCode).toBe(200);
    expect(searchBlacklist).toHaveBeenCalledWith(expect.anything(), { by: 'email', q: 'ops@kaiser.test' });

    const phone = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=phone&q=6145550110',
      headers: bearer(await workerToken('Verification')),
    });
    expect(phone.statusCode).toBe(200);
    expect(searchBlacklist).toHaveBeenCalledWith(expect.anything(), { by: 'phone', q: '6145550110' });
  });

  it('rejects an unknown key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=ein&q=12-3456789',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(searchBlacklist).not.toHaveBeenCalled();
  });

  it('passes a down probe through as 200, not 403', async () => {
    searchBlacklist.mockResolvedValue({
      matchedOn: 'dot',
      ban: {
        available: false,
        error: 'VERIFICATION_DATABASE_URL is not configured',
        hits: [],
        ownAvailable: true,
        platformAvailable: false,
      },
      duplicates: { available: true, error: null, hits: [], casesAvailable: true, dealsAvailable: true },
      debtors: { available: false, error: 'DWH_DATABASE_URL is not configured', records: [] },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/blacklist/search?by=dot&q=987654',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ban.available).toBe(false);
    expect(res.json().debtors.available).toBe(false);
  });
});
