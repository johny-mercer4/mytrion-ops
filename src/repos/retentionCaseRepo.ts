/**
 * Retention cases repo — tenant-scoped CRUD over the v2 workflow tables
 * (phase/status lookups, timers, events). Status transitions append audit rows.
 */
import { and, asc, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  RETENTION_PHASE,
  RETENTION_STATUS,
  RETENTION_TERMINAL_STATUSES,
  retentionCaseEvents,
  retentionCases,
  retentionPhases,
  retentionStatuses,
  type AgentOutcome,
  type CommunicationChannel,
  type DissatisfactionReason,
  type NewRetentionCase,
  type RetentionCase,
  type RetentionCaseEvent,
  type TransactionFrequency,
} from '../db/schema/index.js';
import { ConflictError } from '../lib/errors.js';
import { initialPhase1Deadline } from '../modules/retention/phase1.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, isUniqueViolation, normalizePagination } from './util.js';

export interface RetentionCaseDto {
  id: string;
  carrierId: string;
  zohoDealId: string | null;
  companyName: string | null;
  applicationId: string | null;
  agentName: string | null;
  contactPhone: string | null;
  preferredLanguage: string | null;
  isSpanishDesk: boolean;
  phaseCode: string;
  statusCode: string;
  phaseChangedAt: string;
  transactionFrequency: TransactionFrequency | null;
  agentOutcome: AgentOutcome | null;
  dissatisfactionReason: DissatisfactionReason | null;
  reasonNote: string | null;
  assignedAgentZohoUserId: string | null;
  poolOwnerZohoUserId: string | null;
  pendingClaimantZohoUserId: string | null;
  assignmentCount: number;
  openPoolAttemptCount: number;
  retentionToPoolCount: number;
  outOfReachAttempts: number;
  dealOwnerChanged: boolean;
  currentDeadlineAt: string | null;
  currentDeadlineType: string | null;
  vacationCountdownEnd: string | null;
  citiFolderEnteredAt: string | null;
  citiFolderHoldUntil: string | null;
  lastReviewCycleAt: string | null;
  salesManagerZohoUserId: string | null;
  thresholdDays: number | null;
  lastTransactionAt: string | null;
  daysInactive: number | null;
  txCount90d: number | null;
  gallons90d: number | null;
  activeCards: number | null;
  source: 'auto' | 'manual';
  lastSyncedAt: string | null;
  closedAt: string | null;
  /** Derived: open when closed_at is null. */
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RetentionMetricsInput {
  transactionFrequency?: TransactionFrequency | undefined;
  thresholdDays?: number | undefined;
  lastTransactionAt?: Date | null | undefined;
  daysInactive?: number | undefined;
  txCount90d?: number | undefined;
  gallons90d?: number | undefined;
  activeCards?: number | null | undefined;
}

export interface CreateRetentionCaseInput {
  carrierId: string;
  zohoDealId?: string | undefined;
  companyName?: string | undefined;
  applicationId?: string | undefined;
  agentName?: string | undefined;
  contactPhone?: string | undefined;
  preferredLanguage?: string | null | undefined;
  isSpanishDesk?: boolean | undefined;
  phaseCode?: string | undefined;
  statusCode?: string | undefined;
  assignedAgentZohoUserId?: string | undefined;
  dissatisfactionReason?: DissatisfactionReason | undefined;
  reasonNote?: string | undefined;
  source?: 'auto' | 'manual' | undefined;
  metrics?: RetentionMetricsInput | undefined;
  actorZohoUserId?: string | undefined;
}

export interface UpdateRetentionCaseInput {
  phaseCode?: string | undefined;
  statusCode?: string | undefined;
  agentOutcome?: AgentOutcome | null | undefined;
  dissatisfactionReason?: DissatisfactionReason | null | undefined;
  reasonNote?: string | null | undefined;
  assignedAgentZohoUserId?: string | null | undefined;
  poolOwnerZohoUserId?: string | null | undefined;
  pendingClaimantZohoUserId?: string | null | undefined;
  assignmentCount?: number | undefined;
  openPoolAttemptCount?: number | undefined;
  retentionToPoolCount?: number | undefined;
  outOfReachAttempts?: number | undefined;
  dealOwnerChanged?: boolean | undefined;
  currentDeadlineAt?: Date | null | undefined;
  currentDeadlineType?: string | null | undefined;
  vacationCountdownEnd?: Date | null | undefined;
  citiFolderEnteredAt?: Date | null | undefined;
  citiFolderHoldUntil?: Date | null | undefined;
  lastReviewCycleAt?: Date | null | undefined;
  salesManagerZohoUserId?: string | null | undefined;
  agentName?: string | null | undefined;
  contactPhone?: string | null | undefined;
  preferredLanguage?: string | null | undefined;
  isSpanishDesk?: boolean | undefined;
  zohoDealId?: string | null | undefined;
  metrics?: RetentionMetricsInput | undefined;
  lastSyncedAt?: Date | undefined;
  actorZohoUserId?: string | undefined;
  eventType?: string | undefined;
  eventNotes?: string | undefined;
}

export interface ListRetentionCasesOpts {
  limit?: number;
  offset?: number;
  phaseCode?: string;
  statusCode?: string;
  /** open = closed_at IS NULL; closed = closed_at IS NOT NULL */
  open?: boolean;
  carrierId?: string;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const trimOrNull = (v: string | null | undefined): string | null => v?.trim() || null;

export function toRetentionCaseDto(row: RetentionCase): RetentionCaseDto {
  return {
    id: String(row.id),
    carrierId: row.carrierId,
    zohoDealId: row.zohoDealId,
    companyName: row.companyName,
    applicationId: row.applicationId,
    agentName: row.agentName,
    contactPhone: row.contactPhone,
    preferredLanguage: row.preferredLanguage,
    isSpanishDesk: row.isSpanishDesk,
    phaseCode: row.phaseCode,
    statusCode: row.statusCode,
    phaseChangedAt: row.phaseChangedAt.toISOString(),
    transactionFrequency: row.transactionFrequency,
    agentOutcome: row.agentOutcome,
    dissatisfactionReason: row.dissatisfactionReason,
    reasonNote: row.reasonNote,
    assignedAgentZohoUserId: row.assignedAgentZohoUserId,
    poolOwnerZohoUserId: row.poolOwnerZohoUserId,
    pendingClaimantZohoUserId: row.pendingClaimantZohoUserId,
    assignmentCount: row.assignmentCount,
    openPoolAttemptCount: row.openPoolAttemptCount,
    retentionToPoolCount: row.retentionToPoolCount,
    outOfReachAttempts: row.outOfReachAttempts,
    dealOwnerChanged: row.dealOwnerChanged,
    currentDeadlineAt: iso(row.currentDeadlineAt),
    currentDeadlineType: row.currentDeadlineType,
    vacationCountdownEnd: iso(row.vacationCountdownEnd),
    citiFolderEnteredAt: iso(row.citiFolderEnteredAt),
    citiFolderHoldUntil: iso(row.citiFolderHoldUntil),
    lastReviewCycleAt: iso(row.lastReviewCycleAt),
    salesManagerZohoUserId: row.salesManagerZohoUserId,
    thresholdDays: row.thresholdDays,
    lastTransactionAt: iso(row.lastTransactionAt),
    daysInactive: row.daysInactive,
    txCount90d: row.txCount90d,
    gallons90d: row.gallons90d,
    activeCards: row.activeCards,
    source: row.source,
    lastSyncedAt: iso(row.lastSyncedAt),
    closedAt: iso(row.closedAt),
    isOpen: row.closedAt == null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function metricsToSet(metrics: RetentionMetricsInput): Partial<NewRetentionCase> {
  const set: Partial<NewRetentionCase> = {};
  if (metrics.transactionFrequency !== undefined) {
    set.transactionFrequency = metrics.transactionFrequency;
  }
  if (metrics.thresholdDays !== undefined) set.thresholdDays = metrics.thresholdDays;
  if (metrics.lastTransactionAt !== undefined) set.lastTransactionAt = metrics.lastTransactionAt;
  if (metrics.daysInactive !== undefined) set.daysInactive = metrics.daysInactive;
  if (metrics.txCount90d !== undefined) set.txCount90d = metrics.txCount90d;
  if (metrics.gallons90d !== undefined) set.gallons90d = metrics.gallons90d;
  if (metrics.activeCards !== undefined) set.activeCards = metrics.activeCards;
  return set;
}

export interface RetentionCaseEventDto {
  id: string;
  caseId: string;
  fromStatus: string | null;
  toStatus: string;
  eventType: string;
  actorZohoUserId: string | null;
  channel: CommunicationChannel | null;
  notes: string | null;
  evidenceUrl: string | null;
  occurredAt: string;
}

export function toRetentionCaseEventDto(row: RetentionCaseEvent): RetentionCaseEventDto {
  return {
    id: String(row.id),
    caseId: String(row.caseId),
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    eventType: row.eventType,
    actorZohoUserId: row.actorZohoUserId,
    channel: row.channel,
    notes: row.notes,
    evidenceUrl: row.evidenceUrl,
    occurredAt: row.occurredAt.toISOString(),
  };
}

export async function appendRetentionEvent(input: {
  caseId: number;
  fromStatus: string | null;
  toStatus: string;
  eventType: string;
  actorZohoUserId?: string | undefined;
  notes?: string | undefined;
  channel?: CommunicationChannel | undefined;
  evidenceUrl?: string | undefined;
}): Promise<void> {
  await db.insert(retentionCaseEvents).values({
    caseId: input.caseId,
    fromStatus: input.fromStatus,
    toStatus: input.toStatus,
    eventType: input.eventType,
    actorZohoUserId: trimOrNull(input.actorZohoUserId),
    notes: trimOrNull(input.notes),
    evidenceUrl: trimOrNull(input.evidenceUrl),
    ...(input.channel !== undefined ? { channel: input.channel } : {}),
  });
}

export const retentionCaseRepo = {
  async listPhases(): Promise<Array<{ code: string; label: string; sortOrder: number }>> {
    const rows = await db.select().from(retentionPhases).orderBy(asc(retentionPhases.sortOrder));
    return rows.map((r) => ({ code: r.code, label: r.label, sortOrder: r.sortOrder }));
  },

  async listStatuses(phaseCode?: string): Promise<
    Array<{
      code: string;
      phaseCode: string;
      label: string;
      isTerminal: boolean;
      boardColumn: string | null;
      sortOrder: number;
    }>
  > {
    const rows = phaseCode
      ? await db.select().from(retentionStatuses).where(eq(retentionStatuses.phaseCode, phaseCode))
      : await db.select().from(retentionStatuses);
    return rows.map((r) => ({
      code: r.code,
      phaseCode: r.phaseCode,
      label: r.label,
      isTerminal: r.isTerminal,
      boardColumn: r.boardColumn ?? null,
      sortOrder: r.sortOrder,
    }));
  },

  async list(
    ctx: TenantContext,
    opts: ListRetentionCasesOpts = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const { limit, offset } = normalizePagination(opts);
    const clauses = [eq(retentionCases.tenantId, ctx.tenantId)];
    if (opts.phaseCode) clauses.push(eq(retentionCases.phaseCode, opts.phaseCode));
    if (opts.statusCode) clauses.push(eq(retentionCases.statusCode, opts.statusCode));
    if (opts.open === true) clauses.push(isNull(retentionCases.closedAt));
    if (opts.open === false) clauses.push(sql`${retentionCases.closedAt} IS NOT NULL`);
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
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return undefined;
    const rows = await db
      .select()
      .from(retentionCases)
      .where(and(eq(retentionCases.id, numericId), eq(retentionCases.tenantId, ctx.tenantId)))
      .limit(1);
    return rows[0];
  },

  async listOpen(ctx: TenantContext): Promise<RetentionCase[]> {
    return db
      .select()
      .from(retentionCases)
      .where(and(eq(retentionCases.tenantId, ctx.tenantId), isNull(retentionCases.closedAt)))
      .limit(5000);
  },

  /** Open cases whose current_deadline_at is strictly before `now` (timer sweeper). */
  async listOpenPastDeadline(
    ctx: TenantContext,
    now: Date,
    limit = 200,
  ): Promise<RetentionCase[]> {
    const cap = Math.min(Math.max(limit, 1), 500);
    return db
      .select()
      .from(retentionCases)
      .where(
        and(
          eq(retentionCases.tenantId, ctx.tenantId),
          isNull(retentionCases.closedAt),
          lt(retentionCases.currentDeadlineAt, now),
        ),
      )
      .orderBy(asc(retentionCases.currentDeadlineAt))
      .limit(cap);
  },

  async create(ctx: TenantContext, input: CreateRetentionCaseInput): Promise<RetentionCaseDto> {
    const phaseCode = input.phaseCode ?? RETENTION_PHASE.agent;
    // New breach cases open in Working — no manual Start working step.
    const statusCode = input.statusCode ?? RETENTION_STATUS.p1InProgress;
    const stampDeadline =
      phaseCode === RETENTION_PHASE.agent &&
      (statusCode === RETENTION_STATUS.p1New ||
        statusCode === RETENTION_STATUS.p1InProgress) &&
      !RETENTION_TERMINAL_STATUSES.has(statusCode);
    const deadline = stampDeadline ? initialPhase1Deadline() : null;
    const values: NewRetentionCase = {
      tenantId: ctx.tenantId,
      carrierId: input.carrierId.trim(),
      zohoDealId: trimOrNull(input.zohoDealId),
      companyName: trimOrNull(input.companyName),
      applicationId: trimOrNull(input.applicationId),
      agentName: trimOrNull(input.agentName),
      contactPhone: trimOrNull(input.contactPhone),
      preferredLanguage: trimOrNull(input.preferredLanguage),
      isSpanishDesk: input.isSpanishDesk ?? false,
      phaseCode,
      statusCode,
      assignedAgentZohoUserId: trimOrNull(input.assignedAgentZohoUserId),
      reasonNote: trimOrNull(input.reasonNote),
      source: input.source ?? 'manual',
      closedAt: RETENTION_TERMINAL_STATUSES.has(statusCode) ? new Date() : null,
      ...(deadline
        ? {
            currentDeadlineAt: deadline.currentDeadlineAt,
            currentDeadlineType: deadline.currentDeadlineType,
          }
        : {}),
      ...(input.dissatisfactionReason !== undefined
        ? { dissatisfactionReason: input.dissatisfactionReason }
        : {}),
      ...(input.metrics ? { ...metricsToSet(input.metrics), lastSyncedAt: new Date() } : {}),
    };
    try {
      const rows = await db.insert(retentionCases).values(values).returning();
      const row = firstOrThrow(rows, 'Failed to insert retention case');
      await appendRetentionEvent({
        caseId: row.id,
        fromStatus: null,
        toStatus: row.statusCode,
        eventType: 'created',
        actorZohoUserId: input.actorZohoUserId,
      });
      return toRetentionCaseDto(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          `Carrier '${values.carrierId}' already has an open retention case`,
        );
      }
      throw err;
    }
  },

  async update(
    ctx: TenantContext,
    id: string,
    patch: UpdateRetentionCaseInput,
  ): Promise<RetentionCaseDto | null> {
    const existing = await this.findById(ctx, id);
    if (!existing) return null;

    const set: Partial<NewRetentionCase> = { updatedAt: new Date() };
    if (patch.phaseCode !== undefined && patch.phaseCode !== existing.phaseCode) {
      set.phaseCode = patch.phaseCode;
      set.phaseChangedAt = new Date();
    }
    if (patch.statusCode !== undefined) {
      set.statusCode = patch.statusCode;
      set.closedAt = RETENTION_TERMINAL_STATUSES.has(patch.statusCode) ? new Date() : null;
    }
    if (patch.agentOutcome !== undefined) set.agentOutcome = patch.agentOutcome;
    if (patch.dissatisfactionReason !== undefined) {
      set.dissatisfactionReason = patch.dissatisfactionReason;
    }
    if (patch.reasonNote !== undefined) set.reasonNote = trimOrNull(patch.reasonNote);
    if (patch.assignedAgentZohoUserId !== undefined) {
      set.assignedAgentZohoUserId = trimOrNull(patch.assignedAgentZohoUserId);
    }
    if (patch.poolOwnerZohoUserId !== undefined) {
      set.poolOwnerZohoUserId = trimOrNull(patch.poolOwnerZohoUserId);
    }
    if (patch.pendingClaimantZohoUserId !== undefined) {
      set.pendingClaimantZohoUserId = trimOrNull(patch.pendingClaimantZohoUserId);
    }
    if (patch.assignmentCount !== undefined) set.assignmentCount = patch.assignmentCount;
    if (patch.openPoolAttemptCount !== undefined) {
      set.openPoolAttemptCount = patch.openPoolAttemptCount;
    }
    if (patch.retentionToPoolCount !== undefined) {
      set.retentionToPoolCount = patch.retentionToPoolCount;
    }
    if (patch.outOfReachAttempts !== undefined) set.outOfReachAttempts = patch.outOfReachAttempts;
    if (patch.dealOwnerChanged !== undefined) set.dealOwnerChanged = patch.dealOwnerChanged;
    if (patch.currentDeadlineAt !== undefined) set.currentDeadlineAt = patch.currentDeadlineAt;
    if (patch.currentDeadlineType !== undefined) {
      set.currentDeadlineType = trimOrNull(patch.currentDeadlineType);
    }
    if (patch.vacationCountdownEnd !== undefined) {
      set.vacationCountdownEnd = patch.vacationCountdownEnd;
    }
    if (patch.citiFolderEnteredAt !== undefined) {
      set.citiFolderEnteredAt = patch.citiFolderEnteredAt;
    }
    if (patch.citiFolderHoldUntil !== undefined) {
      set.citiFolderHoldUntil = patch.citiFolderHoldUntil;
    }
    if (patch.lastReviewCycleAt !== undefined) set.lastReviewCycleAt = patch.lastReviewCycleAt;
    if (patch.salesManagerZohoUserId !== undefined) {
      set.salesManagerZohoUserId = trimOrNull(patch.salesManagerZohoUserId);
    }
    if (patch.agentName !== undefined) set.agentName = trimOrNull(patch.agentName);
    if (patch.contactPhone !== undefined) set.contactPhone = trimOrNull(patch.contactPhone);
    if (patch.preferredLanguage !== undefined) {
      set.preferredLanguage = trimOrNull(patch.preferredLanguage);
    }
    if (patch.isSpanishDesk !== undefined) set.isSpanishDesk = patch.isSpanishDesk;
    if (patch.zohoDealId !== undefined) set.zohoDealId = trimOrNull(patch.zohoDealId);
    if (patch.metrics) Object.assign(set, metricsToSet(patch.metrics));
    if (patch.lastSyncedAt !== undefined) set.lastSyncedAt = patch.lastSyncedAt;

    const rows = await db
      .update(retentionCases)
      .set(set)
      .where(and(eq(retentionCases.id, existing.id), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning();
    const row = rows[0];
    if (!row) return null;

    if (patch.statusCode !== undefined && patch.statusCode !== existing.statusCode) {
      await appendRetentionEvent({
        caseId: row.id,
        fromStatus: existing.statusCode,
        toStatus: row.statusCode,
        eventType: patch.eventType ?? 'status_change',
        actorZohoUserId: patch.actorZohoUserId,
        notes: patch.eventNotes,
      });
    }
    return toRetentionCaseDto(row);
  },

  async deleteById(ctx: TenantContext, id: string): Promise<boolean> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return false;
    // Events first (FK).
    await db.delete(retentionCaseEvents).where(eq(retentionCaseEvents.caseId, numericId));
    const rows = await db
      .delete(retentionCases)
      .where(and(eq(retentionCases.id, numericId), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning({ id: retentionCases.id });
    return rows.length > 0;
  },
};
