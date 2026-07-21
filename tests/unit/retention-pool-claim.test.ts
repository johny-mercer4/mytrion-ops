/**
 * Open Pool claim_requests → CS approve/decline + Zoho ownership → p1_new.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { RetentionCase } from '../../src/db/schema/index.js';
import { AppError, RBACError } from '../../src/lib/errors.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: {
    getRecord: vi.fn(),
    updateRecord: vi.fn(),
  },
}));

vi.mock('../../src/modules/retention/notify.js', () => ({
  notifyClaimRequestToCs: vi.fn(async () => undefined),
  notifyClaimApproved: vi.fn(async () => undefined),
  notifyClaimDeclined: vi.fn(async () => undefined),
}));

vi.mock('../../src/repos/retentionCaseRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/retentionCaseRepo.js')>();
  return {
    ...mod,
    appendRetentionEvent: vi.fn(async () => undefined),
    retentionCaseRepo: {
      update: vi.fn(),
    },
  };
});

import { db } from '../../src/db/client.js';
import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { notifyClaimRequestToCs } from '../../src/modules/retention/notify.js';
import { CLAIM_APPROVE_DEADLINE_TYPE } from '../../src/modules/retention/deadlines.js';
import { retentionPoolClaimRepo } from '../../src/repos/retentionPoolClaimRepo.js';
import { appendRetentionEvent } from '../../src/repos/retentionCaseRepo.js';

const dbMock = vi.mocked(db, true);
const zoho = vi.mocked(zohoCrmRecords, true);
const notifyCs = vi.mocked(notifyClaimRequestToCs);

function baseCase(overrides: Partial<RetentionCase> = {}): RetentionCase {
  return {
    id: 42,
    tenantId: DEFAULT_TENANT_ID,
    carrierId: '104882',
    zohoDealId: 'deal-1',
    companyName: 'Ironhide',
    applicationId: null,
    agentName: 'Rep',
    contactPhone: null,
    phaseCode: 'phase_1_agent',
    statusCode: 'p1_open_pool',
    phaseChangedAt: new Date('2026-07-01T00:00:00Z'),
    transactionFrequency: 'high',
    agentOutcome: 'out_of_reach',
    dissatisfactionReason: null,
    reasonNote: null,
    assignedAgentZohoUserId: null,
    poolOwnerZohoUserId: 'owner-1',
    pendingClaimantZohoUserId: null,
    assignmentCount: 1,
    openPoolAttemptCount: 1,
    outOfReachAttempts: 5,
    dealOwnerChanged: false,
    currentDeadlineAt: new Date('2026-07-10T00:00:00Z'),
    currentDeadlineType: '3BD_pool_claim',
    vacationCountdownEnd: null,
    citiFolderEnteredAt: null,
    citiFolderHoldUntil: null,
    lastReviewCycleAt: null,
    salesManagerZohoUserId: null,
    thresholdDays: 2,
    lastTransactionAt: null,
    daysInactive: 12,
    txCount90d: 40,
    gallons90d: 8000,
    activeCards: 3,
    source: 'auto',
    lastSyncedAt: null,
    closedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function ctx(depts: string[], role: TenantContext['role'] = 'worker'): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:cs-1',
    audience: 'internal',
    role,
    scopes: ['*'],
    departments: depts,
    allDepartmentAccess: false,
    requestId: 'test',
  };
}

/** Sequential select().from().where().limit() results (loadCase / loadOpenRequest). */
function mockSelectLimits(...batches: unknown[][]): void {
  let i = 0;
  dbMock.select.mockImplementation(() => {
    const rows = batches[i++] ?? [];
    return {
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
          orderBy: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue(rows),
          }),
        }),
        innerJoin: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockResolvedValue(rows),
            }),
          }),
        }),
      }),
    } as never;
  });
}

function mockUpdateReturning(row: RetentionCase): void {
  dbMock.update.mockReturnValue({
    set: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([row]),
      }),
    }),
  } as never);
}

function mockInsertOk(): void {
  dbMock.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  } as never);
}

function mockDeleteReturning(n = 1): void {
  dbMock.delete.mockReturnValue({
    where: vi.fn().mockReturnValue({
      returning: vi.fn().mockResolvedValue(Array.from({ length: n }, (_, k) => ({ id: k + 1 }))),
    }),
  } as never);
}

