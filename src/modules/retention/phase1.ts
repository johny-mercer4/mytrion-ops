/**
 * Phase 1 (Sales Agent) retention workflow — pure transition helpers.
 * Timer expiry is handled by `deadlineSweep.ts` (cron); this module validates
 * manual agent outcomes and stamps the matching deadlines.
 */
import type {
  AgentOutcome,
  DissatisfactionReason,
  RetentionCase,
} from '../../db/schema/index.js';
import { RETENTION_PHASE } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import {
  addBusinessDays,
  COMMS_ATTEMPT_DEADLINE_TYPE,
  enterOpenPool,
  handoffToRetention,
  MAX_OPEN_POOL_AGENTS,
  moveToCiti,
  PHASE1_DEADLINE_TYPE,
  reachedWatching,
  resetPhase1AfterOps,
  stampCommsAttemptDeadline,
  stampPhase1ActionDeadline,
  stampVacationCountdown,
  VACATION_COUNTDOWN_DAYS,
  type CaseTransitionPatch,
} from './deadlines.js';

export {
  addBusinessDays,
  COMMS_ATTEMPT_DEADLINE_TYPE,
  MAX_OPEN_POOL_AGENTS,
  PHASE1_DEADLINE_TYPE,
  VACATION_COUNTDOWN_DAYS,
};

export const initialPhase1Deadline = stampPhase1ActionDeadline;
export const nextCommsAttemptDeadline = stampCommsAttemptDeadline;

export const MAX_OUT_OF_REACH_ATTEMPTS = 5;

export type Phase1Outcome =
  | 'reached'
  | 'returned'
  | 'out_of_reach'
  | 'dissatisfied'
  | 'vacation'
  | 'no_action_2bd'
  | 'escalate_retention'
  | 'send_to_open_pool'
  | 'start_working'
  | 'ops_confirm_vacation'
  | 'ops_deny_vacation';

export interface Phase1TransitionInput {
  outcome: Phase1Outcome;
  dissatisfactionReason?: DissatisfactionReason | undefined;
  reasonNote?: string | null | undefined;
  now?: Date | undefined;
}

export interface Phase1TransitionResult extends CaseTransitionPatch {
  dissatisfactionReason?: DissatisfactionReason | null;
  reasonNote?: string | null;
}

const WORKABLE = new Set([
  'p1_new',
  'p1_in_progress',
  'p1_out_of_reach',
  'p1_vacation',
  'p1_vacation_followup',
  'p1_awaiting_ops',
  'p1_reached',
  'p1_dissatisfied',
  'p1_no_action_2bd',
  'p1_pool_assigned',
]);

export function assertPhase1Workable(row: RetentionCase): void {
  if (row.phaseCode !== RETENTION_PHASE.agent) {
    throw new AppError('Case is not in Phase 1 (Sales Agent)', {
      statusCode: 409,
      code: 'RETENTION_WRONG_PHASE',
      expose: true,
    });
  }
  if (row.closedAt != null) {
    throw new AppError('Case is already closed', {
      statusCode: 409,
      code: 'RETENTION_CLOSED',
      expose: true,
    });
  }
  if (!WORKABLE.has(row.statusCode) && row.statusCode !== 'p1_open_pool') {
    throw new AppError(`Cannot act on status '${row.statusCode}' in Phase 1`, {
      statusCode: 409,
      code: 'RETENTION_BAD_STATUS',
      expose: true,
    });
  }
}

