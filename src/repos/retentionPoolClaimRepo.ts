/**
 * Sales Open Pool — instant claim (Case + Zoho Deal/Contact/Company → claimant).
 * Audit rows in retention_claim_requests: approved (claimed) / expired (unclaimed exit).
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  CLAIM_REQUEST_STATUS,
  RETENTION_PHASE,
  retentionCases,
  retentionClaimRequests,
  type RetentionCase,
} from '../db/schema/index.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import {
  MIN_INACTIVE_DAYS_FOR_POOL_CLAIM,
  moveToCiti,
  patchToUpdateInput,
  stampPhase1ActionDeadline,
  stampPoolClaimDeadline,
} from '../modules/retention/deadlines.js';
import {
  assertUnderOpenPoolDailyCap,
  getOpenPoolDailyQuota,
} from '../modules/retention/openPoolCaps.js';
import { MAX_OPEN_POOL_AGENTS } from '../modules/retention/phase1.js';
import { OWNERSHIP_TRANSFER_REASON } from '../db/schema/retention_ownership_transfers.js';
import {
  setDealStageClosedLost,
  transferDealOwnershipToClaimant,
} from '../modules/retention/zohoOwnership.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';
import {
  appendRetentionEvent,
  retentionCaseRepo,
  toRetentionCaseDto,
  type RetentionCaseDto,
} from './retentionCaseRepo.js';

const trim = (v: string): string => v.trim();

async function loadCase(ctx: TenantContext, id: string): Promise<RetentionCase> {
  const numericId = Number(id);
  if (!Number.isFinite(numericId)) throw new NotFoundError('Retention case not found');
  const found = await db
    .select()
    .from(retentionCases)
    .where(and(eq(retentionCases.id, numericId), eq(retentionCases.tenantId, ctx.tenantId)))
    .limit(1);
  const row = found[0];
  if (!row) throw new NotFoundError('Retention case not found');
  return row;
}

/** Delete legacy open request(s) for a case. */
export async function deleteOpenClaimRequests(
  ctx: TenantContext,
  caseId: number,
): Promise<number> {
  const deleted = await db
    .delete(retentionClaimRequests)
    .where(
      and(
        eq(retentionClaimRequests.tenantId, ctx.tenantId),
        eq(retentionClaimRequests.retentionCaseId, caseId),
        eq(retentionClaimRequests.status, CLAIM_REQUEST_STATUS.requested),
      ),
    )
    .returning({ id: retentionClaimRequests.id });
  return deleted.length;
}

/** Finalize → Kanban New (2 BD Phase 1 restart). */
async function finalizeClaim(
  ctx: TenantContext,
  existing: RetentionCase,
  claimantZohoUserId: string,
  opts: { agentName?: string | undefined; actorZohoUserId?: string | undefined; notes?: string },
): Promise<RetentionCaseDto> {
  if (existing.assignmentCount >= MAX_OPEN_POOL_AGENTS) {
    await retentionCaseRepo.update(
      ctx,
      String(existing.id),
      patchToUpdateInput(
        moveToCiti({ notes: 'Max Open Pool agents reached — CITI' }),
        opts.actorZohoUserId,
      ),
    );
    await setDealStageClosedLost(existing.zohoDealId);
    throw new AppError(
      `Maximum ${MAX_OPEN_POOL_AGENTS} agents have already worked this deal — moved to CITI`,
      { statusCode: 409, code: 'RETENTION_POOL_CAP', expose: true },
    );
  }
  const deadline = stampPhase1ActionDeadline();
  const nextCount = existing.assignmentCount + 1;
  const rows = await db
    .update(retentionCases)
    .set({
      assignedAgentZohoUserId: trim(claimantZohoUserId),
      agentName: opts.agentName?.trim() || existing.agentName,
      assignmentCount: nextCount,
      openPoolAttemptCount: existing.openPoolAttemptCount + 1,
      dealOwnerChanged: true,
      phaseCode: RETENTION_PHASE.agent,
      statusCode: 'p1_new',
      phaseChangedAt: new Date(),
      outOfReachAttempts: 0,
      agentOutcome: null,
      poolOwnerZohoUserId: null,
      pendingClaimantZohoUserId: null,
      currentDeadlineAt: deadline.currentDeadlineAt,
      currentDeadlineType: deadline.currentDeadlineType,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(retentionCases.id, existing.id),
        eq(retentionCases.tenantId, ctx.tenantId),
        inArray(retentionCases.statusCode, ['p1_open_pool', 'p1_pool_claim_pending']),
      ),
    )
    .returning();
  if (rows.length === 0) {
    throw new AppError('Case is no longer available in the Open Pool', {
      statusCode: 409,
      code: 'RETENTION_NOT_IN_POOL',
      expose: true,
    });
  }
  const row = firstOrThrow(rows, 'Failed to finalize pool claim');
  await appendRetentionEvent({
    caseId: row.id,
    fromStatus: existing.statusCode,
    toStatus: row.statusCode,
    eventType: 'reassigned',
    actorZohoUserId: opts.actorZohoUserId ?? claimantZohoUserId,
    notes:
      opts.notes ??
      `Open Pool claimed — New · assignment ${nextCount}/${MAX_OPEN_POOL_AGENTS} · 2 BD to act`,
  });
  return toRetentionCaseDto(row);
}

