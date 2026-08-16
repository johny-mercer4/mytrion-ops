/**
 * Verification desk underwriting routes (`/v1/verification/flow/*`) — department RBAC and the
 * validation that protects the money paths.
 *
 * The pair to `verification-applications-routes.test.ts`: these are VERIFICATION-gated, those are
 * SALES-gated, and both address the same rows.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/verificationFlow/deskService.js', () => ({
  deskService: {
    list: vi.fn(),
    detail: vi.fn(),
    decidePhase: vi.fn(),
    runScreening: vi.fn(),
    setScreeningVerdict: vi.fn(),
    saveCreditReview: vi.fn(),
    saveBankingReview: vi.fn(),
    saveRiskAssessment: vi.fn(),
    requestDocuments: vi.fn(),
    resumeAfterDocuments: vi.fn(),
    decide: vi.fn(),
  },
}));

vi.mock('../../src/modules/verificationFlow/documentService.js', () => ({
  documentService: { downloadUrl: vi.fn(), upload: vi.fn(), request: vi.fn(), remove: vi.fn(), list: vi.fn() },
}));

vi.mock('../../src/repos/verificationReviewRepo.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/repos/verificationReviewRepo.js')>(
      '../../src/repos/verificationReviewRepo.js',
    );
  return {
    ...actual,
    verificationPolicyRepo: { get: vi.fn(), update: vi.fn(), factors: vi.fn(), routing: vi.fn() },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { deskService } from '../../src/modules/verificationFlow/deskService.js';
import { documentService } from '../../src/modules/verificationFlow/documentService.js';
import { verificationPolicyRepo } from '../../src/repos/verificationReviewRepo.js';

const listMock = vi.mocked(deskService.list);
const detailMock = vi.mocked(deskService.detail);
const decidePhaseMock = vi.mocked(deskService.decidePhase);
const bankingMock = vi.mocked(deskService.saveBankingReview);
const riskMock = vi.mocked(deskService.saveRiskAssessment);
const decideMock = vi.mocked(deskService.decide);
const downloadMock = vi.mocked(documentService.downloadUrl);
const policyGetMock = vi.mocked(verificationPolicyRepo.get);
const policyUpdateMock = vi.mocked(verificationPolicyRepo.update);

const detail = {
  case: { id: 'vc_1', statusCode: 'in_review', phaseCode: 'p3_screening' },
  rail: [],
  principals: [],
  documents: [],
  events: [],
  screening: { hits: [], summary: { clear: true, unresolved: 0 } },
  credit: null,
  banking: null,
  risk: { recommendedLimit: '4560.00' },
} as unknown as Awaited<ReturnType<typeof deskService.detail>>;

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
  listMock.mockResolvedValue({ items: [], total: 0, aggregates: {} } as never);
  detailMock.mockResolvedValue(detail);
  decidePhaseMock.mockResolvedValue(detail);
  bankingMock.mockResolvedValue(detail);
  riskMock.mockResolvedValue(detail);
  decideMock.mockResolvedValue(detail);
  policyGetMock.mockResolvedValue({ tenantId: 'octane', strongFactor: '0.800' } as never);
  policyUpdateMock.mockResolvedValue({ tenantId: 'octane' } as never);
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

/**
 * A true admin session carries NO `worker` block. The worker profile is what resolves the effective
 * role, so a token claiming `role: 'admin'` alongside `profile: 'Verification'` is still a worker —
 * which is exactly why the policy gate has to be tested with both.
 */
async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'admin-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
  });
}
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('auth boundary', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/verification/flow/cases' });
    expect(res.statusCode).toBe(401);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('REFUSES a sales-only worker — underwriting is not theirs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(listMock).not.toHaveBeenCalled();
  });

  it('admits a verification worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(listMock).toHaveBeenCalled();
  });

  it('guards every underwriting write against a sales-only worker', async () => {
    const token = bearer(await workerToken('Sales Rep'));
    const writes = [
      '/v1/verification/flow/cases/vc_1/phases/p3_screening/decision',
      '/v1/verification/flow/cases/vc_1/screening/run',
      '/v1/verification/flow/cases/vc_1/credit-review',
      '/v1/verification/flow/cases/vc_1/banking-review',
      '/v1/verification/flow/cases/vc_1/risk',
      '/v1/verification/flow/cases/vc_1/decision',
      '/v1/verification/flow/cases/vc_1/documents/resume',
    ];
    for (const url of writes) {
      const res = await app.inject({ method: 'POST', url, headers: token, payload: {} });
      expect(res.statusCode, url).toBe(403);
    }
  });
});

describe('phase decision validation', () => {
  it('accepts a known outcome', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/phases/p3_screening/decision',
      headers: bearer(await workerToken('Verification')),
      payload: { outcome: 'pass' },
    });
    expect(res.statusCode).toBe(200);
    expect(decidePhaseMock).toHaveBeenCalledWith(expect.anything(), 'vc_1', 'p3_screening', {
      outcome: 'pass',
    });
  });

  it('rejects an invented outcome rather than storing it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/phases/p3_screening/decision',
      headers: bearer(await workerToken('Verification')),
      payload: { outcome: 'looks_fine_to_me' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(decidePhaseMock).not.toHaveBeenCalled();
  });
});

