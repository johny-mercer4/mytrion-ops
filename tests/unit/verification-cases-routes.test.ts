/**
 * Verification Mytrion cases (`/v1/verification/cases*`) — department RBAC + list DTO shape.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { emptyAggregates } = vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  return {
    emptyAggregates: {
      open: 0,
      shared: 0,
      inProgress: 0,
      awaitingDecision: 0,
      unmatched: 0,
      total: 0,
      new: 0,
      approved: 0,
      rejected: 0,
      failed: 0,
      unclaimed: 0,
      mine: 0,
      stale: 0,
    },
  };
});

vi.mock('../../src/modules/verification/verificationCases.js', () => ({
  listVerificationCases: vi.fn(async () => ({
    items: [],
    aggregates: {
      open: 0,
      shared: 0,
      inProgress: 0,
      awaitingDecision: 0,
      unmatched: 0,
      total: 0,
      new: 0,
      approved: 0,
      rejected: 0,
      failed: 0,
      unclaimed: 0,
      mine: 0,
      stale: 0,
    },
    total: 0,
  })),
  getVerificationCase: vi.fn(),
  refreshVerificationCase: vi.fn(),
  runVerificationCaseStage: vi.fn(),
  approveVerificationCaseStage: vi.fn(),
  resetVerificationCaseStage: vi.fn(),
  decideVerificationCase: vi.fn(),
}));

vi.mock('../../src/modules/verification/verificationCaseQueue.js', () => ({
  claimVerificationCase: vi.fn(),
  releaseVerificationCase: vi.fn(),
  transferVerificationCaseUnavailable: vi.fn(),
  generateVerificationPlaidLink: vi.fn(),
  parseVerificationBankStatements: vi.fn(),
  runVerificationIsoftpullAll: vi.fn(),
  exportVerificationCases: vi.fn(),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { AppError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import {
  getVerificationCase,
  listVerificationCases,
  resetVerificationCaseStage,
  runVerificationCaseStage,
} from '../../src/modules/verification/verificationCases.js';
import {
  claimVerificationCase,
  exportVerificationCases,
  generateVerificationPlaidLink,
  transferVerificationCaseUnavailable,
} from '../../src/modules/verification/verificationCaseQueue.js';

const listMock = vi.mocked(listVerificationCases);
const getMock = vi.mocked(getVerificationCase);
const runMock = vi.mocked(runVerificationCaseStage);
const resetMock = vi.mocked(resetVerificationCaseStage);
const claimMock = vi.mocked(claimVerificationCase);
const exportMock = vi.mocked(exportVerificationCases);
const plaidMock = vi.mocked(generateVerificationPlaidLink);
const transferMock = vi.mocked(transferVerificationCaseUnavailable);

const emptyList = {
  items: [],
  aggregates: emptyAggregates,
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
    firstRunStatus: 'idle' as const,
    firstRunError: null,
    cpOwnerUsername: null,
    approvedLimit: null,
    paymentType: null,
    billingCycle: null,
    plaidStatus: null,
    plaidLinkUrl: null,
    plaidMode: null,
    slaStale: false,
    slaIdleMinutes: 0,
    slaLabel: 'Unclaimed',
    createdAt: '2026-08-01T00:00:00.000Z',
  },
  stages: [],
  catalog: [],
  attachments: [],
  readiness: null,
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
  resetMock.mockResolvedValue(detail);
  claimMock.mockResolvedValue(detail);
  exportMock.mockResolvedValue({
    filename: 'verification-cases-2026-08-14.csv',
    csv: 'Company,Zoho id,DOT,Status,Queue,Owner,Limit,Payment,Cycle\n',
  });
  plaidMock.mockResolvedValue({ status: 'queued', inboxId: 9 });
  transferMock.mockImplementation(() => {
    throw new AppError('Transfer is not on credit-platform HTTP yet.', {
      statusCode: 501,
      code: 'TRANSFER_UNAVAILABLE',
      expose: true,
    });
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
      aggregates: { ...emptyAggregates, open: 1, shared: 1, inProgress: 1, unmatched: 1, total: 1 },
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

  it('POST stage reset is verification-write and stays on HTTP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/cases/vc_1/stages/fmcsa/reset',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(resetMock).toHaveBeenCalled();
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

  it('GET /verification/cases forwards owner=unclaimed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/cases?owner=unclaimed',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({ owner: 'unclaimed' }),
    );
  });

  it('GET /verification/cases/export returns CSV columns', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/cases/export?status=new&owner=mine',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.body).toContain('Company,Zoho id,DOT,Status,Queue,Owner,Limit,Payment,Cycle');
    expect(exportMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({ status: 'new', owner: 'mine' }),
    );
  });

  it('POST claim is verification-write HTTP', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/cases/vc_1/claim',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(claimMock).toHaveBeenCalled();
  });

  it('POST transfer stays stubbed at 501', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/cases/vc_1/transfer',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(501);
    expect(res.json().error).toMatchObject({ code: 'TRANSFER_UNAVAILABLE' });
  });

  it('POST plaid-link queues write-back, not a stage run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/cases/vc_1/plaid-link',
      headers: bearer(await workerToken('Verification')),
      payload: { regenerate: true },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'queued', inboxId: 9 });
    expect(plaidMock).toHaveBeenCalledWith(expect.anything(), 'vc_1', true);
    expect(runMock).not.toHaveBeenCalled();
  });

  it('POST stage run forwards bureauProvider for iSoftPull chips', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/cases/vc_1/stages/isoftpull/run',
      headers: bearer(await workerToken('Verification')),
      payload: { bureauProvider: 'isoftpull_equifax' },
    });
    expect(res.statusCode).toBe(200);
    expect(runMock).toHaveBeenCalledWith(
      expect.anything(),
      'vc_1',
      'isoftpull',
      { bureauProvider: 'isoftpull_equifax' },
    );
  });
});
