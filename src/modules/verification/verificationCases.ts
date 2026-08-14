import { AppError, NotFoundError } from '../../lib/errors.js';
import { databaseHost } from '../../config/env.js';
import {
  approveDecisionDeskStage,
  runDecisionDeskStage,
  submitManualDecision,
} from '../../integrations/creditPlatformClient.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { VerificationCase, VerificationCaseStage } from '../../db/schema/index.js';
import type { VerificationCaseStatus } from '../../db/schema/verification_cases.js';
import {
  verificationCaseRepo,
  type VerificationCaseListRow,
} from '../../repos/verificationCaseRepo.js';
import { isMissingColumn, isMissingTable } from '../../repos/util.js';
import { verificationCaseStageRepo } from '../../repos/verificationCaseStageRepo.js';
import { syncCaseFromVerificationDb } from './caseSync.js';
import { DECISION_DESK_STAGES } from './verificationStages.js';

const VERIFICATION_CASE_TABLES = ['verification_cases', 'verification_case_stages'] as const;

function notMigratedMessage(): string {
  return (
    `Verification cases are not on this database (${databaseHost()}) yet. ` +
    'Start the API with `pnpm dev:local-db` to use local Docker Postgres on localhost:5433 without changing .env, ' +
    'or run `pnpm db:migrate` on the database this process uses. ' +
    'Do not migrate a remote/prod URL unless you have opted in.'
  );
}

/** Map "relation/column does not exist" to an operator-facing 503. Otherwise null. */
export function verificationCasesSchemaError(err: unknown): AppError | null {
  if (VERIFICATION_CASE_TABLES.some((t) => isMissingTable(err, t) || isMissingColumn(err, t))) {
    return new AppError(notMigratedMessage(), {
      statusCode: 503,
      code: 'VERIFICATION_CASES_NOT_MIGRATED',
      expose: true,
    });
  }
  return null;
}

function rethrowIfVerificationCasesUnmigrated(err: unknown): never {
  const mapped = verificationCasesSchemaError(err);
  if (mapped) throw mapped;
  throw err;
}

async function withVerificationCaseTables<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    rethrowIfVerificationCasesUnmigrated(err);
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function toCaseDto(row: VerificationCaseListRow | VerificationCase) {
  return {
    id: row.id,
    zohoDealId: row.zohoDealId,
    zohoApplicationId: row.zohoApplicationId,
    requestId: row.requestId,
    companyName: row.companyName,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    dot: row.dot,
    mc: row.mc,
    zohoStage: row.zohoStage,
    applicationStatus: row.applicationStatus,
    applicationDate: row.applicationDate,
    creditScore: row.creditScore,
    distributeType: row.distributeType,
    ownerZohoUserId: row.ownerZohoUserId,
    ownerName: row.ownerName,
    matchedSnapshotId: row.matchedSnapshotId,
    matchedVia: row.matchedVia,
    carrierOperatingStatus: row.carrierOperatingStatus,
    status: row.status,
    currentStage: row.currentStage,
    stagesDone: row.stagesDone,
    stagesTotal: row.stagesTotal,
    lastDecision: row.lastDecision,
    createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
  };
}

export function toStageDto(row: VerificationCaseStage) {
  return {
    id: row.id,
    stageId: row.stageId,
    status: row.status,
    result: row.result,
    error: row.error,
    ranAt: iso(row.ranAt),
    approvedAt: iso(row.approvedAt),
  };
}

export interface VerificationCaseDetail {
  case: ReturnType<typeof toCaseDto>;
  stages: Array<ReturnType<typeof toStageDto>>;
  catalog: ReadonlyArray<{ id: string; label: string; order: number }>;
}

async function loadOrThrow(ctx: TenantContext, id: string): Promise<VerificationCase> {
  const row = await verificationCaseRepo.findById(ctx, id);
  if (!row) throw new NotFoundError('Verification case not found');
  return row;
}

