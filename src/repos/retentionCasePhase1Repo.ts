/**
 * Phase-1 / Open Pool workflow queries on retention_cases.
 * Kept separate from core CRUD so retentionCaseRepo stays under the file-size cap.
 */
import { and, desc, eq, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  RETENTION_PHASE,
  retentionCaseEvents,
  retentionCases,
  type CommunicationChannel,
} from '../db/schema/index.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import { enterOpenPool } from '../modules/retention/deadlines.js';
import {
  afterRetentionPhaseSideEffects,
  scheduleRetentionPostCommit,
} from '../modules/retention/csRoundRobin.js';
import { notifyOpenPoolOpened } from '../modules/retention/notify.js';
import {
  MAX_OUT_OF_REACH_ATTEMPTS,
  nextCommsAttemptDeadline,
} from '../modules/retention/phase1.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';
import {
  appendRetentionEvent,
  toRetentionCaseDto,
  toRetentionCaseEventDto,
  type RetentionCaseDto,
  type RetentionCaseEventDto,
} from './retentionCaseRepo.js';

export const retentionCasePhase1Repo = {
  /**
   * Cases for a sales agent's board: currently assigned, plus former-owner locked
   * cards (Open Pool / Retention / CITI) keyed by `pool_owner_zoho_user_id`.
   */
  async listForAgent(
    ctx: TenantContext,
    zohoUserId: string,
    opts: { open?: boolean; phaseCode?: string; limit?: number } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const agent = zohoUserId.trim();
    const formerOwnerLocked = and(
      eq(retentionCases.poolOwnerZohoUserId, agent),
      or(
        eq(retentionCases.statusCode, 'p1_open_pool'),
        eq(retentionCases.statusCode, 'p1_pool_claim_pending'),
        eq(retentionCases.phaseCode, RETENTION_PHASE.retention),
        eq(retentionCases.phaseCode, RETENTION_PHASE.citi),
      ),
    );
    const ownership = or(
      eq(retentionCases.assignedAgentZohoUserId, agent),
      formerOwnerLocked,
    );
    const clauses: SQL[] = [eq(retentionCases.tenantId, ctx.tenantId)];
    if (ownership) clauses.push(ownership);
    if (opts.phaseCode) clauses.push(eq(retentionCases.phaseCode, opts.phaseCode));
    if (opts.open === true) clauses.push(isNull(retentionCases.closedAt));
    if (opts.open === false) clauses.push(sql`${retentionCases.closedAt} IS NOT NULL`);
    if (opts.open === undefined) {
      const recentOrOpen = or(
        isNull(retentionCases.closedAt),
        sql`${retentionCases.closedAt} >= now() - interval '14 days'`,
      );
      if (recentOrOpen) clauses.push(recentOrOpen);
    }
    const where = and(...clauses);
    // Single query — each extra round-trip to remote Render Postgres is ~0.5–2s from local.
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.gallons90d), desc(retentionCases.daysInactive))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
  },

  /**
   * Claimable Open Pool cases for Sales Mytrion.
   * Excludes the viewer's own former deals (`pool_owner` = self) — those stay on
   * their Cases Kanban as locked. Still includes the viewer's pending claims.
   */
  async listOpenPool(
    ctx: TenantContext,
    opts: {
      limit?: number;
      pendingForZohoUserId?: string;
      /** Hide cases this agent previously owned (cannot claim own deal). */
      excludePoolOwnerZohoUserId?: string;
    } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const pendingSelf = opts.pendingForZohoUserId?.trim();
    const excludeOwner = opts.excludePoolOwnerZohoUserId?.trim();
    const statusClause: SQL | undefined = pendingSelf
      ? or(
          eq(retentionCases.statusCode, 'p1_open_pool'),
          and(
            eq(retentionCases.statusCode, 'p1_pool_claim_pending'),
            eq(retentionCases.pendingClaimantZohoUserId, pendingSelf),
          ),
        )
      : eq(retentionCases.statusCode, 'p1_open_pool');
    const clauses: SQL[] = [
      eq(retentionCases.tenantId, ctx.tenantId),
      isNull(retentionCases.closedAt),
    ];
    if (statusClause) clauses.push(statusClause);
    if (excludeOwner) {
      // Never list the viewer's own former deals as claimable.
      const notOwnFormerDeal = or(
        isNull(retentionCases.poolOwnerZohoUserId),
        ne(retentionCases.poolOwnerZohoUserId, excludeOwner),
      );
      if (notOwnFormerDeal) clauses.push(notOwnFormerDeal);
    }
    const where = and(...clauses);
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.gallons90d), desc(retentionCases.daysInactive))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
  },

  async getWithEvents(
    ctx: TenantContext,
    id: string,
  ): Promise<{ case: RetentionCaseDto; events: RetentionCaseEventDto[] } | null> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return null;
    const found = await db
      .select()
      .from(retentionCases)
      .where(and(eq(retentionCases.id, numericId), eq(retentionCases.tenantId, ctx.tenantId)))
      .limit(1);
    const row = found[0];
    if (!row) return null;
    const events = await db
      .select()
      .from(retentionCaseEvents)
      .where(eq(retentionCaseEvents.caseId, row.id))
      .orderBy(desc(retentionCaseEvents.occurredAt))
      .limit(100);
    return { case: toRetentionCaseDto(row), events: events.map(toRetentionCaseEventDto) };
  },

  /** Instant Open Pool claim (Zoho + Kanban New). See retentionPoolClaimRepo.claimNow. */
  async claimFromPool(
    ctx: TenantContext,
    id: string,
    newAgentZohoUserId: string,
    opts: { agentName?: string | undefined; reason: string },
  ): Promise<
    RetentionCaseDto & {
      pendingApproval: boolean;
      quota: { used: number; max: number; remaining: number };
    }
  > {
    const { retentionPoolClaimRepo } = await import('./retentionPoolClaimRepo.js');
    return retentionPoolClaimRepo.claimNow(ctx, id, newAgentZohoUserId, opts);
  },

  async logCommsAttempt(
    ctx: TenantContext,
    id: string,
    input: {
      channel: CommunicationChannel;
      notes?: string | undefined;
      /** Screenshot / proof (data URL or https) — required for non-RingCentral channels. */
      evidenceUrl?: string | undefined;
      actorZohoUserId?: string | undefined;
    },
  ): Promise<RetentionCaseDto> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) throw new NotFoundError('Retention case not found');
    const found = await db
      .select()
      .from(retentionCases)
      .where(and(eq(retentionCases.id, numericId), eq(retentionCases.tenantId, ctx.tenantId)))
      .limit(1);
    const existing = found[0];
    if (!existing) throw new NotFoundError('Retention case not found');
    if (existing.closedAt != null) {
      throw new AppError('Case is already closed', {
        statusCode: 409,
        code: 'RETENTION_CLOSED',
        expose: true,
      });
    }
    // Channel attempts only after agent marks Out of Reach.
    if (existing.statusCode !== 'p1_out_of_reach') {
      throw new AppError('Mark Out of Reach before logging channel attempts', {
        statusCode: 409,
        code: 'RETENTION_BAD_STATUS',
        expose: true,
      });
    }
    const evidenceUrl = input.evidenceUrl?.trim() || undefined;
    const noteTrim = input.notes?.trim() || undefined;
    if (input.channel !== 'ringcentral') {
      // Screenshot OR notes — either is enough proof for TG/WA/etc.
      if (!evidenceUrl && !noteTrim) {
        throw new AppError('Add a screenshot or a short note as proof for this channel', {
          statusCode: 400,
          code: 'RETENTION_EVIDENCE_REQUIRED',
          expose: true,
        });
      }
      if (evidenceUrl) {
        if (evidenceUrl.length > 1_800_000) {
          throw new AppError('Screenshot is too large (max ~1.5MB)', {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            expose: true,
          });
        }
        if (
          !evidenceUrl.startsWith('data:image/') &&
          !/^https:\/\//i.test(evidenceUrl)
        ) {
          throw new AppError('Evidence must be an image data URL or https link', {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            expose: true,
          });
        }
      }
    }
    const attempts = Math.min(existing.outOfReachAttempts + 1, MAX_OUT_OF_REACH_ATTEMPTS);
    const toPool = attempts >= MAX_OUT_OF_REACH_ATTEMPTS;
    const previousOwner = existing.assignedAgentZohoUserId;
    const pool = toPool
      ? enterOpenPool({
          agentOutcome: 'out_of_reach',
          previousOwnerZohoUserId: previousOwner,
          assignmentCount: existing.assignmentCount,
          notes: `Attempt ${attempts}/${MAX_OUT_OF_REACH_ATTEMPTS} — sent to Open Pool`,
        })
      : null;
    const nextDeadline = toPool ? null : nextCommsAttemptDeadline();
    // Stay OoR between attempts 1–4 (agent may still pick Reached / Dissatisfied / Vacation).
    // enterOpenPool may return CITI when assignment_count is already at max.
    const rows = await db
      .update(retentionCases)
      .set({
        outOfReachAttempts: toPool ? 0 : attempts,
        phaseCode: toPool ? pool!.phaseCode : existing.phaseCode,
        statusCode: toPool ? pool!.statusCode : 'p1_out_of_reach',
        agentOutcome: toPool ? (pool!.agentOutcome ?? 'out_of_reach') : 'out_of_reach',
        assignedAgentZohoUserId: toPool ? null : existing.assignedAgentZohoUserId,
        poolOwnerZohoUserId: toPool
          ? (pool!.poolOwnerZohoUserId ?? null)
          : existing.poolOwnerZohoUserId,
        pendingClaimantZohoUserId: toPool ? null : existing.pendingClaimantZohoUserId,
        currentDeadlineAt: toPool
          ? (pool!.currentDeadlineAt ?? null)
          : (nextDeadline?.currentDeadlineAt ?? null),
        currentDeadlineType: toPool
          ? (pool!.currentDeadlineType ?? null)
          : (nextDeadline?.currentDeadlineType ?? null),
        citiFolderEnteredAt: toPool
          ? (pool!.citiFolderEnteredAt ?? null)
          : existing.citiFolderEnteredAt,
        citiFolderHoldUntil: toPool
          ? (pool!.citiFolderHoldUntil ?? null)
          : existing.citiFolderHoldUntil,
        updatedAt: new Date(),
      })
      .where(and(eq(retentionCases.id, existing.id), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning();
    const row = firstOrThrow(rows, 'Failed to log retention attempt');
    const channelLabel = input.channel;
    const landedInPool = toPool && row.statusCode === 'p1_open_pool';
    const landedInCiti = toPool && row.phaseCode === 'phase_3_citi';
    await appendRetentionEvent({
      caseId: row.id,
      fromStatus: existing.statusCode,
      toStatus: row.statusCode,
      eventType: 'comms_attempt',
      actorZohoUserId: input.actorZohoUserId,
      channel: input.channel,
      evidenceUrl,
      notes:
        noteTrim ||
        (landedInCiti
          ? `${channelLabel} attempt ${attempts}/${MAX_OUT_OF_REACH_ATTEMPTS} — max agents · CITI`
          : landedInPool
            ? `${channelLabel} attempt ${attempts}/${MAX_OUT_OF_REACH_ATTEMPTS} — sent to Open Pool`
            : `${channelLabel} attempt ${attempts}/${MAX_OUT_OF_REACH_ATTEMPTS}`),
    });
    const dto = toRetentionCaseDto(row);
    if (landedInCiti || landedInPool) {
      scheduleRetentionPostCommit('retention.log_attempt', async () => {
        if (landedInCiti) {
          await afterRetentionPhaseSideEffects(existing.phaseCode, dto, {
            tenantId: ctx.tenantId,
            actorZohoUserId: input.actorZohoUserId ?? null,
          });
        }
        if (landedInPool) {
          await notifyOpenPoolOpened(ctx, {
            caseId: String(row.id),
            carrierId: row.carrierId,
            companyName: row.companyName,
            reason: 'out_of_reach',
            previousOwnerZohoUserId: previousOwner,
            zohoDealId: row.zohoDealId,
          });
        }
      });
    }
    return dto;
  },
};
