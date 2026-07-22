/**
 * Sales Open Pool claim — request → prior Sales owner approve/decline (or 1 BD auto-approve).
 * Durable queue: retention_claim_requests. Processing lock: p1_pool_claim_pending.
 * On approve: Zoho Deal/Contact/Account Owner → claiming Sales agent, case → p1_new (2 BD).
 * Retention/CS never receive Zoho ownership — only the case moves to the CS desk.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  CLAIM_REQUEST_STATUS,
  RETENTION_PHASE,
  retentionCases,
  retentionClaimRequests,
  type RetentionCase,
  type RetentionClaimRequest,
} from '../db/schema/index.js';
import { AppError, NotFoundError, RBACError } from '../lib/errors.js';
import {
  MIN_INACTIVE_DAYS_FOR_POOL_CLAIM,
  moveToCiti,
  patchToUpdateInput,
  stampClaimApproveDeadline,
  stampPhase1ActionDeadline,
  stampPoolClaimDeadline,
} from '../modules/retention/deadlines.js';
import {
  notifyClaimApproved,
  notifyClaimDeclined,
  notifyClaimRequestToPriorOwner,
} from '../modules/retention/notify.js';
import { MAX_OPEN_POOL_AGENTS } from '../modules/retention/phase1.js';
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

function isAdminCtx(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess === true;
}

/** Prior Sales owner (or admin) may approve/decline Open Pool claims on their deals. */
function assertPriorOwnerApprover(
  ctx: TenantContext,
  existing: RetentionCase,
  actorZohoUserId: string,
  opts: { asAdmin?: boolean } = {},
): void {
  if (opts.asAdmin || isAdminCtx(ctx)) return;
  const owner = existing.poolOwnerZohoUserId?.trim();
  const actor = trim(actorZohoUserId);
  if (!owner || owner !== actor) {
    throw new RBACError(
      'Only the prior Sales owner can approve or decline this Open Pool claim',
    );
  }
}

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

async function loadOpenRequest(
  ctx: TenantContext,
  caseId: number,
): Promise<RetentionClaimRequest | null> {
  const found = await db
    .select()
    .from(retentionClaimRequests)
    .where(
      and(
        eq(retentionClaimRequests.tenantId, ctx.tenantId),
        eq(retentionClaimRequests.retentionCaseId, caseId),
        eq(retentionClaimRequests.status, CLAIM_REQUEST_STATUS.requested),
      ),
    )
    .limit(1);
  return found[0] ?? null;
}

/** Delete open request(s) for a case (reject / sync abandon). */
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

/** Finalize after prior-owner approve / auto-approve → Kanban New (2 BD Phase 1 restart). */
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
    .where(and(eq(retentionCases.id, existing.id), eq(retentionCases.tenantId, ctx.tenantId)))
    .returning();
  const row = firstOrThrow(rows, 'Failed to finalize pool claim');
  await appendRetentionEvent({
    caseId: row.id,
    fromStatus: existing.statusCode,
    toStatus: row.statusCode,
    eventType: 'reassigned',
    actorZohoUserId: opts.actorZohoUserId ?? claimantZohoUserId,
    notes:
      opts.notes ??
      `Claim approved — New · assignment ${nextCount}/${MAX_OPEN_POOL_AGENTS} · 2 BD to act`,
  });
  return toRetentionCaseDto(row);
}

async function transferZohoThenFinalize(
  ctx: TenantContext,
  existing: RetentionCase,
  claimant: string,
  opts: {
    agentName?: string | undefined;
    actorZohoUserId?: string | undefined;
    notes?: string;
    markRequestApproved?: boolean;
  },
): Promise<RetentionCaseDto> {
  const dealId = existing.zohoDealId?.trim();
  if (!dealId) {
    throw new AppError(
      'Case has no Zoho Deal id — cannot approve claim until retention sync backfills deal_id',
      {
        statusCode: 409,
        code: 'RETENTION_NO_DEAL',
        expose: true,
      },
    );
  }
  const ownership = await transferDealOwnershipToClaimant(dealId, claimant);
  if (ownership.warnings.length > 0) {
    await appendRetentionEvent({
      caseId: existing.id,
      fromStatus: existing.statusCode,
      toStatus: existing.statusCode,
      eventType: 'note',
      actorZohoUserId: opts.actorZohoUserId ?? claimant,
      notes: `Zoho ownership partial: ${ownership.warnings.join('; ')}`,
    });
  }

  if (opts.markRequestApproved !== false) {
    const now = new Date();
    await db
      .update(retentionClaimRequests)
      .set({
        status: CLAIM_REQUEST_STATUS.approved,
        resolvedAt: now,
        resolvedByZohoUserId: opts.actorZohoUserId ?? claimant,
      })
      .where(
        and(
          eq(retentionClaimRequests.tenantId, ctx.tenantId),
          eq(retentionClaimRequests.retentionCaseId, existing.id),
          eq(retentionClaimRequests.status, CLAIM_REQUEST_STATUS.requested),
        ),
      );
  }

  return finalizeClaim(ctx, existing, claimant, opts);
}

