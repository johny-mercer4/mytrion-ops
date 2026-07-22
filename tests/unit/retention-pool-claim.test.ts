/**
 * Open Pool instant claim → Zoho ownership + p1_new; unclaimed audit; daily cap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { RetentionCase } from '../../src/db/schema/index.js';
import { AppError } from '../../src/lib/errors.js';
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

vi.mock('../../src/modules/retention/openPoolCaps.js', () => ({
  OPEN_POOL_MAX_CLAIMS_PER_DAY: 2,
  assertUnderOpenPoolDailyCap: vi.fn(async () => ({ used: 0, remaining: 2 })),
  countOpenPoolClaimsToday: vi.fn(async () => 0),
  getOpenPoolDailyQuota: vi.fn(async () => ({ used: 0, max: 2, remaining: 2 })),
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
import { assertUnderOpenPoolDailyCap } from '../../src/modules/retention/openPoolCaps.js';
import { retentionPoolClaimRepo } from '../../src/repos/retentionPoolClaimRepo.js';
import { appendRetentionEvent } from '../../src/repos/retentionCaseRepo.js';

const dbMock = vi.mocked(db, true);
const zoho = vi.mocked(zohoCrmRecords, true);
const assertCap = vi.mocked(assertUnderOpenPoolDailyCap);

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
    preferredLanguage: null,
    isSpanishDesk: false,
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
    retentionToPoolCount: 0,
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
    userId: 'zoho:sales-1',
    audience: 'internal',
    role,
    scopes: ['*'],
    departments: depts,
    allDepartmentAccess: false,
    requestId: 'test',
  };
}

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
        leftJoin: vi.fn().mockReturnValue({
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

/** Sequential update().set().where().returning() results. */
function mockUpdateSequence(...rows: RetentionCase[]): void {
  let i = 0;
  dbMock.update.mockImplementation(() => {
    const row = rows[i++] ?? rows[rows.length - 1]!;
    return {
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([row]),
        }),
      }),
    } as never;
  });
}

function mockInsertOk(): void {
  dbMock.insert.mockReturnValue({
    values: vi.fn().mockResolvedValue(undefined),
  } as never);
}

describe('retentionPoolClaimRepo.claimNow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertOk();
    assertCap.mockResolvedValue({ used: 0, remaining: 2 });
    zoho.getRecord.mockResolvedValue({
      id: 'deal-1',
      Contact_Name: { id: 'c1' },
      Account_Name: { id: 'a1' },
    });
    zoho.updateRecord.mockResolvedValue('ok');
  });

  it('claims instantly → Zoho owners + p1_new + approved audit', async () => {
    const open = baseCase();
    const locked = baseCase({
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
    mockSelectLimits([open]);
    mockUpdateSequence(locked, assigned);

    const out = await retentionPoolClaimRepo.claimNow(ctx(['sales']), '42', 'claimant-9', {
      agentName: 'Alice',
      reason: 'Strong relationship — can re-engage',
    });

    expect(out.pendingApproval).toBe(false);
    expect(out.statusCode).toBe('p1_new');
    expect(dbMock.insert).toHaveBeenCalled();
    expect(zoho.updateRecord).toHaveBeenCalledWith('Deals', 'deal-1', {
      Owner: { id: 'claimant-9' },
    });
    expect(appendRetentionEvent).toHaveBeenCalled();
  });

  it('rejects missing reason', async () => {
    await expect(
      retentionPoolClaimRepo.claimNow(ctx(['sales']), '42', 'claimant-9', {
        reason: '   ',
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('409 when case already Processing', async () => {
    mockSelectLimits([
      baseCase({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: 'other',
      }),
    ]);
    await expect(
      retentionPoolClaimRepo.claimNow(ctx(['sales']), '42', 'claimant-9', {
        reason: 'Want this',
      }),
    ).rejects.toMatchObject({ code: 'RETENTION_NOT_IN_POOL' });
  });

  it('409 claiming own former deal', async () => {
    mockSelectLimits([baseCase({ poolOwnerZohoUserId: 'claimant-9' })]);
    await expect(
      retentionPoolClaimRepo.claimNow(ctx(['sales']), '42', 'claimant-9', {
        reason: 'Mine again',
      }),
    ).rejects.toMatchObject({ code: 'RETENTION_CLAIM_SELF' });
  });

  it('fails closed when Deal Owner update fails and unlocks pool', async () => {
    const open = baseCase();
    const locked = baseCase({
      statusCode: 'p1_pool_claim_pending',
      pendingClaimantZohoUserId: 'claimant-9',
    });
    const unlocked = baseCase({ statusCode: 'p1_open_pool' });
    mockSelectLimits([open]);
    mockUpdateSequence(locked, unlocked);
    zoho.updateRecord.mockRejectedValueOnce(new Error('Zoho boom'));
    await expect(
      retentionPoolClaimRepo.claimNow(ctx(['sales']), '42', 'claimant-9', {
        reason: 'Try claim',
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(dbMock.insert).not.toHaveBeenCalled();
  });

  it('enforces daily Open Pool cap', async () => {
    assertCap.mockRejectedValueOnce(
      new AppError('Daily Open Pool cap reached (2 claims/day). Try again tomorrow.', {
        statusCode: 429,
        code: 'RETENTION_OPEN_POOL_DAILY_CAP',
        expose: true,
      }),
    );
    await expect(
      retentionPoolClaimRepo.claimNow(ctx(['sales']), '42', 'claimant-9', {
        reason: 'One more',
      }),
    ).rejects.toMatchObject({ code: 'RETENTION_OPEN_POOL_DAILY_CAP' });
  });
});

describe('retentionPoolClaimRepo.logUnclaimedExit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertOk();
  });

  it('inserts expired audit row for pool owner', async () => {
    await retentionPoolClaimRepo.logUnclaimedExit(ctx(['customer-service']), baseCase(), {
      outcomeNote: '3bd_unclaimed_to_retention',
    });
    expect(dbMock.insert).toHaveBeenCalled();
  });
});

describe('phase2 transitions', () => {
  it('no_response is rejected (CS cannot send to Open Pool)', async () => {
    const { resolvePhase2Transition } = await import('../../src/modules/retention/phase2.js');
    expect(() =>
      resolvePhase2Transition(
        baseCase({
          phaseCode: 'phase_2_retention',
          statusCode: 'p2_working',
          assignmentCount: 1,
          assignedAgentZohoUserId: 'cs-1',
        }),
        'no_response',
      ),
    ).toThrow(/cannot send cases to Open Pool/i);
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
