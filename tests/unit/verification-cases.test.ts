/**
 * Verification cases list DTO + missing-schema 503 + fail-soft verification-db sync.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/modules/verification/caseSync.js', () => ({
  syncCaseFromVerificationDb: vi.fn(),
}));

vi.mock('../../src/modules/verification/verificationCaseExtras.js', () => ({
  listRequestAttachments: vi.fn(async () => []),
  loadCaseReadiness: vi.fn(async () => null),
}));

import { AppError } from '../../src/lib/errors.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import {
  getVerificationCase,
  listVerificationCases,
  toCaseDto,
  verificationCasesSchemaError,
} from '../../src/modules/verification/verificationCases.js';
import { syncCaseFromVerificationDb } from '../../src/modules/verification/caseSync.js';
import {
  VERIFICATION_CASE_LIST_COLUMNS,
  verificationCaseRepo,
  type VerificationCaseListRow,
} from '../../src/repos/verificationCaseRepo.js';
import { verificationCaseStageRepo } from '../../src/repos/verificationCaseStageRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const syncMock = vi.mocked(syncCaseFromVerificationDb);

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: 'zoho:1',
  audience: 'internal',
  role: 'admin',
  scopes: [],
  departments: ['verification'],
  allDepartmentAccess: true,
  requestId: 'req_test',
};

function wrappedMissingTable(table: string): Error {
  const driver = Object.assign(new Error(`relation "${table}" does not exist`), { code: '42P01' });
  return Object.assign(new Error(`Failed query: select "id" from "${table}"`), { cause: driver });
}

const listRow: VerificationCaseListRow = {
  id: 'vc_i3aa11v9tqs0jcthgvn75f44',
  zohoDealId: '6227679000172056991',
  zohoApplicationId: null,
  requestId: '6227679000172056991',
  companyName: 'Miguel Del Real Gonzalez',
  firstName: 'Miguel',
  lastName: 'Gonzalez',
  email: null,
  phone: null,
  dot: '123',
  mc: null,
  zohoStage: 'Application Filled',
  applicationStatus: null,
  applicationDate: '2026-08-01',
  creditScore: null,
  distributeType: 'shared',
  ownerZohoUserId: '99',
  ownerName: 'Sarvar Asqarov',
  matchedSnapshotId: null,
  matchedVia: null,
  carrierOperatingStatus: null,
  status: 'new',
  currentStage: null,
  stagesDone: 0,
  stagesTotal: 10,
  lastDecision: null,
  firstRunStatus: 'idle',
  firstRunError: null,
  cpOwnerUsername: null,
  approvedLimit: null,
  paymentType: null,
  billingCycle: null,
  plaidStatus: null,
  plaidLinkUrl: null,
  plaidMode: null,
  cpClaimedAt: null,
  cpReviewUpdatedAt: null,
  lastSyncedAt: null,
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
};

const emptyAggregates = {
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
};

describe('VERIFICATION_CASE_LIST_COLUMNS', () => {
  it('does not select zoho_raw or unused address fields', () => {
    const keys = Object.keys(VERIFICATION_CASE_LIST_COLUMNS);
    expect(keys).not.toContain('zohoRaw');
    expect(keys).not.toContain('address');
    expect(keys).not.toContain('cell');
    expect(keys).toContain('companyName');
    expect(keys).toContain('status');
    expect(keys).toContain('createdAt');
  });
});

describe('toCaseDto', () => {
  it('maps list rows to camelCase without requiring zohoRaw', () => {
    expect(toCaseDto(listRow)).toMatchObject({
      id: 'vc_i3aa11v9tqs0jcthgvn75f44',
      companyName: 'Miguel Del Real Gonzalez',
      distributeType: 'shared',
      createdAt: '2026-08-01T00:00:00.000Z',
      slaStale: false,
      slaLabel: 'Unclaimed',
    });
  });

  it('surfaces offer fields and stale SLA when claimed and idle', () => {
    const dto = toCaseDto({
      ...listRow,
      approvedLimit: '15000',
      paymentType: 'LOC',
      billingCycle: 'Weekly',
      cpOwnerUsername: 'ada',
      cpReviewUpdatedAt: new Date('2026-08-14T12:00:00.000Z'),
    });
    expect(dto.approvedLimit).toBe('15000');
    expect(dto.paymentType).toBe('LOC');
    expect(dto.billingCycle).toBe('Weekly');
    const stale = toCaseDto({
      ...listRow,
      cpOwnerUsername: 'ada',
      cpReviewUpdatedAt: new Date(Date.now() - 45 * 60_000),
    });
    expect(stale.slaStale).toBe(true);
    expect(stale.slaLabel).toMatch(/^Stale/);
  });
});

describe('verificationCasesSchemaError', () => {
  it('maps a missing verification_cases table to VERIFICATION_CASES_NOT_MIGRATED', () => {
    const mapped = verificationCasesSchemaError(wrappedMissingTable('verification_cases'));
    expect(mapped).toBeInstanceOf(AppError);
    expect(mapped?.statusCode).toBe(503);
    expect(mapped?.code).toBe('VERIFICATION_CASES_NOT_MIGRATED');
    expect(mapped?.expose).toBe(true);
    expect(mapped?.message).toContain('pnpm dev:local-db');
    expect(mapped?.message).toContain('Do not migrate a remote/prod URL');
  });

  it('leaves unrelated errors alone', () => {
    expect(verificationCasesSchemaError(new Error('boom'))).toBeNull();
    expect(verificationCasesSchemaError(wrappedMissingTable('other_table'))).toBeNull();
  });
});

describe('listVerificationCases', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('turns a missing-table list query into a 503', async () => {
    vi.spyOn(verificationCaseRepo, 'list').mockRejectedValue(wrappedMissingTable('verification_cases'));
    vi.spyOn(verificationCaseRepo, 'aggregates').mockResolvedValue(emptyAggregates);
    vi.spyOn(verificationCaseRepo, 'count').mockResolvedValue(0);
    await expect(listVerificationCases(ctx, { limit: 25, offset: 0 })).rejects.toMatchObject({
      statusCode: 503,
      code: 'VERIFICATION_CASES_NOT_MIGRATED',
    });
  });

  it('paginates with the filtered count, not the unfiltered aggregate total', async () => {
    vi.spyOn(verificationCaseRepo, 'list').mockResolvedValue([]);
    vi.spyOn(verificationCaseRepo, 'aggregates').mockResolvedValue({
      ...emptyAggregates,
      open: 12,
      shared: 40,
      inProgress: 3,
      awaitingDecision: 2,
      unmatched: 8,
      total: 40,
    });
    vi.spyOn(verificationCaseRepo, 'count').mockResolvedValue(2);
    const res = await listVerificationCases(ctx, { status: 'new', limit: 25, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.aggregates.total).toBe(40);
    expect(verificationCaseRepo.count).toHaveBeenCalledWith(ctx, {
      status: 'new',
      limit: 25,
      offset: 0,
      viewer: '1',
    });
  });

  it('forwards unclaimed/mine owner scope with the viewer', async () => {
    vi.spyOn(verificationCaseRepo, 'list').mockResolvedValue([]);
    vi.spyOn(verificationCaseRepo, 'aggregates').mockResolvedValue(emptyAggregates);
    vi.spyOn(verificationCaseRepo, 'count').mockResolvedValue(0);
    await listVerificationCases(ctx, { owner: 'unclaimed', limit: 25, offset: 0 });
    expect(verificationCaseRepo.list).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ owner: 'unclaimed', viewer: '1' }),
    );
  });
});

describe('getVerificationCase', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    syncMock.mockReset();
  });

  it('still opens the case when verification-db sync fails', async () => {
    vi.spyOn(verificationCaseRepo, 'findById').mockResolvedValue({
      ...listRow,
      tenantId: DEFAULT_TENANT_ID,
      carrierId: null,
      cell: null,
      address: null,
      city: null,
      state: null,
      zip: null,
      dateOfBirth: null,
      truckCount: null,
      businessType: null,
      creditsafeGrade: null,
      zohoOwnerId: null,
      zohoOwnerName: null,
      zohoRaw: {},
      carrierUnits: null,
      carrierAddress: null,
      carrierDot: null,
      carrierPhone: null,
      carrierEmail: null,
      lastSyncedAt: null,
      firstRunStatus: 'idle',
      firstRunStep: null,
      firstRunInboxId: null,
      firstRunError: null,
      cpOwnerUsername: null,
      updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    });
    vi.spyOn(verificationCaseStageRepo, 'listForCase').mockResolvedValue([]);
    syncMock.mockRejectedValue(new Error('verification db unreachable'));

    const detail = await getVerificationCase(ctx, listRow.id);
    expect(detail.case.id).toBe(listRow.id);
    expect(detail.case.companyName).toBe(listRow.companyName);
    expect(detail.stages).toEqual([]);
    expect(detail.catalog.length).toBeGreaterThan(0);
  });
});