export interface PendingClaimRow extends RetentionCaseDto {
  claimRequestId: string;
  claimReason: string;
  claimRequesterName: string | null;
  claimRequestedAt: string;
}

export const retentionPoolClaimRepo = {
  /**
   * Request claim from Open Pool — inserts claim_request + Processing lock for prior owner (1 BD auto).
   */
  async requestClaim(
    ctx: TenantContext,
    id: string,
    claimantZohoUserId: string,
    opts: { agentName?: string | undefined; reason: string },
  ): Promise<RetentionCaseDto & { pendingApproval: boolean }> {
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
          ? 'Case is already Processing — another claim is pending'
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
          trim(claimantZohoUserId),
        ),
      );
      await setDealStageClosedLost(existing.zohoDealId);
      throw new AppError(
        `Maximum ${MAX_OPEN_POOL_AGENTS} agents have already worked this deal — moved to CITI`,
        { statusCode: 409, code: 'RETENTION_POOL_CAP', expose: true },
      );
    }
    const claimant = trim(claimantZohoUserId);
    const owner = existing.poolOwnerZohoUserId?.trim() || null;
    if (owner && owner === claimant) {
      throw new AppError('You already own this deal — no claim needed', {
        statusCode: 409,
        code: 'RETENTION_CLAIM_SELF',
        expose: true,
      });
    }

    const openReq = await loadOpenRequest(ctx, existing.id);
    if (openReq) {
      throw new AppError('A claim request is already pending for this case', {
        statusCode: 409,
        code: 'RETENTION_CLAIM_PENDING',
        expose: true,
      });
    }

    const requesterName = opts.agentName?.trim() || null;
    try {
      await db.insert(retentionClaimRequests).values({
        tenantId: ctx.tenantId,
        retentionCaseId: existing.id,
        carrierId: existing.carrierId,
        zohoDealId: existing.zohoDealId,
        requesterZohoUserId: claimant,
        requesterName,
        reason,
        status: CLAIM_REQUEST_STATUS.requested,
      });
    } catch {
      throw new AppError('A claim request is already pending for this case', {
        statusCode: 409,
        code: 'RETENTION_CLAIM_PENDING',
        expose: true,
      });
    }

    const approve = stampClaimApproveDeadline();
    const rows = await db
      .update(retentionCases)
      .set({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: claimant,
        agentName: requesterName || existing.agentName,
        currentDeadlineAt: approve.currentDeadlineAt,
        currentDeadlineType: approve.currentDeadlineType,
        updatedAt: new Date(),
      })
      .where(and(eq(retentionCases.id, existing.id), eq(retentionCases.tenantId, ctx.tenantId)))
      .returning();
    const row = firstOrThrow(rows, 'Failed to request pool claim');
    await appendRetentionEvent({
      caseId: row.id,
      fromStatus: existing.statusCode,
      toStatus: row.statusCode,
      eventType: 'status_change',
      actorZohoUserId: claimant,
      notes: `Claim requested — ${reason.slice(0, 400)} · awaiting prior Sales owner (1 BD auto) · assignment would be ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS}`,
    });
    await notifyClaimRequestToPriorOwner(ctx, {
      caseId: String(row.id),
      carrierId: row.carrierId,
      companyName: row.companyName,
      claimantZohoUserId: claimant,
      previousOwnerZohoUserId: owner,
      reason,
    });
    return { ...toRetentionCaseDto(row), pendingApproval: true };
  },

  async approveClaim(
    ctx: TenantContext,
    id: string,
    actorZohoUserId: string,
    opts: { asAdmin?: boolean; agentName?: string | undefined } = {},
  ): Promise<RetentionCaseDto> {
    const existing = await loadCase(ctx, id);
    if (existing.statusCode !== 'p1_pool_claim_pending' || !existing.pendingClaimantZohoUserId) {
      throw new AppError('No pending claim to approve', {
        statusCode: 409,
        code: 'RETENTION_NO_PENDING_CLAIM',
        expose: true,
      });
    }
    const actor = trim(actorZohoUserId);
    assertPriorOwnerApprover(ctx, existing, actor, opts);
    const claimant = existing.pendingClaimantZohoUserId;
    const dto = await transferZohoThenFinalize(ctx, existing, claimant, {
      agentName: opts.agentName,
      actorZohoUserId: actor,
      notes: `Prior owner approved claim — New · assignment ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS} · 2 BD to act`,
    });
    await notifyClaimApproved(ctx, {
      caseId: dto.id,
      carrierId: dto.carrierId,
      companyName: dto.companyName,
      claimantZohoUserId: claimant,
    });
    return dto;
  },

  async declineClaim(
    ctx: TenantContext,
    id: string,
    actorZohoUserId: string,
    opts: { asAdmin?: boolean } = {},
  ): Promise<RetentionCaseDto> {
    const existing = await loadCase(ctx, id);
    if (existing.statusCode !== 'p1_pool_claim_pending' || !existing.pendingClaimantZohoUserId) {
      throw new AppError('No pending claim to decline', {
        statusCode: 409,
        code: 'RETENTION_NO_PENDING_CLAIM',
        expose: true,
      });
    }
    const actor = trim(actorZohoUserId);
    assertPriorOwnerApprover(ctx, existing, actor, opts);
    const claimant = existing.pendingClaimantZohoUserId;
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
    const row = firstOrThrow(rows, 'Failed to decline pool claim');
    await appendRetentionEvent({
      caseId: row.id,
      fromStatus: existing.statusCode,
      toStatus: row.statusCode,
      eventType: 'status_change',
      actorZohoUserId: actor,
      notes: 'Prior owner declined claim — request deleted · back to Open Pool',
    });
    await notifyClaimDeclined(ctx, {
      caseId: String(row.id),
      carrierId: row.carrierId,
      companyName: row.companyName,
      claimantZohoUserId: claimant,
    });
    return toRetentionCaseDto(row);
  },

  /** Auto-approve overdue pending claims (deadline sweeper) — same path as owner approve. */
  async autoApproveOverdue(
    ctx: TenantContext,
    existing: RetentionCase,
  ): Promise<RetentionCaseDto | null> {
    if (
      existing.statusCode !== 'p1_pool_claim_pending' ||
      !existing.pendingClaimantZohoUserId
    ) {
      return null;
    }
    const claimant = existing.pendingClaimantZohoUserId;
    const dto = await transferZohoThenFinalize(ctx, existing, claimant, {
      actorZohoUserId: 'system:claim-auto-approve',
      notes: `Auto-approved after 1 BD — New · assignment ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS} · 2 BD to act`,
    });
    await notifyClaimApproved(ctx, {
      caseId: dto.id,
      carrierId: dto.carrierId,
      companyName: dto.companyName,
      claimantZohoUserId: claimant,
    });
    return dto;
  },

  /**
   * Pending claims on deals this Sales agent previously owned (owner approve queue).
   */
  async listPendingForOwner(
    ctx: TenantContext,
    ownerZohoUserId: string,
    opts: { limit?: number } = {},
  ): Promise<{ cases: PendingClaimRow[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const owner = trim(ownerZohoUserId);
    const rows = await db
      .select({
        case: retentionCases,
        claimId: retentionClaimRequests.id,
        claimReason: retentionClaimRequests.reason,
        claimRequesterName: retentionClaimRequests.requesterName,
        claimRequestedAt: retentionClaimRequests.requestedAt,
      })
      .from(retentionCases)
      .innerJoin(
        retentionClaimRequests,
        and(
          eq(retentionClaimRequests.retentionCaseId, retentionCases.id),
          eq(retentionClaimRequests.tenantId, retentionCases.tenantId),
          eq(retentionClaimRequests.status, CLAIM_REQUEST_STATUS.requested),
        ),
      )
      .where(
        and(
          eq(retentionCases.tenantId, ctx.tenantId),
          eq(retentionCases.statusCode, 'p1_pool_claim_pending'),
          eq(retentionCases.poolOwnerZohoUserId, owner),
          isNull(retentionCases.closedAt),
        ),
      )
      .orderBy(desc(retentionClaimRequests.requestedAt))
      .limit(limit);

    const cases: PendingClaimRow[] = rows.map((r) => ({
      ...toRetentionCaseDto(r.case),
      claimRequestId: String(r.claimId),
      claimReason: r.claimReason,
      claimRequesterName: r.claimRequesterName,
      claimRequestedAt: r.claimRequestedAt.toISOString(),
    }));
    return { cases, total: cases.length };
  },

  /** Count pending claims for a prior owner (Sales badge). */
  async countPendingForOwner(ctx: TenantContext, ownerZohoUserId: string): Promise<number> {
    const { total } = await this.listPendingForOwner(ctx, ownerZohoUserId, { limit: 200 });
    return total;
  },
};
