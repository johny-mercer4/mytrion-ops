/**
 * Retention setup (/v1/retention). RBAC coverage (CLAUDE.md rule 9 spirit): case reads and
 * case-work writes require the retention department (or admin); delete + the DWH sync
 * trigger are admin-only; customer sessions are always denied. Plus the auto-generation
 * pipeline: frequency-breach candidates create/refresh cases and returned clients close.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.DWH_DATABASE_URL = 'postgres://dwh.invalid/octane';
});

vi.mock('../../src/repos/retentionCaseRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/retentionCaseRepo.js')>();
  return {
    toRetentionCaseDto: mod.toRetentionCaseDto,
    retentionCaseRepo: {
      list: vi.fn(async () => ({ cases: [], total: 0 })),
      findById: vi.fn(async () => undefined),
      listOpen: vi.fn(async () => []),
      listPhases: vi.fn(async () => []),
      listStatuses: vi.fn(async () => []),
      create: vi.fn(),
      update: vi.fn(async () => null),
      deleteById: vi.fn(async () => false),
    },
  };
});
vi.mock('../../src/integrations/dwhRetention.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhRetention.js')>();
  return {
    ...mod,
    scanRetentionCandidates: vi.fn(async () => []),
    fetchCarrierLastTransactions: vi.fn(async () => new Map<string, Date>()),
  };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import {
  classifyFrequency,
  daysSince,
  fetchCarrierLastTransactions,
  scanRetentionCandidates,
  type RetentionCandidate,
} from '../../src/integrations/dwhRetention.js';
import { retentionCaseRepo, type RetentionCaseDto } from '../../src/repos/retentionCaseRepo.js';
import type { RetentionCase } from '../../src/db/schema/index.js';

const repo = vi.mocked(retentionCaseRepo);
const scanMock = vi.mocked(scanRetentionCandidates);
const lastTxMock = vi.mocked(fetchCarrierLastTransactions);

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
  repo.list.mockResolvedValue({ cases: [], total: 0 });
  repo.listOpen.mockResolvedValue([]);
  scanMock.mockResolvedValue([]);
  lastTxMock.mockResolvedValue(new Map());
});

const API_KEY_HEADERS = { 'x-api-key': 'test-secret-key' };

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — role is re-derived from the profile at verify
    worker: { zohoUserId: '42', userName: 'Robiya', profile },
  });
}

function caseDto(overrides: Partial<RetentionCaseDto> = {}): RetentionCaseDto {
  return {
    id: '1',
    carrierId: '104882',
    zohoDealId: null,
    companyName: 'Ironhide Logistics LLC',
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
    lastTransactionAt: '2026-06-20T00:00:00.000Z',
    daysInactive: 16,
    txCount90d: 44,
    gallons90d: 8200,
    activeCards: 12,
    source: 'auto',
    lastSyncedAt: null,
    closedAt: null,
    isOpen: true,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    ...overrides,
  };
}

function openRow(overrides: Partial<RetentionCase> = {}): RetentionCase {
  return {
    id: 1,
    tenantId: DEFAULT_TENANT_ID,
    carrierId: '104882',
    zohoDealId: null,
    companyName: 'Ironhide Logistics LLC',
    applicationId: null,
    agentName: null,
    contactPhone: null,
    phaseCode: 'phase_1_agent',
    statusCode: 'p1_new',
    phaseChangedAt: new Date('2026-07-01T00:00:00Z'),
    transactionFrequency: 'medium',
    agentOutcome: null,
    dissatisfactionReason: null,
    reasonNote: null,
    assignedAgentZohoUserId: null,
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
    thresholdDays: 5,
    lastTransactionAt: new Date('2026-06-20T00:00:00Z'),
    daysInactive: 16,
    txCount90d: 18,
    gallons90d: 3200,
    activeCards: 6,
    source: 'auto',
    lastSyncedAt: null,
    closedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    ...overrides,
  };
}

function candidate(overrides: Partial<RetentionCandidate> = {}): RetentionCandidate {
  return {
    carrierId: '104882',
    companyName: 'Ironhide Logistics LLC',
    applicationId: '9001',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    zohoDealId: 'zdeal_104882',
    contactPhone: '5551234567',
    dealStage: 'Card Swiped',
    activeCards: 12,
    lastTransactionAt: new Date('2026-06-20T00:00:00Z'),
    daysInactive: 16,
    txCount90d: 44,
    gallons90d: 8200,
    frequencyClass: 'high',
    thresholdDays: 2,
    breached: true,
    preferredLanguage: null,
    isSpanishDesk: false,
    ...overrides,
  };
}

describe('retention routes — department/admin gates', () => {
  it('rejects unauthenticated access', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/retention/cases' });
    expect(res.statusCode).toBe(401);
  });

  it('static API key (admin system identity) can list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: API_KEY_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ cases: [], total: 0 });
  });

  it('denies a worker session without the retention department', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('denies a worker whose x-department-access omits retention', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: { authorization: `Bearer ${token}`, 'x-department-access': 'sales,billing' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('IGNORES a verified session asserting retention via x-department-access (elevation regression)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: { authorization: `Bearer ${token}`, 'x-department-access': 'retention' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('IGNORES a verified session asserting x-all-departments (elevation regression)', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: { authorization: `Bearer ${token}`, 'x-all-departments': 'true' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows a retention-profile worker with NO headers (profile-derived access)', async () => {
    const token = await workerToken('Retention Specialist');
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('FF_SESSION_DEPT_AUTHORITATIVE=0 restores the legacy header trust (rollback)', async () => {
    const saved = env.FF_SESSION_DEPT_AUTHORITATIVE;
    env.FF_SESSION_DEPT_AUTHORITATIVE = false;
    try {
      const token = await workerToken('Sales Rep');
      const res = await app.inject({
        method: 'GET',
        url: '/v1/retention/cases',
        headers: { authorization: `Bearer ${token}`, 'x-department-access': 'retention' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      env.FF_SESSION_DEPT_AUTHORITATIVE = saved;
    }
  });

  it('denies a carrier-client (customer) session even with the header', async () => {
    const token = await signAccessToken({
      userId: 'client:cu_1',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'customer',
      role: 'viewer',
      client: { carrierUserId: 'cu_1', clientProfile: 'owner', carrierId: '104882' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases',
      headers: { authorization: `Bearer ${token}`, 'x-department-access': 'retention' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('delete is admin-only — a retention-department worker is refused', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/cases/rc_1/delete',
      headers: { authorization: `Bearer ${token}`, 'x-department-access': 'retention' },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.deleteById).not.toHaveBeenCalled();
  });

  it('sync is admin-only — a retention-department worker is refused', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/sync',
      headers: {
        authorization: `Bearer ${token}`,
        'x-department-access': 'retention',
        'content-type': 'application/json',
      },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(scanMock).not.toHaveBeenCalled();
  });
});

describe('retention routes — CRUD', () => {
  it('creates a manual case (201) and audits it', async () => {
    repo.create.mockResolvedValueOnce(caseDto({ source: 'manual' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/cases',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { carrier_id: 104882, company_name: 'Ironhide Logistics LLC' },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        carrierId: '104882',
        phaseCode: 'phase_1_agent',
        statusCode: 'p1_in_progress',
        source: 'manual',
      }),
    );
    expect(auditFromContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'retention.case.create' }),
    );
  });

  it('rejects an invalid phase_code value', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/cases',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { carrier_id: 104882, phase_code: 'collections' },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects an empty update', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/cases/rc_1',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('moves a case through the phase ladder', async () => {
    repo.update.mockResolvedValueOnce(
      caseDto({ phaseCode: 'phase_2_retention', statusCode: 'p2_new' }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/v1/retention/cases/1',
      headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
      payload: { phase_code: 'phase_2_retention', status_code: 'p2_new' },
    });
    expect(res.statusCode).toBe(200);
    expect(repo.update).toHaveBeenCalledWith(
      expect.anything(),
      '1',
      expect.objectContaining({ phaseCode: 'phase_2_retention', statusCode: 'p2_new' }),
    );
  });

  it('404s on an unknown case id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/retention/cases/rc_missing',
      headers: API_KEY_HEADERS,
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('retention sync — auto record generation', () => {
  it('creates new cases, refreshes existing ones, and closes returned clients', async () => {
    // Ignore local pilot .env — this suite asserts full (non-pilot) sync behavior.
    const prevPilot = process.env.FF_RETENTION_PILOT_ONLY;
    process.env.FF_RETENTION_PILOT_ONLY = '0';
    const now = new Date();
    const recent = new Date(now.getTime() - 1 * 86_400_000); // returned yesterday
    scanMock.mockResolvedValueOnce([
      candidate({ carrierId: '111', breached: true }), // new breach → create
      candidate({ carrierId: '222', breached: true }), // existing open case → refresh
      candidate({ carrierId: '333', breached: false }), // inside threshold → ignored
    ]);
    repo.listOpen.mockResolvedValueOnce([
      openRow({ id: 22, carrierId: '222' }),
      openRow({ id: 44, carrierId: '444', thresholdDays: 5 }),
      openRow({ id: 55, carrierId: '555', phaseCode: 'phase_3_citi', statusCode: 'p3_hold' }),
    ]);
    lastTxMock.mockResolvedValueOnce(new Map([['444', recent]]));
    repo.create.mockResolvedValueOnce(caseDto({ id: '11', carrierId: '111' }));
    repo.update.mockResolvedValue(caseDto());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/retention/sync',
        headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().summary).toEqual({
        scanned: 3,
        breached: 2,
        created: 1,
        refreshed: 1,
        closedReturned: 1,
        pilotSkipped: 0,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          carrierId: '111',
          zohoDealId: 'zdeal_104882',
          phaseCode: 'phase_1_agent',
          statusCode: 'p1_in_progress',
          source: 'auto',
        }),
      );
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        '22',
        expect.objectContaining({ metrics: expect.anything() }),
      );
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        '44',
        expect.objectContaining({
          statusCode: 'p1_returned',
          agentOutcome: 'returned',
        }),
      );
      // Unified auto-close: all open phases (incl. CITI) are checked for post-create txns.
      expect(lastTxMock).toHaveBeenCalledWith(expect.arrayContaining(['222', '444', '555']));
    } finally {
      if (prevPilot === undefined) delete process.env.FF_RETENTION_PILOT_ONLY;
      else process.env.FF_RETENTION_PILOT_ONLY = prevPilot;
    }
  });

  it('closes a citi-phase case when the client transacted after open', async () => {
    const prevPilot = process.env.FF_RETENTION_PILOT_ONLY;
    process.env.FF_RETENTION_PILOT_ONLY = '0';
    try {
      const recent = new Date(Date.now() - 1 * 86_400_000);
      scanMock.mockResolvedValueOnce([]);
      repo.listOpen.mockResolvedValueOnce([
        openRow({ id: 55, carrierId: '555', phaseCode: 'phase_3_citi', statusCode: 'p3_hold' }),
      ]);
      lastTxMock.mockResolvedValueOnce(new Map([['555', recent]]));
      repo.update.mockResolvedValueOnce(caseDto({ id: '55', statusCode: 'p1_returned' }));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/retention/sync',
        headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().summary.closedReturned).toBe(1);
      expect(repo.update).toHaveBeenCalledWith(
        expect.anything(),
        '55',
        expect.objectContaining({
          statusCode: 'p1_returned',
          agentOutcome: 'returned',
        }),
      );
    } finally {
      if (prevPilot === undefined) delete process.env.FF_RETENTION_PILOT_ONLY;
      else process.env.FF_RETENTION_PILOT_ONLY = prevPilot;
    }
  });

  it('does not close a case when the last transaction predates it', async () => {
    const prevPilot = process.env.FF_RETENTION_PILOT_ONLY;
    process.env.FF_RETENTION_PILOT_ONLY = '0';
    try {
      const stale = new Date('2026-06-15T00:00:00Z'); // before the case's createdAt (Jul 1)
      scanMock.mockResolvedValueOnce([]);
      repo.listOpen.mockResolvedValueOnce([openRow({ id: 44, carrierId: '444' })]);
      lastTxMock.mockResolvedValueOnce(new Map([['444', stale]]));
      const res = await app.inject({
        method: 'POST',
        url: '/v1/retention/sync',
        headers: { ...API_KEY_HEADERS, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().summary.closedReturned).toBe(0);
    } finally {
      if (prevPilot === undefined) delete process.env.FF_RETENTION_PILOT_ONLY;
      else process.env.FF_RETENTION_PILOT_ONLY = prevPilot;
    }
  });
});

describe('frequency classification (pure)', () => {
  it('classifies by average 90-day transaction gap', () => {
    expect(classifyFrequency(45)).toEqual({ frequencyClass: 'high', thresholdDays: 2 }); // every 2d
    expect(classifyFrequency(18)).toEqual({ frequencyClass: 'medium', thresholdDays: 5 }); // every 5d
    expect(classifyFrequency(10)).toEqual({ frequencyClass: 'low', thresholdDays: 7 }); // every 9d
    expect(classifyFrequency(1)).toEqual({ frequencyClass: 'low', thresholdDays: 7 });
    expect(classifyFrequency(0)).toEqual({ frequencyClass: 'low', thresholdDays: 7 });
  });

  it('daysSince floors and never goes negative', () => {
    const now = new Date('2026-07-08T12:00:00Z');
    expect(daysSince(new Date('2026-07-05T13:00:00Z'), now)).toBe(2);
    expect(daysSince(new Date('2026-07-09T00:00:00Z'), now)).toBe(0);
  });
});

describe('retention entry exclusions (pure)', () => {
  const swipe = new Date('2026-06-01T00:00:00Z');

  it('allows Card Swiped active non-debtors', async () => {
    const { isRetentionEntryEligible } = await import('../../src/integrations/dwhRetention.js');
    expect(
      isRetentionEntryEligible({
        firstSwipeDate: swipe,
        dealStage: 'Card Swiped',
        isActive: true,
        isBillingDebtor: false,
      }),
    ).toEqual({ ok: true });
  });

  it('excludes debtors, pre-swipe, Closed Lost / OoB, deactivated', async () => {
    const { isRetentionEntryEligible } = await import('../../src/integrations/dwhRetention.js');
    expect(
      isRetentionEntryEligible({
        firstSwipeDate: swipe,
        dealStage: 'Card Swiped',
        isActive: true,
        isBillingDebtor: true,
      }).reason,
    ).toBe('debtor');
    expect(
      isRetentionEntryEligible({
        firstSwipeDate: null,
        dealStage: 'Card Funded',
        isActive: true,
        isBillingDebtor: false,
      }).reason,
    ).toBe('pre_card_swiped');
    expect(
      isRetentionEntryEligible({
        firstSwipeDate: swipe,
        dealStage: 'Closed Lost',
        isActive: true,
        isBillingDebtor: false,
      }).reason,
    ).toBe('out_of_business');
    expect(
      isRetentionEntryEligible({
        firstSwipeDate: swipe,
        dealStage: 'Out of Business',
        isActive: true,
        isBillingDebtor: false,
      }).reason,
    ).toBe('out_of_business');
    expect(
      isRetentionEntryEligible({
        firstSwipeDate: swipe,
        dealStage: 'Card Swiped',
        isActive: false,
        isBillingDebtor: false,
      }).reason,
    ).toBe('deactivated');
  });
});
