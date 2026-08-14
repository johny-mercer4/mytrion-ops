import { AppError, NotFoundError } from '../../lib/errors.js';
import { databaseHost } from '../../config/env.js';
import {
  approveDecisionDeskStage,
  resetDecisionDeskStage,
  runDecisionDeskStage,
  submitManualDecision,
  type StageReadiness,
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
import { maybeAdvanceFirstRun } from './firstRunTrigger.js';
import { caseSla, creditPlatformActor } from './verificationCaseDesk.js';
import {
  listRequestAttachments,
  loadCaseReadiness,
  type CaseAttachment,
} from './verificationCaseExtras.js';
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
  const cpOwnerUsername = 'cpOwnerUsername' in row ? row.cpOwnerUsername ?? null : null;
  const sla = caseSla({
    cpOwnerUsername,
    cpReviewUpdatedAt: 'cpReviewUpdatedAt' in row ? row.cpReviewUpdatedAt : null,
    cpClaimedAt: 'cpClaimedAt' in row ? row.cpClaimedAt : null,
    lastSyncedAt: 'lastSyncedAt' in row ? row.lastSyncedAt : null,
    createdAt: row.createdAt,
  });
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
    firstRunStatus: 'firstRunStatus' in row ? row.firstRunStatus ?? 'idle' : 'idle',
    firstRunError: 'firstRunError' in row ? row.firstRunError ?? null : null,
    cpOwnerUsername,
    approvedLimit: 'approvedLimit' in row ? row.approvedLimit ?? null : null,
    paymentType: 'paymentType' in row ? row.paymentType ?? null : null,
    billingCycle: 'billingCycle' in row ? row.billingCycle ?? null : null,
    plaidStatus: 'plaidStatus' in row ? row.plaidStatus ?? null : null,
    plaidLinkUrl: 'plaidLinkUrl' in row ? row.plaidLinkUrl ?? null : null,
    plaidMode: 'plaidMode' in row ? row.plaidMode ?? null : null,
    slaStale: sla.stale,
    slaIdleMinutes: sla.idleMinutes,
    slaLabel: sla.label,
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
  attachments: CaseAttachment[];
  readiness: StageReadiness | null;
}

async function loadOrThrow(ctx: TenantContext, id: string): Promise<VerificationCase> {
  const row = await verificationCaseRepo.findById(ctx, id);
  if (!row) throw new NotFoundError('Verification case not found');
  return row;
}

/**
 * The credit-platform request id for a legacy Decision Desk action.
 *
 * `zoho_deal_id` became nullable in 0121 because a sales-originated application has no Zoho Deal —
 * and such a case has no credit-platform request either. Falling through with a null would send
 * `undefined` down the HTTP client and fail somewhere unhelpful, so the refusal is stated here:
 * these actions belong to the retired credit_platform pipeline, and a new-era case is not part of it.
 */
function creditPlatformRequestId(row: VerificationCase): string {
  const requestId = row.requestId ?? row.zohoDealId;
  if (!requestId) {
    throw new AppError(
      'This application was raised in Sales and is underwritten by the Mytrion verification flow — it has no credit-platform request to act on.',
      { statusCode: 409, code: 'VERIFICATION_NOT_CREDIT_PLATFORM_CASE', expose: true },
    );
  }
  return requestId;
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
  filter: {
    status?: VerificationCaseStatus;
    query?: string;
    unmatched?: boolean;
    owner?: 'unclaimed' | 'mine' | 'others';
    limit?: number;
    offset?: number;
  },
) {
  return withVerificationCaseTables(async () => {
    const scoped = { ...filter, viewer: creditPlatformActor(ctx) };
    const [items, aggregates, total] = await Promise.all([
      verificationCaseRepo.list(ctx, scoped),
      verificationCaseRepo.aggregates(ctx, { viewer: scoped.viewer }),
      verificationCaseRepo.count(ctx, scoped),
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
    const lookupId = row.requestId ?? row.zohoDealId;
    if (opts.sync !== false && lookupId) {
      await syncOrWarn(ctx, row.id, lookupId);
      row = (await verificationCaseRepo.findById(ctx, id)) ?? row;
    }
    const stages = await verificationCaseStageRepo.listForCase(ctx, row.id);
    const order = new Map<string, number>(DECISION_DESK_STAGES.map((s) => [s.id, s.order]));
    stages.sort((a, b) => (order.get(a.stageId) ?? 99) - (order.get(b.stageId) ?? 99));
    const requestId = row.requestId;
    const [attachments, readiness] = requestId
      ? await Promise.all([listRequestAttachments(requestId), loadCaseReadiness(requestId)])
      : [[], null];
    return {
      case: toCaseDto(row),
      stages: stages.map(toStageDto),
      catalog: DECISION_DESK_STAGES,
      attachments,
      readiness,
    };
  });
}

export async function refreshVerificationCase(
  ctx: TenantContext,
  id: string,
): Promise<VerificationCaseDetail> {
  const detail = await getVerificationCase(ctx, id, { sync: true });
  if (detail.case.requestId) {
    try {
      await maybeAdvanceFirstRun(ctx, id, { agent: 'system', wait: false });
    } catch (err) {
      logger.warn({ err, caseId: id }, 'verification first-run advance skipped');
    }
  }
  return getVerificationCase(ctx, id, { sync: false });
}

export async function runVerificationCaseStage(
  ctx: TenantContext,
  id: string,
  stageId: string,
  opts: { bureauProvider?: string } = {},
): Promise<VerificationCaseDetail> {
  const row = await withVerificationCaseTables(() => loadOrThrow(ctx, id));
  const requestId = creditPlatformRequestId(row);
  const started = await runDecisionDeskStage(requestId, stageId, {
    actor: creditPlatformActor(ctx),
    ...(opts.bureauProvider ? { bureauProvider: opts.bureauProvider } : {}),
  });
  if (!started.ok) {
    await verificationCaseStageRepo.upsertMany(ctx, row.id, [
      { stageId, status: 'failed', error: started.error ?? 'run failed' },
    ]);
  }
  await syncOrWarn(ctx, row.id, requestId);
  return getVerificationCase(ctx, id, { sync: false });
}

export async function resetVerificationCaseStage(
  ctx: TenantContext,
  id: string,
  stageId: string,
): Promise<VerificationCaseDetail> {
  const row = await withVerificationCaseTables(() => loadOrThrow(ctx, id));
  const requestId = creditPlatformRequestId(row);
  const done = await resetDecisionDeskStage(requestId, stageId, creditPlatformActor(ctx));
  if (!done.ok) {
    await verificationCaseStageRepo.upsertMany(ctx, row.id, [
      { stageId, status: 'failed', error: done.error ?? 'reset failed' },
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
  const requestId = creditPlatformRequestId(row);
  const done = await approveDecisionDeskStage(requestId, stageId, note, creditPlatformActor(ctx));
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
  const requestId = creditPlatformRequestId(row);
  const done = await submitManualDecision(requestId, decision, reason, creditPlatformActor(ctx));
  if (!done.ok) {
    await verificationCaseRepo.update(ctx, row.id, {
      lastDecision: done.error ?? 'decision failed',
    });
  }
  await syncOrWarn(ctx, row.id, requestId);
  return getVerificationCase(ctx, id, { sync: false });
}
