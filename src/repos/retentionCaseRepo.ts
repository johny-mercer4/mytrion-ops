import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  retentionCases,
  type FrequencyClass,
  type NewRetentionCase,
  type PoolAssignment,
  type RetentionCase,
  type RetentionCaseStatus,
  type RetentionOutcome,
  type RetentionPhase,
  type RetentionStage,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, isUniqueViolation, normalizePagination } from './util.js';

/** Flat DTO for the Retention Mytrion UI (timestamps as ISO strings). */
export interface RetentionCaseDto {
  id: string;
  carrierId: string;
  companyName: string | null;
  applicationId: string | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  phase: RetentionPhase;
  phaseChangedAt: string;
  stage: RetentionStage;
  status: RetentionCaseStatus;
  outcome: RetentionOutcome | null;
  closedAt: string | null;
  inactivityReason: string | null;
  reasonNote: string | null;
  outOfReachAttempts: number;
  frequencyClass: FrequencyClass | null;
  thresholdDays: number | null;
  lastTransactionAt: string | null;
  daysInactive: number | null;
  txCount90d: number | null;
  gallons90d: number | null;
  activeCards: number | null;
  poolAssignment: PoolAssignment | null;
  poolTakenBy: string | null;
  source: 'auto' | 'manual';
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRetentionCaseInput {
  carrierId: string;
  companyName?: string | undefined;
  applicationId?: string | undefined;
  agentName?: string | undefined;
  agentZohoUserId?: string | undefined;
  phase?: RetentionPhase | undefined;
  stage?: RetentionStage | undefined;
  inactivityReason?: string | undefined;
  reasonNote?: string | undefined;
  source?: 'auto' | 'manual' | undefined;
  metrics?: RetentionMetricsInput | undefined;
}

/** DWH-derived fields refreshed by every sync run. */
export interface RetentionMetricsInput {
  frequencyClass?: FrequencyClass | undefined;
  thresholdDays?: number | undefined;
  lastTransactionAt?: Date | null | undefined;
  daysInactive?: number | undefined;
  txCount90d?: number | undefined;
  gallons90d?: number | undefined;
  activeCards?: number | null | undefined;
}

export interface UpdateRetentionCaseInput {
  phase?: RetentionPhase | undefined;
  stage?: RetentionStage | undefined;
  status?: RetentionCaseStatus | undefined;
  outcome?: RetentionOutcome | null | undefined;
  inactivityReason?: string | null | undefined;
  reasonNote?: string | null | undefined;
  outOfReachAttempts?: number | undefined;
  poolAssignment?: PoolAssignment | null | undefined;
  poolTakenBy?: string | null | undefined;
  agentName?: string | null | undefined;
  agentZohoUserId?: string | null | undefined;
  metrics?: RetentionMetricsInput | undefined;
  lastSyncedAt?: Date | undefined;
}

export interface ListRetentionCasesOpts {
  limit?: number;
  offset?: number;
  phase?: RetentionPhase;
  status?: RetentionCaseStatus;
  stage?: RetentionStage;
  carrierId?: string;
}

export function toRetentionCaseDto(row: RetentionCase): RetentionCaseDto {
  return {
    id: row.id,
    carrierId: row.carrierId,
    companyName: row.companyName,
    applicationId: row.applicationId,
    agentName: row.agentName,
    agentZohoUserId: row.agentZohoUserId,
    phase: row.phase,
    phaseChangedAt: row.phaseChangedAt.toISOString(),
    stage: row.stage,
    status: row.status,
    outcome: row.outcome,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    inactivityReason: row.inactivityReason,
    reasonNote: row.reasonNote,
    outOfReachAttempts: row.outOfReachAttempts,
    frequencyClass: row.frequencyClass,
    thresholdDays: row.thresholdDays,
    lastTransactionAt: row.lastTransactionAt ? row.lastTransactionAt.toISOString() : null,
    daysInactive: row.daysInactive,
    txCount90d: row.txCount90d,
    gallons90d: row.gallons90d,
    activeCards: row.activeCards,
    poolAssignment: row.poolAssignment,
    poolTakenBy: row.poolTakenBy,
    source: row.source,
    lastSyncedAt: row.lastSyncedAt ? row.lastSyncedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const trimOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

function metricsToSet(metrics: RetentionMetricsInput): Partial<NewRetentionCase> {
  const set: Partial<NewRetentionCase> = {};
  if (metrics.frequencyClass !== undefined) set.frequencyClass = metrics.frequencyClass;
  if (metrics.thresholdDays !== undefined) set.thresholdDays = metrics.thresholdDays;
  if (metrics.lastTransactionAt !== undefined) set.lastTransactionAt = metrics.lastTransactionAt;
  if (metrics.daysInactive !== undefined) set.daysInactive = metrics.daysInactive;
  if (metrics.txCount90d !== undefined) set.txCount90d = metrics.txCount90d;
  if (metrics.gallons90d !== undefined) set.gallons90d = metrics.gallons90d;
  if (metrics.activeCards !== undefined) set.activeCards = metrics.activeCards;
  return set;
}

export const retentionCaseRepo = {
  async list(
    ctx: TenantContext,
    opts: ListRetentionCasesOpts = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const { limit, offset } = normalizePagination(opts);
    const clauses = [eq(retentionCases.tenantId, ctx.tenantId)];
    if (opts.phase) clauses.push(eq(retentionCases.phase, opts.phase));
    if (opts.status) clauses.push(eq(retentionCases.status, opts.status));
    if (opts.stage) clauses.push(eq(retentionCases.stage, opts.stage));
    if (opts.carrierId) clauses.push(eq(retentionCases.carrierId, opts.carrierId));
    const where = and(...clauses);
    const [rows, counts] = await Promise.all([
      db
        .select()
        .from(retentionCases)
        .where(where)
        .orderBy(desc(retentionCases.createdAt))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(retentionCases).where(where),
    ]);
    return { cases: rows.map(toRetentionCaseDto), total: counts[0]?.count ?? 0 };
  },

  async findById(ctx: TenantContext, id: string): Promise<RetentionCase | undefined> {
    const rows = await db
      .select()
      .from(retentionCases)
      .where(and(eq(retentionCases.id, id), eq(retentionCases.tenantId, ctx.tenantId)))
      .limit(1);
    return rows[0];
  },

  /** Every open case for the tenant — the sync run's working set (capped defensively). */
  async listOpen(ctx: TenantContext): Promise<RetentionCase[]> {
    return db
      .select()
      .from(retentionCases)
      .where(and(eq(retentionCases.tenantId, ctx.tenantId), eq(retentionCases.status, 'open')))
      .limit(5000);
  },

  async create(ctx: TenantContext, input: CreateRetentionCaseInput): Promise<RetentionCaseDto> {
    const values: NewRetentionCase = {
      tenantId: ctx.tenantId,
      carrierId: input.carrierId.trim(),
      companyName: trimOrNull(input.companyName),
      applicationId: trimOrNull(input.applicationId),
      agentName: trimOrNull(input.agentName),
      agentZohoUserId: trimOrNull(input.agentZohoUserId),
      phase: input.phase ?? 'sales',
      stage: input.stage ?? 'inactive_no_reason',
      inactivityReason: trimOrNull(input.inactivityReason),
      reasonNote: trimOrNull(input.reasonNote),
      source: input.source ?? 'manual',
      ...(input.metrics ? { ...metricsToSet(input.metrics), lastSyncedAt: new Date() } : {}),
    };
    try {
      const rows = await db.insert(retentionCases).values(values).returning();
      return toRetentionCaseDto(firstOrThrow(rows, 'Failed to insert retention case'));
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          `Carrier '${values.carrierId}' already has an open retention case`,
        );
      }
      throw err;
    }
  },

  /**
   * Patch provided fields (tenant-scoped). A phase change stamps phaseChangedAt; closing
   * (status → 'closed') stamps closedAt, reopening clears it. Returns null when no such
   * id exists for this tenant.
   */
  async update(
    ctx: TenantContext,
    id: string,
    patch: UpdateRetentionCaseInput,
  ): Promise<RetentionCaseDto | null> {
    const set: Partial<NewRetentionCase> = { updatedAt: new Date() };
    if (patch.phase !== undefined) {
      set.phase = patch.phase;
      set.phaseChangedAt = new Date();
    }
    if (patch.stage !== undefined) set.stage = patch.stage;
    if (patch.status !== undefined) {
      set.status = patch.status;
      set.closedAt = patch.status === 'closed' ? new Date() : null;
    }
    if (patch.outcome !== undefined) set.outcome = patch.outcome;
    if (patch.inactivityReason !== undefined)
      set.inactivityReason = trimOrNull(patch.inactivityReason);
    if (patch.reasonNote !== undefined) set.reasonNote = trimOrNull(patch.reasonNote);
    if (patch.outOfReachAttempts !== undefined) set.outOfReachAttempts = patch.outOfReachAttempts;
    if (patch.poolAssignment !== undefined) set.poolAssignment = patch.poolAssignment;
    if (patch.poolTakenBy !== undefined) set.poolTakenBy = trimOrNull(patch.poolTakenBy);
    if (patch.agentName !== undefined) set.agentName = trimOrNull(patch.agentName);
    if (patch.agentZohoUserId !== undefined)
      set.agentZohoUserId = trimOrNull(patch.agentZohoUserId);
    if (patch.metrics) Object.assign(set, metricsToSet(patch.metrics));
    if (patch.lastSyncedAt !== undefined) set.lastSyncedAt = patch.lastSyncedAt;
    const rows = await db
      .update(retentionCases)
      .set(set)
      .where(and(eq(retentionCases.id, id), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning();
    const row = rows[0];
    return row ? toRetentionCaseDto(row) : null;
  },

  /** Delete one (tenant-scoped). Returns true when a row was removed. */
  async deleteById(ctx: TenantContext, id: string): Promise<boolean> {
    const rows = await db
      .delete(retentionCases)
      .where(and(eq(retentionCases.id, id), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning({ id: retentionCases.id });
    return rows.length > 0;
  },
};
