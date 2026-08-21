/**
 * Data Center Motus search (`GET /v1/verification/flow/motus/search`).
 *
 * Thin wrap of `searchMotus`: one Socrata key per call, verification-gated, no case write.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const searchMotus = vi.fn();

vi.mock('../../src/modules/verificationFlow/motusSearch.js', () => ({
  searchMotus: (...args: unknown[]) => searchMotus(...args),
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
  searchMotus.mockReset();
  searchMotus.mockResolvedValue({
    available: true,
    error: null,
    matchedOn: 'dot',
    notFound: false,
    census: {
      available: true,
      error: null,
      record: { legalName: 'STONE EXPRESS INC', dotNumber: '652739' },
      records: [{ legalName: 'STONE EXPRESS INC', dotNumber: '652739' }],
      truncated: false,
    },
    insurance: { available: true, error: null, frozen: true, dataAsOf: '2026-05-14', filings: [] },
    processAgents: { available: true, error: null, frozen: true, dataAsOf: '2026-05-14', agents: [] },
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

describe('GET /verification/flow/motus/search', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/motus/search?by=dot&q=652739',
    });
    expect(res.statusCode).toBe(401);
    expect(searchMotus).not.toHaveBeenCalled();
  });

  it('refuses a sales-only worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/motus/search?by=dot&q=652739',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(searchMotus).not.toHaveBeenCalled();
  });

  it('asks Socrata by USDOT', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/motus/search?by=dot&q=652739',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchMotus).toHaveBeenCalledWith({ by: 'dot', q: '652739' });
    expect(res.json().census.record.legalName).toBe('STONE EXPRESS INC');
  });

  it('asks Socrata by legal name', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/motus/search?by=name&q=STONE%20EXPRESS',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(searchMotus).toHaveBeenCalledWith({ by: 'name', q: 'STONE EXPRESS' });
  });

  it('rejects MC — that key is not a Socrata client', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/motus/search?by=mc&q=307348',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(searchMotus).not.toHaveBeenCalled();
  });

  it('passes a vendor miss through as 200, not a clear', async () => {
    searchMotus.mockResolvedValue({
      available: false,
      error: 'SOCRATA_BASE_URL is not configured',
      matchedOn: null,
      notFound: false,
      census: { available: false, error: 'SOCRATA_BASE_URL is not configured', record: null, records: [], truncated: false },
      insurance: null,
      processAgents: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/motus/search?by=dot&q=652739',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
  });
});
