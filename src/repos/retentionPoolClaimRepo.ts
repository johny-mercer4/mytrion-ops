/**
 * Sales Open Pool claim — request → CS approve/decline (or 1 BD auto-approve).
 * On approve: Zoho Deal/Contact/Account Owner → claimant, then local finalize.
 */
import { and, desc, eq, isNull } from 'drizzle-orm';
import { db } from '../db/client.js';
import { RETENTION_PHASE, retentionCases, type RetentionCase } from '../db/schema/index.js';
import { AppError, NotFoundError, RBACError } from '../lib/errors.js';
import {
  MIN_INACTIVE_DAYS_FOR_POOL_CLAIM,
  moveToCiti,
  patchToUpdateInput,
  stampClaimApproveDeadline,
  stampNewOwnerDeadline,
  stampPoolClaimDeadline,
} from '../modules/retention/deadlines.js';
import {
  notifyClaimApproved,
  notifyClaimDeclined,
  notifyClaimRequestToCs,
} from '../modules/retention/notify.js';
import { MAX_OPEN_POOL_AGENTS } from '../modules/retention/phase1.js';
import { transferDealOwnershipToClaimant } from '../modules/retention/zohoOwnership.js';
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

/** CS workers (or admins) may approve/decline Open Pool claims. */
function assertCsClaimApprover(ctx: TenantContext, opts: { asAdmin?: boolean } = {}): void {
  if (opts.asAdmin || isAdminCtx(ctx)) return;
  if (ctx.departments.includes('customer-service')) return;
  throw new RBACError('Only Customer Service can approve or decline Open Pool claims');
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

/** Finalize assignment after CS approve / auto-approve. */
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
    throw new AppError(
      `Maximum ${MAX_OPEN_POOL_AGENTS} agents have already worked this deal — moved to CITI`,
      { statusCode: 409, code: 'RETENTION_POOL_CAP', expose: true },
    );
  }
  const deadline = stampNewOwnerDeadline();
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
      statusCode: 'p1_pool_assigned',
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
      `Claim approved — assignment ${nextCount}/${MAX_OPEN_POOL_AGENTS} · 3 BD for transaction`,
  });
  return toRetentionCaseDto(row);
}

async function transferZohoThenFinalize(
  ctx: TenantContext,
  existing: RetentionCase,
  claimant: string,
  opts: { agentName?: string | undefined; actorZohoUserId?: string | undefined; notes?: string },
): Promise<RetentionCaseDto> {
  if (existing.zohoDealId?.trim()) {
    const ownership = await transferDealOwnershipToClaimant(existing.zohoDealId, claimant);
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
  }
  return finalizeClaim(ctx, existing, claimant, opts);
}

export const retentionPoolClaimRepo = {
  /**
   * Request claim from Open Pool — parks as p1_pool_claim_pending for CS (1 BD auto).
   */
  async requestClaim(
    ctx: TenantContext,
    id: string,
    claimantZohoUserId: string,
    opts: { agentName?: string | undefined } = {},
  ): Promise<RetentionCaseDto & { pendingApproval: boolean }> {
    const existing = await loadCase(ctx, id);
    if (existing.closedAt != null) {
      throw new AppError('Case is already closed', {
        statusCode: 409,
        code: 'RETENTION_CLOSED',
        expose: true,
      });
    }
    if (existing.statusCode !== 'p1_open_pool') {
      throw new AppError('Case is not available in the Open Pool', {
        statusCode: 409,
        code: 'RETENTION_NOT_IN_POOL',
        expose: true,
      });
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

    const approve = stampClaimApproveDeadline();
    const rows = await db
      .update(retentionCases)
      .set({
        statusCode: 'p1_pool_claim_pending',
        pendingClaimantZohoUserId: claimant,
        agentName: opts.agentName?.trim() || existing.agentName,
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
      notes: `Claim requested — awaiting Customer Service (1 BD auto) · assignment would be ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS}`,
    });
    await notifyClaimRequestToCs(ctx, {
      caseId: String(row.id),
      carrierId: row.carrierId,
      companyName: row.companyName,
      claimantZohoUserId: claimant,
      previousOwnerZohoUserId: owner,
    });
    return { ...toRetentionCaseDto(row), pendingApproval: true };
  },

  async approveClaim(
    ctx: TenantContext,
    id: string,
    actorZohoUserId: string,
    opts: { asAdmin?: boolean; agentName?: string | undefined } = {},
  ): Promise<RetentionCaseDto> {
    assertCsClaimApprover(ctx, opts);
    const existing = await loadCase(ctx, id);
    if (existing.statusCode !== 'p1_pool_claim_pending' || !existing.pendingClaimantZohoUserId) {
      throw new AppError('No pending claim to approve', {
        statusCode: 409,
        code: 'RETENTION_NO_PENDING_CLAIM',
        expose: true,
      });
    }
    const actor = trim(actorZohoUserId);
    const claimant = existing.pendingClaimantZohoUserId;
    const dto = await transferZohoThenFinalize(ctx, existing, claimant, {
      agentName: opts.agentName,
      actorZohoUserId: actor,
      notes: `CS approved claim — assignment ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS}`,
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
    assertCsClaimApprover(ctx, opts);
    const existing = await loadCase(ctx, id);
    if (existing.statusCode !== 'p1_pool_claim_pending' || !existing.pendingClaimantZohoUserId) {
      throw new AppError('No pending claim to decline', {
        statusCode: 409,
        code: 'RETENTION_NO_PENDING_CLAIM',
        expose: true,
      });
    }
    const actor = trim(actorZohoUserId);
    const claimant = existing.pendingClaimantZohoUserId;
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
      notes: 'CS declined claim — back to Open Pool',
    });
    await notifyClaimDeclined(ctx, {
      caseId: String(row.id),
      carrierId: row.carrierId,
      companyName: row.companyName,
      claimantZohoUserId: claimant,
    });
    return toRetentionCaseDto(row);
  },

  /** Auto-approve overdue pending claims (deadline sweeper) — same path as CS approve. */
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
      notes: `Auto-approved after 1 BD — assignment ${existing.assignmentCount + 1}/${MAX_OPEN_POOL_AGENTS}`,
    });
    await notifyClaimApproved(ctx, {
      caseId: dto.id,
      carrierId: dto.carrierId,
      companyName: dto.companyName,
      claimantZohoUserId: claimant,
    });
    return dto;
  },

  /** All pending Open Pool claims (CS queue). */
  async listPendingClaims(
    ctx: TenantContext,
    opts: { limit?: number } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const where = and(
      eq(retentionCases.tenantId, ctx.tenantId),
      eq(retentionCases.statusCode, 'p1_pool_claim_pending'),
      isNull(retentionCases.closedAt),
    );
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.updatedAt))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
  },

  /** @deprecated Sales owner queue — prefer listPendingClaims for CS. */
  async listPendingForOwner(
    ctx: TenantContext,
    ownerZohoUserId: string,
    opts: { limit?: number } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
    const where = and(
      eq(retentionCases.tenantId, ctx.tenantId),
      eq(retentionCases.statusCode, 'p1_pool_claim_pending'),
      eq(retentionCases.poolOwnerZohoUserId, trim(ownerZohoUserId)),
      isNull(retentionCases.closedAt),
    );
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.updatedAt))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
  },
};