async function syncOrWarn(ctx: TenantContext, caseId: string, requestId: string): Promise<void> {
  try {
    await syncCaseFromVerificationDb(ctx, caseId, requestId);
  } catch (err) {
    const mapped = verificationCasesSchemaError(err);
    if (mapped) throw mapped;
    logger.warn({ err, caseId }, 'verification-db sync skipped — serving the local case row');
  }
}

export async function listVerificationCases(
  ctx: TenantContext,
  filter: { status?: VerificationCaseStatus; query?: string; unmatched?: boolean; limit?: number; offset?: number },
) {
  return withVerificationCaseTables(async () => {
    const [items, aggregates, total] = await Promise.all([
      verificationCaseRepo.list(ctx, filter),
      verificationCaseRepo.aggregates(ctx),
      verificationCaseRepo.count(ctx, filter),
    ]);
    return { items: items.map(toCaseDto), aggregates, total };
  });
}

export async function getVerificationCase(
  ctx: TenantContext,
  id: string,
  opts: { sync?: boolean } = {},
): Promise<VerificationCaseDetail> {
  return withVerificationCaseTables(async () => {
    let row = await loadOrThrow(ctx, id);
    if (opts.sync !== false && row.requestId) {
      await syncOrWarn(ctx, row.id, row.requestId);
      row = (await verificationCaseRepo.findById(ctx, id)) ?? row;
    }
    const stages = await verificationCaseStageRepo.listForCase(ctx, row.id);
    const order = new Map<string, number>(DECISION_DESK_STAGES.map((s) => [s.id, s.order]));
    stages.sort((a, b) => (order.get(a.stageId) ?? 99) - (order.get(b.stageId) ?? 99));
    return { case: toCaseDto(row), stages: stages.map(toStageDto), catalog: DECISION_DESK_STAGES };
  });
}

export async function refreshVerificationCase(
  ctx: TenantContext,
  id: string,
): Promise<VerificationCaseDetail> {
  return getVerificationCase(ctx, id, { sync: true });
}

export async function runVerificationCaseStage(
  ctx: TenantContext,
  id: string,
  stageId: string,
): Promise<VerificationCaseDetail> {
  const row = await withVerificationCaseTables(() => loadOrThrow(ctx, id));
  const requestId = row.requestId ?? row.zohoDealId;
  const started = await runDecisionDeskStage(requestId, stageId);
  if (!started.ok) {
    await verificationCaseStageRepo.upsertMany(ctx, row.id, [
      { stageId, status: 'failed', error: started.error ?? 'run failed' },
    ]);
  }
  await syncOrWarn(ctx, row.id, requestId);
  return getVerificationCase(ctx, id, { sync: false });
}

export async function approveVerificationCaseStage(
  ctx: TenantContext,
  id: string,
  stageId: string,
  note?: string,
): Promise<VerificationCaseDetail> {
  const row = await withVerificationCaseTables(() => loadOrThrow(ctx, id));
  const requestId = row.requestId ?? row.zohoDealId;
  const done = await approveDecisionDeskStage(requestId, stageId, note);
  if (!done.ok) {
    await verificationCaseStageRepo.upsertMany(ctx, row.id, [
      { stageId, status: 'failed', error: done.error ?? 'approve failed' },
    ]);
  }
  await syncOrWarn(ctx, row.id, requestId);
  return getVerificationCase(ctx, id, { sync: false });
}

export async function decideVerificationCase(
  ctx: TenantContext,
  id: string,
  decision: 'APPROVED' | 'REJECTED' | 'REVIEW',
  reason?: string,
): Promise<VerificationCaseDetail> {
  const row = await withVerificationCaseTables(() => loadOrThrow(ctx, id));
  const requestId = row.requestId ?? row.zohoDealId;
  const done = await submitManualDecision(requestId, decision, reason);
  if (!done.ok) {
    await verificationCaseRepo.update(ctx, row.id, {
      lastDecision: done.error ?? 'decision failed',
    });
  }
  await syncOrWarn(ctx, row.id, requestId);
  return getVerificationCase(ctx, id, { sync: false });
}