export type PoolActivityKind = 'claimed' | 'unclaimed';

export interface PoolActivityRow {
  id: string;
  kind: PoolActivityKind;
  status: string;
  caseId: string;
  carrierId: string;
  zohoDealId: string | null;
  companyName: string | null;
  requesterZohoUserId: string;
  requesterName: string | null;
  reason: string;
  outcomeNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export const retentionPoolClaimRepo = {
  /**
   * Instant Open Pool claim — Zoho ownership + case → p1_new in one step.
   */
  async claimNow(
    ctx: TenantContext,
    id: string,
    claimantZohoUserId: string,
    opts: { agentName?: string | undefined; reason: string },
  ): Promise<
    RetentionCaseDto & {
      pendingApproval: boolean;
      quota: { used: number; max: number; remaining: number };
    }
  > {
    const reason = opts.reason.trim();
    if (!reason) {
      throw new AppError('Claim reason is required', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
    if (reason.length > 2000) {
      throw new AppError('Claim reason is too long (max 2000 characters)', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }

    const claimant = trim(claimantZohoUserId);
    await assertUnderOpenPoolDailyCap(ctx, claimant);

    const existing = await loadCase(ctx, id);
    if (existing.closedAt != null) {
      throw new AppError('Case is already closed', {
        statusCode: 409,
        code: 'RETENTION_CLOSED',
        expose: true,
      });
    }
    if (existing.statusCode !== 'p1_open_pool') {
      throw new AppError(
        existing.statusCode === 'p1_pool_claim_pending'
          ? 'Case is locked — try again shortly'
          : 'Case is not available in the Open Pool',
        {
          statusCode: 409,
          code: 'RETENTION_NOT_IN_POOL',
          expose: true,
        },
      );
    }
    const days = existing.daysInactive ?? 0;
    if (days < MIN_INACTIVE_DAYS_FOR_POOL_CLAIM) {
      throw new AppError(
        `Claim requires ${MIN_INACTIVE_DAYS_FOR_POOL_CLAIM}+ days inactive (have ${days})`,
        { statusCode: 409, code: 'RETENTION_CLAIM_TOO_EARLY', expose: true },
      );
    }
    if (existing.assignmentCount >= MAX_OPEN_POOL_AGENTS) {
      await retentionCaseRepo.update(
        ctx,
        String(existing.id),
        patchToUpdateInput(
          moveToCiti({ notes: 'Max Open Pool agents reached — CITI' }),
          claimant,
        ),
      );
      await setDealStageClosedLost(existing.zohoDealId);
      throw new AppError(
        `Maximum ${MAX_OPEN_POOL_AGENTS} agents have already worked this deal — moved to CITI`,
        { statusCode: 409, code: 'RETENTION_POOL_CAP', expose: true },
      );
    }
    const owner = existing.poolOwnerZohoUserId?.trim() || null;
    if (owner && owner === claimant) {
      throw new AppError('You already own this deal — no claim needed', {
        statusCode: 409,
        code: 'RETENTION_CLAIM_SELF',
        expose: true,
      });
    }

    const dealId = existing.zohoDealId?.trim();
    if (!dealId) {
      throw new AppError(
        'Case has no Zoho Deal id — cannot claim until retention sync backfills deal_id',
        {
          statusCode: 409,
          code: 'RETENTION_NO_DEAL',
          expose: true,
        },
      );
    }

    // Soft lock so concurrent claimants see Processing briefly while Zoho runs.
    const lockRows = await db
      .update(retentionCases)
      .set({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: claimant,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(retentionCases.id, existing.id),
          eq(retentionCases.tenantId, ctx.tenantId),
          eq(retentionCases.statusCode, 'p1_open_pool'),
        ),
      )
      .returning();
    if (lockRows.length === 0) {
      throw new AppError('Case is no longer available in the Open Pool', {
        statusCode: 409,
        code: 'RETENTION_NOT_IN_POOL',
        expose: true,
      });
    }

    try {
      const ownership = await transferDealOwnershipToClaimant(dealId, claimant, {
        tenantId: ctx.tenantId,
        reason: OWNERSHIP_TRANSFER_REASON.openPoolClaim,
        retentionCaseId: existing.id,
        carrierId: existing.carrierId,
        companyName: existing.companyName,
        actorZohoUserId: claimant,
        actorName: opts.agentName?.trim() || null,
        toOwnerName: opts.agentName?.trim() || null,
      });
      if (ownership.warnings.length > 0) {
        await appendRetentionEvent({
          caseId: existing.id,
          fromStatus: 'p1_open_pool',
          toStatus: 'p1_pool_claim_pending',
          eventType: 'note',
          actorZohoUserId: claimant,
          notes: `Zoho ownership partial: ${ownership.warnings.join('; ')}`,
        });
      }
    } catch (err) {
      const pool = stampPoolClaimDeadline();
      await db
        .update(retentionCases)
        .set({
          statusCode: 'p1_open_pool',
          pendingClaimantZohoUserId: null,
          currentDeadlineAt: pool.currentDeadlineAt,
          currentDeadlineType: pool.currentDeadlineType,
          updatedAt: new Date(),
        })
        .where(and(eq(retentionCases.id, existing.id), eq(retentionCases.tenantId, ctx.tenantId)));
      throw err;
    }

    const now = new Date();
    const requesterName = opts.agentName?.trim() || null;
    const previousOwnerZohoUserId = existing.poolOwnerZohoUserId?.trim() || null;
    // agentName on the case is the last assigned Sales name when it entered the pool.
    const previousOwnerName =
      previousOwnerZohoUserId != null ? existing.agentName?.trim() || null : null;
    const fromLabel = previousOwnerName || previousOwnerZohoUserId || 'unassigned';
    const toLabel = requesterName || claimant;
    await db.insert(retentionClaimRequests).values({
      tenantId: ctx.tenantId,
      retentionCaseId: existing.id,
      carrierId: existing.carrierId,
      zohoDealId: existing.zohoDealId,
      requesterZohoUserId: claimant,
      requesterName,
      previousOwnerZohoUserId,
      previousOwnerName,
      reason,
      status: CLAIM_REQUEST_STATUS.approved,
      requestedAt: now,
      resolvedAt: now,
      resolvedByZohoUserId: claimant,
    });

    await appendRetentionEvent({
      caseId: existing.id,
      fromStatus: 'p1_open_pool',
      toStatus: 'p1_pool_claim_pending',
      eventType: 'note',
      actorZohoUserId: claimant,
      notes: `Open Pool claim — ${toLabel} took carrier ${existing.carrierId} from ${fromLabel}`,
    });

    const locked = {
      ...existing,
      statusCode: 'p1_pool_claim_pending',
      pendingClaimantZohoUserId: claimant,
    };
    const dto = await finalizeClaim(ctx, locked, claimant, {
      agentName: opts.agentName,
      actorZohoUserId: claimant,
      notes: `Open Pool claimed — ${reason.slice(0, 200)} · New · assignment ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS} · 2 BD to act`,
    });
    const quota = await getOpenPoolDailyQuota(ctx, claimant, now);
    return { ...dto, pendingApproval: false, quota };
  },

  /** @deprecated Use claimNow — kept as alias for callers. */
  async requestClaim(
    ctx: TenantContext,
    id: string,
    claimantZohoUserId: string,
    opts: { agentName?: string | undefined; reason: string },
  ): Promise<
    RetentionCaseDto & {
      pendingApproval: boolean;
      quota: { used: number; max: number; remaining: number };
    }
  > {
    return this.claimNow(ctx, id, claimantZohoUserId, opts);
  },

  /**
   * Log unclaimed Open Pool exit (3BD → Retention / max agents → CITI).
   * `requesterZohoUserId` = last pool owner when known.
   */
  async logUnclaimedExit(
    ctx: TenantContext,
    existing: RetentionCase,
    opts: {
      outcomeNote: string;
      reason?: string;
    },
  ): Promise<void> {
    const owner =
      existing.poolOwnerZohoUserId?.trim() ||
      existing.assignedAgentZohoUserId?.trim() ||
      'system';
    const now = new Date();
    await db.insert(retentionClaimRequests).values({
      tenantId: ctx.tenantId,
      retentionCaseId: existing.id,
      carrierId: existing.carrierId,
      zohoDealId: existing.zohoDealId,
      requesterZohoUserId: owner,
      requesterName: existing.agentName,
      reason: opts.reason ?? 'Unclaimed — left Open Pool',
      status: CLAIM_REQUEST_STATUS.expired,
      outcomeNote: opts.outcomeNote,
      requestedAt: now,
      resolvedAt: now,
      resolvedByZohoUserId: 'system:pool-expiry',
    });
  },

  /** CS Open Pool Activity — claimed + unclaimed audit rows. */
  async listPoolActivity(
    ctx: TenantContext,
    opts: { limit?: number; status?: 'approved' | 'expired' | 'all' } = {},
  ): Promise<{ rows: PoolActivityRow[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
    const statuses =
      opts.status === 'approved'
        ? [CLAIM_REQUEST_STATUS.approved]
        : opts.status === 'expired'
          ? [CLAIM_REQUEST_STATUS.expired]
          : [CLAIM_REQUEST_STATUS.approved, CLAIM_REQUEST_STATUS.expired];

    const rows = await db
      .select({
        id: retentionClaimRequests.id,
        status: retentionClaimRequests.status,
        caseId: retentionClaimRequests.retentionCaseId,
        carrierId: retentionClaimRequests.carrierId,
        zohoDealId: retentionClaimRequests.zohoDealId,
        companyName: retentionCases.companyName,
        requesterZohoUserId: retentionClaimRequests.requesterZohoUserId,
        requesterName: retentionClaimRequests.requesterName,
        reason: retentionClaimRequests.reason,
        outcomeNote: retentionClaimRequests.outcomeNote,
        requestedAt: retentionClaimRequests.requestedAt,
        resolvedAt: retentionClaimRequests.resolvedAt,
      })
      .from(retentionClaimRequests)
      .leftJoin(
        retentionCases,
        and(
          eq(retentionCases.id, retentionClaimRequests.retentionCaseId),
          eq(retentionCases.tenantId, retentionClaimRequests.tenantId),
        ),
      )
      .where(
        and(
          eq(retentionClaimRequests.tenantId, ctx.tenantId),
          inArray(retentionClaimRequests.status, statuses),
        ),
      )
      .orderBy(desc(retentionClaimRequests.requestedAt))
      .limit(limit);

    const mapped: PoolActivityRow[] = rows.map((r) => ({
      id: String(r.id),
      kind: r.status === CLAIM_REQUEST_STATUS.expired ? 'unclaimed' : 'claimed',
      status: r.status,
      caseId: String(r.caseId),
      carrierId: r.carrierId,
      zohoDealId: r.zohoDealId,
      companyName: r.companyName,
      requesterZohoUserId: r.requesterZohoUserId,
      requesterName: r.requesterName,
      reason: r.reason,
      outcomeNote: r.outcomeNote,
      requestedAt: r.requestedAt.toISOString(),
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
    }));
    return { rows: mapped, total: mapped.length };
  },

  /** Unlock legacy pending rows back to Open Pool (migrate / ops). */
  async resetPendingToPool(
    ctx: TenantContext,
    existing: RetentionCase,
  ): Promise<RetentionCaseDto | null> {
    if (existing.statusCode !== 'p1_pool_claim_pending') return null;
    await deleteOpenClaimRequests(ctx, existing.id);
    const pool = stampPoolClaimDeadline();
    const rows = await db
      .update(retentionCases)
      .set({
        statusCode: 'p1_open_pool',
        pendingClaimantZohoUserId: null,
        currentDeadlineAt: pool.currentDeadlineAt,
        currentDeadlineType: pool.currentDeadlineType,
        updatedAt: new Date(),
      })
      .where(and(eq(retentionCases.id, existing.id), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    await appendRetentionEvent({
      caseId: row.id,
      fromStatus: existing.statusCode,
      toStatus: row.statusCode,
      eventType: 'status_change',
      actorZohoUserId: 'system:pool-reset',
      notes: 'Pending claim cleared — back to Open Pool (instant-claim migrate)',
    });
    return toRetentionCaseDto(row);
  },
};
