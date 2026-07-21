/**
 * Retention deadline sweeper — applies board timer paths when current_deadline_at is past.
 *
 * Handled deadline types:
 *   2BD_agent_action     → Retention (10 BD wait)
 *   5BD_post_contact     → Open Pool (Reached watch with no fuel)
 *   3BD_pool_claim       → Retention (10 BD)  [unclaimed]
 *   3BD_new_owner        → Open Pool again, or CITI if assignment_count ≥ 3
 *   10BD_retention       → CITI
 *   14D_vacation         → vacation follow-up task (2 BD)
 *   2BD_vacation_followup→ awaiting Ops signoff
 *
 * 5BD_comms_attempt is an agent SLA indicator only (no auto-transition).
 */
import type { RetentionCase } from '../../db/schema/index.js';
import { logger } from '../../lib/logger.js';
import { retentionCaseRepo } from '../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  awaitingOpsSignoff,
  CLAIM_APPROVE_DEADLINE_TYPE,
  describeDeadline,
  enterOpenPool,
  handoffToRetention,
  isAgentActionDeadline,
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
import { MAX_OPEN_POOL_AGENTS } from './phase1.js';
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
      notes: 'Timer: new owner had no transaction in 3 BD — back to Open Pool',
    });
  }

  if (type === RETENTION_WAIT_DEADLINE_TYPE && row.phaseCode === 'phase_2_retention') {
    return moveToCiti({
      now,
      notes: 'Timer: no new transaction in 10 BD Retention wait — CITI',
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

    const patch = resolveExpiry(row, now);
    if (!patch) {
      summary.skipped += 1;
      continue;
    }
    const previousOwner = row.assignedAgentZohoUserId ?? row.poolOwnerZohoUserId;
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

    if (patch.statusCode === 'p1_open_pool') {
      await notifyOpenPoolOpened(ctx, {
        caseId: String(row.id),
        carrierId: row.carrierId,
        companyName: row.companyName,
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
        to: patch.statusCode,
        deadline: describeDeadline(row),
      },
      'retention deadline applied',
    );
  }

  logger.info(summary, 'retention deadline sweep completed');
  return summary;
}
