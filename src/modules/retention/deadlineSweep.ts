/**
 * Retention deadline sweeper — applies board timer paths when current_deadline_at is past.
 *
 * Handled deadline types:
 *   2BD_agent_action     → Retention (10 BD); CITI if assignment_count ≥ 3
 *   5BD_post_contact     → Open Pool (Reached watch with no fuel)
 *   3BD_pool_claim       → Retention (10 BD) if unclaimed; CITI if assignment_count ≥ 3
 *   3BD_new_owner        → Open Pool again, or CITI if assignment_count ≥ 3 (legacy)
 *   10BD_retention       → Open Pool (CITI if assignment_count ≥ 3)
 *   14D_vacation         → vacation follow-up task (2 BD)
 *   2BD_vacation_followup→ awaiting Ops signoff
 *   1BD_claim_approve    → auto-approve Open Pool claim (same as CS Approve)
 *
 * 1BD_comms_attempt (legacy 5BD_*) is an agent SLA indicator only (no auto-transition).
 *
 * Open Pool is Phase 1 status `p1_open_pool` (not its own phase). Every entry stamps
 * `3BD_pool_claim` via enterOpenPool (Sales OoR/Reached, Phase 2 no_response / 10BD, reject).
 */
import type { RetentionCase } from '../../db/schema/index.js';
import { RETENTION_PHASE } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { retentionCaseRepo } from '../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  afterRetentionPhaseSideEffects,
  enrichHandoffWithRoundRobin,
} from './csRoundRobin.js';
import {
  awaitingOpsSignoff,
  CLAIM_APPROVE_DEADLINE_TYPE,
  describeDeadline,
  enterOpenPool,
  handoffToRetention,
  isAgentActionDeadline,
  MAX_OPEN_POOL_AGENTS,
  moveToCiti,
  NEW_OWNER_DEADLINE_TYPE,
  POOL_CLAIM_DEADLINE_TYPE,
  POST_CONTACT_DEADLINE_TYPE,
  patchToUpdateInput,
  RETENTION_WAIT_DEADLINE_TYPE,
  VACATION_COUNTDOWN_TYPE,
  VACATION_FOLLOWUP_DEADLINE_TYPE,
  vacationFollowupTask,
  type CaseTransitionPatch,
} from './deadlines.js';
import { notifyOpenPoolOpened, notifyOpsVacationSignoff } from './notify.js';
// Dynamic-import retentionPoolClaimRepo below — a static import cycles
// deadlineSweep → poolClaimRepo → notify (partial) and crashes boot with
// "does not provide an export named 'notifyClaimRequestToCs'".

export interface DeadlineSweepSummary {
  scanned: number;
  applied: number;
  skipped: number;
  byType: Record<string, number>;
}

/** Exported for unit tests — maps an overdue case to the next workflow patch. */
export function resolveExpiry(row: RetentionCase, now: Date): CaseTransitionPatch | null {
  const type = row.currentDeadlineType;
  if (!type) return null;

  if (isAgentActionDeadline(type)) {
    if (
      row.statusCode !== 'p1_new' &&
      row.statusCode !== 'p1_in_progress' &&
      row.statusCode !== 'p1_pool_assigned'
    ) {
      return null;
    }
    // 3rd Open Pool agent already counted — fail closed to CITI, not Retention.
    if (row.assignmentCount >= MAX_OPEN_POOL_AGENTS) {
      return moveToCiti({
        now,
        notes: 'Timer: 3rd agent window ended with no action — CITI',
      });
    }
    return handoffToRetention({
      now,
      agentOutcome: 'no_action_2bd',
      notes: 'Timer: no action in 2 BD — auto-transfer to Retention (10 BD)',
    });
  }

  if (type === POST_CONTACT_DEADLINE_TYPE && row.statusCode === 'p1_reached') {
    // Spoke / watching — no fuel in 5 BD → Sales Open Pool (Ryan + owner notified).
    return enterOpenPool({
      now,
      agentOutcome: 'reached',
      previousOwnerZohoUserId: row.assignedAgentZohoUserId,
      assignmentCount: row.assignmentCount,
      notes: 'Timer: no new transaction in 5 BD after Reached — Open Pool',
    });
  }

  // Claim approve is handled in the sweeper loop (finalizeClaim), not as a patch.
  if (type === CLAIM_APPROVE_DEADLINE_TYPE) {
    return null;
  }

  if (type === POOL_CLAIM_DEADLINE_TYPE && row.statusCode === 'p1_open_pool') {
    if (row.assignmentCount >= MAX_OPEN_POOL_AGENTS) {
      return moveToCiti({
        now,
        notes: 'Timer: Open Pool unclaimed and max agents reached — CITI',
      });
    }
    return handoffToRetention({
      now,
      notes: 'Timer: Open Pool not claimed in 3 BD — Retention (10 BD)',
    });
  }

  if (type === NEW_OWNER_DEADLINE_TYPE && row.statusCode === 'p1_pool_assigned') {
    if (row.assignmentCount >= MAX_OPEN_POOL_AGENTS) {
      return moveToCiti({
        now,
        notes: 'Timer: 3rd agent window ended with no return — CITI',
      });
    }
    return enterOpenPool({
      now,
      previousOwnerZohoUserId: row.assignedAgentZohoUserId,
      assignmentCount: row.assignmentCount,
      notes: 'Timer: new owner had no transaction in 3 BD — back to Open Pool',
    });
  }

  if (type === RETENTION_WAIT_DEADLINE_TYPE && row.phaseCode === 'phase_2_retention') {
    return enterOpenPool({
      now,
      previousOwnerZohoUserId: row.assignedAgentZohoUserId,
      assignmentCount: row.assignmentCount,
      notes: 'Timer: no new transaction in 10 BD Retention — Open Pool (or CITI at max agents)',
    });
  }

  if (type === VACATION_COUNTDOWN_TYPE && row.statusCode === 'p1_vacation') {
    return vacationFollowupTask({ now });
  }

  if (type === VACATION_FOLLOWUP_DEADLINE_TYPE && row.statusCode === 'p1_vacation_followup') {
    return awaitingOpsSignoff({ now });
  }

  return null;
}

