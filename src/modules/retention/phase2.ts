/**
 * Phase 2 (Retention desk / CS) — pure transition helpers for claim + outcomes.
 */
import { RETENTION_PHASE } from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import {
  moveToCiti,
  stampRetentionWaitDeadline,
  type CaseTransitionPatch,
} from './deadlines.js';

export type Phase2Outcome =
  | 'claim'
  | 'start_working'
  | 'mark_pending'
  | 'saved'
  | 'refused'
  | 'out_of_business'
  | 'no_response'
  | 'escalate_citi';

/** Minimal case shape for Phase 2 transitions (DTO or ORM row). */
export interface Phase2CaseRow {
  closedAt: Date | string | null;
  phaseCode: string;
  statusCode: string;
  assignedAgentZohoUserId: string | null;
  assignmentCount: number;
}

const PHASE2_OPEN = new Set([
  'p2_new',
  'p2_working',
  'p2_offer_pending',
  'p2_handoff_citi',
]);

export function assertPhase2Workable(row: Phase2CaseRow): void {
  if (row.closedAt != null) {
    throw new AppError('Case is already closed', {
      statusCode: 409,
      code: 'RETENTION_CLOSED',
      expose: true,
    });
  }
  if (row.phaseCode !== RETENTION_PHASE.retention) {
    throw new AppError('Case is not in Phase 2 Retention', {
      statusCode: 409,
      code: 'RETENTION_WRONG_PHASE',
      expose: true,
    });
  }
  if (!PHASE2_OPEN.has(row.statusCode)) {
    throw new AppError(`Cannot act on status ${row.statusCode}`, {
      statusCode: 409,
      code: 'RETENTION_BAD_STATUS',
      expose: true,
    });
  }
}

export function resolvePhase2Transition(
  row: Phase2CaseRow,
  outcome: Phase2Outcome,
  opts: {
    actorZohoUserId?: string;
    agentName?: string;
    notes?: string;
    now?: Date;
  } = {},
): CaseTransitionPatch {
  assertPhase2Workable(row);
  const now = opts.now ?? new Date();
  const actor = opts.actorZohoUserId?.trim();

  switch (outcome) {
    case 'claim':
    case 'start_working': {
      if (!actor) {
        throw new AppError('zohoUserId is required to claim a Retention case', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          expose: true,
        });
      }
      const wait = stampRetentionWaitDeadline(now);
      return {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_working',
        assignedAgentZohoUserId: actor,
        currentDeadlineAt: wait.currentDeadlineAt,
        currentDeadlineType: wait.currentDeadlineType,
        eventType: 'reassigned',
        eventNotes: opts.notes ?? `CS claimed Phase 2 case (${actor}) — 10 BD wait`,
      };
    }
    case 'mark_pending': {
      const wait = stampRetentionWaitDeadline(now);
      return {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_offer_pending',
        currentDeadlineAt: wait.currentDeadlineAt,
        currentDeadlineType: wait.currentDeadlineType,
        eventType: 'status_change',
        eventNotes: opts.notes ?? 'Offer pending — solution proposed / waiting on client',
      };
    }
    case 'saved':
      return {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_saved',
        currentDeadlineAt: null,
        currentDeadlineType: null,
        eventType: 'status_change',
        eventNotes: opts.notes ?? 'Saved — closed by Retention',
      };
    case 'refused':
      return {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_refused',
        currentDeadlineAt: null,
        currentDeadlineType: null,
        eventType: 'status_change',
        eventNotes: opts.notes ?? 'Refused offer — closed',
      };
    case 'out_of_business':
      return {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_out_of_business',
        currentDeadlineAt: null,
        currentDeadlineType: null,
        eventType: 'status_change',
        eventNotes: opts.notes ?? 'Out of business — closed',
      };
    case 'no_response': {
      throw new AppError(
        'CS cannot send cases to Open Pool. The 10 BD Retention timer returns cases automatically.',
        {
          statusCode: 409,
          code: 'RETENTION_CS_NO_POOL',
          expose: true,
        },
      );
    }
    case 'escalate_citi':
      return moveToCiti({
        now,
        notes: opts.notes ?? 'Escalated to CITI from Retention desk',
      });
    default: {
      const _exhaustive: never = outcome;
      throw new AppError(`Unknown Phase 2 outcome: ${String(_exhaustive)}`, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
  }
}

/** Re-enter Phase 2 clock when a case is already assigned and CS logs work. */
export function stampPhase2Working(
  opts: { notes?: string; now?: Date } = {},
): CaseTransitionPatch {
  const wait = stampRetentionWaitDeadline(opts.now);
  return {
    phaseCode: RETENTION_PHASE.retention,
    statusCode: 'p2_working',
    currentDeadlineAt: wait.currentDeadlineAt,
    currentDeadlineType: wait.currentDeadlineType,
    eventType: 'status_change',
    eventNotes: opts.notes ?? 'Phase 2 working',
  };
}