export function resolvePhase1Transition(
  row: RetentionCase,
  input: Phase1TransitionInput,
): Phase1TransitionResult {
  assertPhase1Workable(row);
  const now = input.now ?? new Date();

  switch (input.outcome) {
    case 'start_working':
      // Kept for API compatibility — new cases auto-enter Working on create.
      return {
        phaseCode: RETENTION_PHASE.agent,
        statusCode: 'p1_in_progress',
        agentOutcome: null,
        eventType: 'status_change',
        eventNotes: 'Agent started working the case (legacy)',
      };

    case 'returned':
      throw new AppError(
        'Returned (fuel again) is automatic — use Reached when you make contact, or wait for hourly sync.',
        { statusCode: 409, code: 'RETENTION_RETURNED_AUTO', expose: true },
      );

    case 'reached':
      return {
        ...reachedWatching({ now }),
        reasonNote: input.reasonNote?.trim() || null,
      };

    case 'out_of_reach': {
      const comms = stampCommsAttemptDeadline(now);
      return {
        phaseCode: RETENTION_PHASE.agent,
        statusCode: 'p1_out_of_reach',
        agentOutcome: 'out_of_reach',
        currentDeadlineAt: comms.currentDeadlineAt,
        currentDeadlineType: comms.currentDeadlineType,
        eventType: 'outcome_recorded',
        eventNotes: 'Out of Reach — log channel attempts (5 max, 1 BD each)',
      };
    }

    case 'send_to_open_pool': {
      if (row.outOfReachAttempts < MAX_OUT_OF_REACH_ATTEMPTS) {
        throw new AppError(
          `Need ${MAX_OUT_OF_REACH_ATTEMPTS} out-of-reach attempts before Open Pool (have ${row.outOfReachAttempts})`,
          { statusCode: 409, code: 'RETENTION_ATTEMPTS_SHORT', expose: true },
        );
      }
      return enterOpenPool({
        now,
        agentOutcome: 'out_of_reach',
        previousOwnerZohoUserId: row.assignedAgentZohoUserId,
        assignmentCount: row.assignmentCount,
        notes: 'Sent to Sales Open Pool after 5 failed attempts',
      });
    }

    case 'dissatisfied': {
      if (!input.dissatisfactionReason) {
        throw new AppError('Dissatisfaction reason is required', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          expose: true,
        });
      }
      if (
        input.dissatisfactionReason === 'switched_other' &&
        !input.reasonNote?.trim()
      ) {
        throw new AppError('A brief note is required for Switched/Other', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          expose: true,
        });
      }
      return {
        ...handoffToRetention({
          now,
          agentOutcome: 'dissatisfied',
          notes: `Dissatisfied (${input.dissatisfactionReason}) → Retention (10 BD)`,
        }),
        dissatisfactionReason: input.dissatisfactionReason,
        reasonNote: input.reasonNote?.trim() || null,
      };
    }

    case 'vacation': {
      const vac = stampVacationCountdown(now);
      return {
        phaseCode: RETENTION_PHASE.agent,
        statusCode: 'p1_vacation',
        agentOutcome: 'vacation',
        reasonNote: input.reasonNote?.trim() || null,
        vacationCountdownEnd: vac.vacationCountdownEnd,
        currentDeadlineAt: vac.currentDeadlineAt,
        currentDeadlineType: vac.currentDeadlineType,
        eventType: 'outcome_recorded',
        eventNotes: 'Vacation — 14-day countdown started',
      };
    }

    case 'no_action_2bd':
    case 'escalate_retention':
      return handoffToRetention({
        now,
        agentOutcome: input.outcome === 'no_action_2bd' ? 'no_action_2bd' : null,
        notes:
          input.outcome === 'no_action_2bd'
            ? 'No action in 2BD — escalated to Retention (10 BD)'
            : 'Agent escalated to Retention (10 BD)',
      });

    case 'ops_confirm_vacation': {
      if (row.statusCode !== 'p1_awaiting_ops') {
        throw new AppError('Ops confirmation is only valid while awaiting Ops signoff', {
          statusCode: 409,
          code: 'RETENTION_BAD_STATUS',
          expose: true,
        });
      }
      return resetPhase1AfterOps({ now });
    }

    case 'ops_deny_vacation': {
      if (row.statusCode !== 'p1_awaiting_ops') {
        throw new AppError('Ops denial is only valid while awaiting Ops signoff', {
          statusCode: 409,
          code: 'RETENTION_BAD_STATUS',
          expose: true,
        });
      }
      return {
        ...moveToCiti({ now, notes: 'Ops: not on vacation / out of reach — CITI folder' }),
        agentOutcome: 'vacation' as AgentOutcome,
        eventType: 'signoff',
      };
    }

    default: {
      const _never: never = input.outcome;
      throw new AppError(`Unknown Phase 1 outcome: ${String(_never)}`, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
  }
}