export async function sweepRetentionDeadlines(
  ctx: TenantContext,
  opts: { now?: Date; limit?: number } = {},
): Promise<DeadlineSweepSummary> {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const overdue = await retentionCaseRepo.listOpenPastDeadline(ctx, now, limit);
  const summary: DeadlineSweepSummary = {
    scanned: overdue.length,
    applied: 0,
    skipped: 0,
    byType: {},
  };

  for (const row of overdue) {
    const type = row.currentDeadlineType ?? 'unknown';

    if (
      type === CLAIM_APPROVE_DEADLINE_TYPE &&
      row.statusCode === 'p1_pool_claim_pending'
    ) {
      const { retentionPoolClaimRepo } = await import(
        '../../repos/retentionPoolClaimRepo.js'
      );
      const approved = await retentionPoolClaimRepo.autoApproveOverdue(ctx, row);
      if (approved) {
        summary.applied += 1;
        summary.byType[type] = (summary.byType[type] ?? 0) + 1;
      } else {
        summary.skipped += 1;
      }
      continue;
    }

    let patch = resolveExpiry(row, now);
    if (!patch) {
      summary.skipped += 1;
      continue;
    }
    if (patch.phaseCode === RETENTION_PHASE.retention) {
      patch = await enrichHandoffWithRoundRobin(ctx, patch, {
        isSpanishDesk: row.isSpanishDesk,
      });
    }
    const previousOwner = row.assignedAgentZohoUserId ?? row.poolOwnerZohoUserId;
    const beforePhase = row.phaseCode;
    const updated = await retentionCaseRepo.update(
      ctx,
      String(row.id),
      patchToUpdateInput(patch, 'system:deadline-sweep'),
    );
    if (!updated) {
      summary.skipped += 1;
      continue;
    }
    summary.applied += 1;
    summary.byType[type] = (summary.byType[type] ?? 0) + 1;

    await afterRetentionPhaseSideEffects(beforePhase, updated);

    if (updated.statusCode === 'p1_open_pool') {
      const poolReason =
        type === POST_CONTACT_DEADLINE_TYPE
          ? ('reached' as const)
          : type === NEW_OWNER_DEADLINE_TYPE
            ? ('reclaim' as const)
            : type === RETENTION_WAIT_DEADLINE_TYPE
              ? ('phase2' as const)
              : ('out_of_reach' as const);
      await notifyOpenPoolOpened(ctx, {
        caseId: String(row.id),
        carrierId: row.carrierId,
        companyName: row.companyName,
        reason: poolReason,
        previousOwnerZohoUserId: previousOwner,
        zohoDealId: row.zohoDealId,
      });
    }
    if (patch.statusCode === 'p1_awaiting_ops') {
      await notifyOpsVacationSignoff(ctx, {
        caseId: String(row.id),
        carrierId: row.carrierId,
        companyName: row.companyName,
      });
    }

    logger.info(
      {
        caseId: row.id,
        from: row.statusCode,
        to: updated.statusCode,
        deadline: describeDeadline(row),
      },
      'retention deadline applied',
    );
  }

  logger.info(summary, 'retention deadline sweep completed');
  return summary;
}
