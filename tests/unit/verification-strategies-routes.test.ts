/**
 * Verification rules/strategies routes — department RBAC + write gate.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/verification/verificationStrategies.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/modules/verification/verificationStrategies.js')>();
  return {
    ...actual,
    listVerificationStopFactors: vi.fn(async () => ({ items: [] })),
    listVerificationStrategies: vi.fn(async () => ({ items: [] })),
    saveVerificationStopFactor: vi.fn(async () => ({ status: 'created', id: '1', item: null })),
    saveVerificationStrategy: vi.fn(async () => ({ status: 'created', id: 'std', item: null })),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import {
  listVerificationStopFactors,
  listVerificationStrategies,
  saveVerificationStopFactor,
  saveVerificationStrategy,
} from '../../src/modules/verification/verificationStrategies.js';

const listSf = vi.mocked(listVerificationStopFactors);
const listSt = vi.mocked(listVerificationStrategies);
const saveSf = vi.mocked(saveVerificationStopFactor);
const saveSt = vi.mocked(saveVerificationStrategy);

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
  listSf.mockResolvedValue({ items: [] });
  listSt.mockResolvedValue({ items: [] });
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

describe('Verification strategies — auth', () => {
  it('GET /verification/strategies refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/verification/strategies' });
    expect(res.statusCode).toBe(401);
    expect(listSt).not.toHaveBeenCalled();
  });

  it('GET /verification/stop-factors REFUSES a sales worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/stop-factors',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(listSf).not.toHaveBeenCalled();
  });

  it('GET /verification/strategies allows a verification worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/strategies',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(listSt).toHaveBeenCalled();
    expect(res.json()).toEqual({ items: [] });
  });

  it('POST /verification/stop-factors writes through the module', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/stop-factors',
      headers: { ...bearer(await workerToken('Verification')), 'content-type': 'application/json' },
      payload: { name: 'Min score', stage: 'pre', operator: 'gte', threshold: '500' },
    });
    expect(res.statusCode).toBe(200);
    expect(saveSf).toHaveBeenCalled();
  });

  it('PUT /verification/strategies/:id updates an existing strategy', async () => {
    saveSt.mockResolvedValue({ status: 'updated', id: 'standard-approval', item: null });
    const res = await app.inject({
      method: 'PUT',
      url: '/v1/verification/strategies/standard-approval',
      headers: { ...bearer(await workerToken('Verification')), 'content-type': 'application/json' },
      payload: { title: 'Standard approval', enabled: true, lifecycle: 'published' },
    });
    expect(res.statusCode).toBe(200);
    expect(saveSt).toHaveBeenCalled();
    expect(res.json()).toMatchObject({ status: 'updated', id: 'standard-approval' });
  });
});