describe('banking review', () => {
  it('never forwards a client-supplied net cash flow — it is derived server-side', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/banking-review',
      headers: bearer(await workerToken('Verification')),
      payload: {
        recurringWeeklyIncome: 12000,
        recurringWeeklyExpenses: 9500,
        avgWeeklyNetCashFlow: 999999, // a lie the client should not be able to tell
      },
    });
    expect(bankingMock).toHaveBeenCalled();
    const forwarded = bankingMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(forwarded).not.toHaveProperty('avgWeeklyNetCashFlow');
  });

  it('converts money to numeric text for the numeric columns', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/banking-review',
      headers: bearer(await workerToken('Verification')),
      payload: { recurringWeeklyIncome: 12000, avgWeeklyFuelExpense: 3200 },
    });
    const forwarded = bankingMock.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(forwarded.recurringWeeklyIncome).toBe('12000');
    expect(forwarded.avgWeeklyFuelExpense).toBe('3200');
  });
});

describe('risk + decision validation', () => {
  it('rejects an unknown risk tier', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/risk',
      headers: bearer(await workerToken('Verification')),
      payload: { riskTier: 'excellent' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(riskMock).not.toHaveBeenCalled();
  });

  it('accepts the three SOP tiers', async () => {
    for (const riskTier of ['strong', 'moderate', 'weak']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/verification/flow/cases/vc_1/risk',
        headers: bearer(await workerToken('Verification')),
        payload: { riskTier },
      });
      expect(res.statusCode, riskTier).toBe(200);
    }
  });

  it('rejects an unknown final decision', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/decision',
      headers: bearer(await workerToken('Verification')),
      payload: { decision: 'approve_probably' },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(decideMock).not.toHaveBeenCalled();
  });

  it('passes the approved limit through as text', async () => {
    await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/cases/vc_1/decision',
      headers: bearer(await workerToken('Verification')),
      payload: { decision: 'approve', approvedLimit: 4560 },
    });
    expect(decideMock).toHaveBeenCalledWith(
      expect.anything(),
      'vc_1',
      expect.objectContaining({ decision: 'approve', approvedLimit: '4560' }),
    );
  });
});

describe('policy is admin-only', () => {
  it('lets a verification worker READ policy', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/policy',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a verification WORKER writing policy — factors price every limit', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/policy',
      headers: bearer(await workerToken('Verification')),
      payload: { moderateFactor: 0.5 },
    });
    expect(res.statusCode).toBe(403);
    expect(policyUpdateMock).not.toHaveBeenCalled();
  });

  it('lets an admin set the previously-unset moderate factor', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/policy',
      headers: bearer(await adminToken()),
      payload: { moderateFactor: 0.5 },
    });
    expect(res.statusCode).toBe(200);
    expect(policyUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ moderateFactor: '0.5' }),
      expect.anything(),
    );
  });

  it('lets an admin UNSET a factor back to null rather than zeroing it', async () => {
    // null and 0 are different policies: null refuses to price, 0 approves a limit of $0.
    await app.inject({
      method: 'POST',
      url: '/v1/verification/flow/policy',
      headers: bearer(await adminToken()),
      payload: { weakFactor: null },
    });
    expect(policyUpdateMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ weakFactor: null }),
      expect.anything(),
    );
  });
});

/**
 * The desk has to be able to OPEN what Sales attached.
 *
 * Every phase from 2 onward cross-checks the application against these files. For a while the desk
 * could see a document count and had no route to open one — the bytes reached Dropbox and were
 * unreachable from the product. That is what this guards.
 */
describe('documents the desk reads', () => {
  it('returns a link for a verification worker', async () => {
    downloadMock.mockResolvedValue({ url: 'https://dl.example/x', fileName: 'statement.pdf' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases/vc_1/documents/vdoc_1/download',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fileName: 'statement.pdf' });
    expect(downloadMock).toHaveBeenCalledWith(expect.anything(), 'vc_1', 'vdoc_1');
  });

  it('is READ-gated, not write — reading a bank statement is the underwriting job', async () => {
    downloadMock.mockResolvedValue({ url: 'https://dl.example/x', fileName: 'statement.pdf' });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases/vc_1/documents/vdoc_1/download',
      headers: bearer(await workerToken('Verification Read Only')),
    });
    expect(res.statusCode).toBe(200);
  });

  it('refuses a sales worker on the verification route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases/vc_1/documents/vdoc_1/download',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it('refuses unauthenticated', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/verification/flow/cases/vc_1/documents/vdoc_1/download',
    });
    expect(res.statusCode).toBe(401);
  });
});