describe('retentionPoolClaimRepo.requestClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertOk();
  });

  it('inserts claim_request + Processing lock with reason', async () => {
    const open = baseCase();
    const pending = baseCase({
      statusCode: 'p1_pool_claim_pending',
      pendingClaimantZohoUserId: 'claimant-9',
      currentDeadlineType: CLAIM_APPROVE_DEADLINE_TYPE,
    });
    mockSelectLimits([open], []);
    mockUpdateReturning(pending);

    const out = await retentionPoolClaimRepo.requestClaim(ctx(['sales']), '42', 'claimant-9', {
      agentName: 'Alice',
      reason: 'Strong relationship — can re-engage',
    });

    expect(out.pendingApproval).toBe(true);
    expect(out.statusCode).toBe('p1_pool_claim_pending');
    expect(out.pendingClaimantZohoUserId).toBe('claimant-9');
    expect(dbMock.insert).toHaveBeenCalled();
    expect(notifyCs).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'Strong relationship — can re-engage' }),
    );
    expect(zoho.updateRecord).not.toHaveBeenCalled();
    expect(appendRetentionEvent).toHaveBeenCalled();
  });

  it('rejects missing reason', async () => {
    mockSelectLimits([baseCase()]);
    await expect(
      retentionPoolClaimRepo.requestClaim(ctx(['sales']), '42', 'claimant-9', {
        reason: '   ',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('409 when a claim is already Processing', async () => {
    mockSelectLimits([
      baseCase({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: 'other',
      }),
    ]);
    await expect(
      retentionPoolClaimRepo.requestClaim(ctx(['sales']), '42', 'claimant-9', {
        reason: 'Want this',
      }),
    ).rejects.toMatchObject({ code: 'RETENTION_NOT_IN_POOL' });
  });
});

describe('retentionPoolClaimRepo.approveClaim / declineClaim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    zoho.getRecord.mockResolvedValue({
      id: 'deal-1',
      Contact_Name: { id: 'c1' },
      Account_Name: { id: 'a1' },
    });
    zoho.updateRecord.mockResolvedValue('ok');
  });

  it('CS approve → Zoho owners + p1_new (2 BD)', async () => {
    const pending = baseCase({
      statusCode: 'p1_pool_claim_pending',
      pendingClaimantZohoUserId: 'claimant-9',
    });
    const assigned = baseCase({
      statusCode: 'p1_new',
      assignedAgentZohoUserId: 'claimant-9',
      pendingClaimantZohoUserId: null,
      assignmentCount: 2,
      currentDeadlineType: '2BD_agent_action',
    });
    mockSelectLimits([pending]);
    mockUpdateReturning(assigned);

    const out = await retentionPoolClaimRepo.approveClaim(ctx(['customer-service']), '42', 'cs-1');
    expect(out.statusCode).toBe('p1_new');
    expect(zoho.updateRecord).toHaveBeenCalledWith('Deals', 'deal-1', {
      Owner: { id: 'claimant-9' },
    });
    expect(zoho.updateRecord).toHaveBeenCalledWith('Contacts', 'c1', {
      Owner: { id: 'claimant-9' },
    });
    expect(zoho.updateRecord).toHaveBeenCalledWith('Accounts', 'a1', {
      Owner: { id: 'claimant-9' },
    });
  });

  it('rejects non-CS approver', async () => {
    mockSelectLimits([
      baseCase({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: 'claimant-9',
      }),
    ]);
    await expect(
      retentionPoolClaimRepo.approveClaim(ctx(['sales']), '42', 'sales-1'),
    ).rejects.toBeInstanceOf(RBACError);
  });

  it('CS reject deletes request + restores pool', async () => {
    const pending = baseCase({
      statusCode: 'p1_pool_claim_pending',
      pendingClaimantZohoUserId: 'claimant-9',
    });
    const open = baseCase({
      statusCode: 'p1_open_pool',
      pendingClaimantZohoUserId: null,
    });
    mockSelectLimits([pending]);
    mockDeleteReturning(1);
    mockUpdateReturning(open);

    const out = await retentionPoolClaimRepo.declineClaim(ctx(['customer-service']), '42', 'cs-1');
    expect(out.statusCode).toBe('p1_open_pool');
    expect(dbMock.delete).toHaveBeenCalled();
    expect(zoho.updateRecord).not.toHaveBeenCalled();
  });

  it('fails closed when Deal Owner update fails', async () => {
    mockSelectLimits([
      baseCase({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: 'claimant-9',
      }),
    ]);
    zoho.updateRecord.mockRejectedValueOnce(new Error('Zoho boom'));
    await expect(
      retentionPoolClaimRepo.approveClaim(ctx(['customer-service']), '42', 'cs-1'),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe('phase2 transitions', () => {
  it('no_response with cap moves to CITI', async () => {
    const { resolvePhase2Transition } = await import('../../src/modules/retention/phase2.js');
    const t = resolvePhase2Transition(
      baseCase({
        phaseCode: 'phase_2_retention',
        statusCode: 'p2_working',
        assignmentCount: 3,
        assignedAgentZohoUserId: 'cs-1',
      }),
      'no_response',
    );
    expect(t.phaseCode).toBe('phase_3_citi');
    expect(t.statusCode).toBe('p3_hold');
  });

  it('claim assigns CS worker', async () => {
    const { resolvePhase2Transition } = await import('../../src/modules/retention/phase2.js');
    const t = resolvePhase2Transition(
      baseCase({
        phaseCode: 'phase_2_retention',
        statusCode: 'p2_new',
        assignedAgentZohoUserId: null,
      }),
      'claim',
      { actorZohoUserId: 'cs-99' },
    );
    expect(t.statusCode).toBe('p2_working');
    expect(t.assignedAgentZohoUserId).toBe('cs-99');
  });
});
