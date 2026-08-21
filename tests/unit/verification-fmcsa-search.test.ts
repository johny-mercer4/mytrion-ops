/**
 * Data Center FMCSA search (`GET /v1/verification/flow/fmcsa/search`).
 *
 * Thin wrap of `lookupFmcsaCarrier`: one QCMobile key per call, verification-gated, no case write.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const lookupFmcsaCarrier = vi.fn();

vi.mock('../../src/integrations/fmcsaQcMobile.js', () => ({
  isFmcsaConfigured: () => true,
  lookupFmcsaCarrier: (...args: unknown[]) => lookupFmcsaCarrier(...args),
  fetchFmcsaAuthority: vi.fn(),
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
  lookupFmcsaCarrier.mockReset();
  lookupFmcsaCarrier.mockResolvedValue({
    available: true,
    error: null,
    reason: null,
    matchedOn: 'dot',
    carrier: { legalName: 'Ridgevale Freight', dotNumber: '987654', status: 'active' },
    candidates: [],
    candidatesTruncated: false,
    notFound: false,
    retrievalDate: '2026-08-21T00:00:00.000Z',
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

describe('GET /verification/flow/fmcsa/search', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=dot&q=987654',
    });
    expect(res.statusCode).toBe(401);
    expect(lookupFmcsaCarrier).not.toHaveBeenCalled();
  });

  it('refuses a sales-only worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=dot&q=987654',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(lookupFmcsaCarrier).not.toHaveBeenCalled();
  });

  it('asks QCMobile by USDOT only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=dot&q=987654',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(lookupFmcsaCarrier).toHaveBeenCalledWith({ dot: '987654' });
    expect(res.json().carrier.legalName).toBe('Ridgevale Freight');
  });

  it('asks QCMobile by MC only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=mc&q=MC-123456',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(lookupFmcsaCarrier).toHaveBeenCalledWith({ mc: 'MC-123456' });
  });

  it('asks QCMobile by legal name only', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=name&q=Ridgevale%20Freight',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(lookupFmcsaCarrier).toHaveBeenCalledWith({ name: 'Ridgevale Freight' });
  });

  it('rejects a missing query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=dot',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(lookupFmcsaCarrier).not.toHaveBeenCalled();
  });

  it('rejects an unknown key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=ein&q=12-3456789',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(lookupFmcsaCarrier).not.toHaveBeenCalled();
  });

  it('passes a vendor miss through as 200, not a clear', async () => {
    lookupFmcsaCarrier.mockResolvedValue({
      available: false,
      error: 'HTTP 403 — this egress IP is denied at the FMCSA edge; permanent, not retried',
      reason: 'blocked',
      matchedOn: null,
      carrier: null,
      candidates: [],
      candidatesTruncated: false,
      notFound: false,
      retrievalDate: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/fmcsa/search?by=dot&q=987654',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().available).toBe(false);
    expect(res.json().reason).toBe('blocked');
  });
});
