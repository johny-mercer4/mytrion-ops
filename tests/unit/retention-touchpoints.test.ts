/**
 * Retention local touchpoints — sales-scoped Phase 1 handlers (self-scope + claim cap).
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/retentionCaseRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/retentionCaseRepo.js')>();
  return {
    ...mod,
    retentionCaseRepo: {
      listPhases: vi.fn(async () => []),
      listStatuses: vi.fn(async () => []),
      findById: vi.fn(async () => undefined),
      update: vi.fn(async () => null),
      create: vi.fn(),
      list: vi.fn(async () => ({ cases: [], total: 0 })),
      listOpen: vi.fn(async () => []),
      deleteById: vi.fn(async () => false),
    },
  };
});

vi.mock('../../src/repos/retentionCasePhase1Repo.js', () => ({
  retentionCasePhase1Repo: {
    listForAgent: vi.fn(async () => ({ cases: [], total: 0 })),
    listOpenPool: vi.fn(async () => ({ cases: [], total: 0 })),
    getWithEvents: vi.fn(async () => null),
    claimFromPool: vi.fn(),
    logCommsAttempt: vi.fn(),
  },
}));

vi.mock('../../src/modules/tools/serverCrmScope.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/tools/serverCrmScope.js')>();
  return {
    ...mod,
    resolveZohoUserId: vi.fn((_ctx: unknown, override?: string) => override?.trim() || '777'),
    resolveAgentName: vi.fn((_ctx: unknown, override?: string) => override?.trim() || 'Rep Riley'),
    assertCarrierOwned: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { AppError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { retentionCasePhase1Repo } from '../../src/repos/retentionCasePhase1Repo.js';
import { retentionCaseRepo, type RetentionCaseDto } from '../../src/repos/retentionCaseRepo.js';

const phase1 = vi.mocked(retentionCasePhase1Repo);
const repo = vi.mocked(retentionCaseRepo);

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
  phase1.listForAgent.mockResolvedValue({ cases: [], total: 0 });
  phase1.listOpenPool.mockResolvedValue({ cases: [], total: 0 });
});

async function salesToken(zohoUserId = '777'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId, userName: 'Rep Riley', profile: 'Sales Rep' },
  });
}

function caseDto(overrides: Partial<RetentionCaseDto> = {}): RetentionCaseDto {
  return {
    id: '1',
    carrierId: '104882',
    zohoDealId: null,
    companyName: 'Ironhide',
    applicationId: null,
    agentName: 'Rep Riley',
    contactPhone: null,
    phaseCode: 'phase_1_agent',
    statusCode: 'p1_new',
    phaseChangedAt: '2026-07-06T00:00:00.000Z',
    transactionFrequency: 'high',
    agentOutcome: null,
    dissatisfactionReason: null,
    reasonNote: null,
    assignedAgentZohoUserId: '777',
    poolOwnerZohoUserId: null,
    pendingClaimantZohoUserId: null,
    assignmentCount: 1,
    openPoolAttemptCount: 0,
    outOfReachAttempts: 0,
    dealOwnerChanged: false,
    currentDeadlineAt: null,
    currentDeadlineType: null,
    vacationCountdownEnd: null,
    citiFolderEnteredAt: null,
    citiFolderHoldUntil: null,
    lastReviewCycleAt: null,
    salesManagerZohoUserId: null,
    thresholdDays: 2,
    lastTransactionAt: null,
    daysInactive: 10,
    txCount90d: 40,
    gallons90d: 8000,
    activeCards: 5,
    source: 'auto',
    lastSyncedAt: null,
    closedAt: null,
    isOpen: true,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

describe('retention.my_cases touchpoint', () => {
  it('lists cases for the session identity', async () => {
    phase1.listForAgent.mockResolvedValueOnce({ cases: [caseDto()], total: 1 });
    const token = await salesToken('777');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/retention.my_cases',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-department-access': 'sales',
      },
      payload: { departmentAccess: ['sales'], params: {} },
    });
    expect(res.statusCode).toBe(200);
    // Board loads all phases (New…Closed) — no default phase_1_agent filter.
    expect(phase1.listForAgent).toHaveBeenCalledWith(expect.anything(), '777', {});
    expect(res.json().data.total).toBe(1);
  });
});

describe('retention.record_outcome touchpoint', () => {
  it('rejects dissatisfied without a reason', async () => {
    repo.findById.mockResolvedValueOnce({
      id: 1,
      tenantId: DEFAULT_TENANT_ID,
      carrierId: '104882',
      zohoDealId: null,
      companyName: 'Ironhide',
      applicationId: null,
      agentName: 'Rep',
      contactPhone: null,
      phaseCode: 'phase_1_agent',
      statusCode: 'p1_new',
      phaseChangedAt: new Date(),
      transactionFrequency: 'high',
      agentOutcome: null,
      dissatisfactionReason: null,
      reasonNote: null,
      assignedAgentZohoUserId: '777',
      poolOwnerZohoUserId: null,
      pendingClaimantZohoUserId: null,
      assignmentCount: 1,
      openPoolAttemptCount: 0,
      outOfReachAttempts: 0,
      dealOwnerChanged: false,
      currentDeadlineAt: null,
      currentDeadlineType: null,
      vacationCountdownEnd: null,
      citiFolderEnteredAt: null,
      citiFolderHoldUntil: null,
      lastReviewCycleAt: null,
      salesManagerZohoUserId: null,
      thresholdDays: 2,
      lastTransactionAt: null,
      daysInactive: 10,
      txCount90d: 40,
      gallons90d: 8000,
      activeCards: 5,
      source: 'auto',
      lastSyncedAt: null,
      closedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const token = await salesToken('777');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/retention.record_outcome',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {
        departmentAccess: ['sales'],
        params: { caseId: '1', outcome: 'dissatisfied' },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('retention.pool_claim touchpoint', () => {
  it('surfaces the 3-agent pool cap', async () => {
    phase1.claimFromPool.mockRejectedValueOnce(
      new AppError('Maximum 3 agents have already worked this deal — moved to CITI', {
        statusCode: 409,
        code: 'RETENTION_POOL_CAP',
        expose: true,
      }),
    );
    const token = await salesToken('888');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/touchpoints/retention.pool_claim',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      payload: {
        departmentAccess: ['sales'],
        params: { caseId: '42' },
      },
    });
    expect(res.statusCode).toBe(409);
    expect(phase1.claimFromPool).toHaveBeenCalled();
  });
});
