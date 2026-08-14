/**
 * Verification Mytrion cases (`/v1/verification/cases*`) — department RBAC + list DTO shape.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/verification/verificationCases.js', () => ({
  listVerificationCases: vi.fn(async () => ({
    items: [],
    aggregates: { open: 0, shared: 0, inProgress: 0, awaitingDecision: 0, unmatched: 0, total: 0 },
    total: 0,
  })),
  getVerificationCase: vi.fn(),
  refreshVerificationCase: vi.fn(),
  runVerificationCaseStage: vi.fn(),
  approveVerificationCaseStage: vi.fn(),
  decideVerificationCase: vi.fn(),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { AppError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import {
  getVerificationCase,
  listVerificationCases,
  runVerificationCaseStage,
} from '../../src/modules/verification/verificationCases.js';

const listMock = vi.mocked(listVerificationCases);
const getMock = vi.mocked(getVerificationCase);
const runMock = vi.mocked(runVerificationCaseStage);

const emptyList = {
  items: [],
  aggregates: { open: 0, shared: 0, inProgress: 0, awaitingDecision: 0, unmatched: 0, total: 0 },
  total: 0,
};

const detail = {
  case: {
    id: 'vc_1',
    zohoDealId: '555',
    zohoApplicationId: null,
    requestId: '555',
    companyName: 'Acme',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: null,
    phone: null,
    dot: '123',
    mc: null,
    zohoStage: 'Application Filled',
    applicationStatus: null,
    applicationDate: '2026-08-01',
    creditScore: null,
    distributeType: 'shared' as const,
    ownerZohoUserId: '99',
    ownerName: 'Sarvar Asqarov',
    matchedSnapshotId: null,
    matchedVia: null,
    carrierOperatingStatus: null,
    status: 'in_progress' as const,
    currentStage: 'fmcsa',
    stagesDone: 1,
    stagesTotal: 10,
    lastDecision: null,
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  stages: [],
  catalog: [],
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
  listMock.mockResolvedValue(emptyList);
  getMock.mockResolvedValue(detail);
  runMock.mockResolvedValue(detail);
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

describe('Verification cases — auth', () => {
  it('GET /verification/cases refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/verification/cases' });
    expect(res.statusCode).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('GET /verification/cases REFUSES a sales worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/cases',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('GET /verification/cases allows a verification worker and returns camelCase aggregates', async () => {
    listMock.mockResolvedValueOnce({
      items: [detail.case],
      aggregates: { open: 1, shared: 1, inProgress: 1, awaitingDecision: 0, unmatched: 1, total: 1 },
      total: 1,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/cases?q=acme',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      total: 1,
      aggregates: { open: 1, shared: 1, inProgress: 1, unmatched: 1 },
      items: [{ id: 'vc_1', companyName: 'Acme', ownerName: 'Sarvar Asqarov' }],
    });
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({ query: 'acme' }),
    );
  });

  it('GET /verification/cases surfaces a missing-schema 503', async () => {
    listMock.mockRejectedValueOnce(
      new AppError('Verification cases are not on this database (example.host) yet.', {
        statusCode: 503,
        code: 'VERIFICATION_CASES_NOT_MIGRATED',
        expose: true,
      }),
    );
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/cases?limit=25&offset=0',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({
      code: 'VERIFICATION_CASES_NOT_MIGRATED',
      message: expect.stringContaining('not on this database'),
    });
  });

  it('POST stage run refuses a non-verification worker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/cases/vc_1/stages/fmcsa/run',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
  });
});
