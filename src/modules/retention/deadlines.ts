/**
 * Retention deadline stamps + shared transition patches used by Phase 1 outcomes
 * and the scheduled deadline sweeper.
 */
import type { AgentOutcome, RetentionCase } from '../../db/schema/index.js';
import { RETENTION_PHASE } from '../../db/schema/index.js';

/** Add N business days (Mon–Fri). Weekends are skipped; holidays are not modeled. */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = Math.max(0, Math.floor(days));
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const dow = result.getUTCDay(); // 0=Sun … 6=Sat
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return result;
}

export const PHASE1_DEADLINE_TYPE = '2BD_agent_action' as const;
export const COMMS_ATTEMPT_DEADLINE_TYPE = '1BD_comms_attempt' as const;
export const POST_CONTACT_DEADLINE_TYPE = '5BD_post_contact' as const;
export const POOL_CLAIM_DEADLINE_TYPE = '3BD_pool_claim' as const;
/** Owner has 1 BD to approve an Open Pool claim request (else auto-approve). */
export const CLAIM_APPROVE_DEADLINE_TYPE = '1BD_claim_approve' as const;
export const NEW_OWNER_DEADLINE_TYPE = '3BD_new_owner' as const;
/** Doc: claim approval requires 10+ days of inactivity. */
export const MIN_INACTIVE_DAYS_FOR_POOL_CLAIM = 10;
export const RETENTION_WAIT_DEADLINE_TYPE = '10BD_retention' as const;
export const VACATION_COUNTDOWN_TYPE = '14D_vacation' as const;
export const VACATION_FOLLOWUP_DEADLINE_TYPE = '2BD_vacation_followup' as const;
export const CITI_HOLD_DEADLINE_TYPE = '7D_citi_hold' as const;

export const VACATION_COUNTDOWN_DAYS = 14;
export const CITI_HOLD_DAYS = 7;

export interface DeadlineStamp {
  currentDeadlineAt: Date;
  currentDeadlineType: string;
}

export interface CaseTransitionPatch {
  phaseCode: string;
  statusCode: string;
  agentOutcome?: AgentOutcome | null;
  assignedAgentZohoUserId?: string | null;
  poolOwnerZohoUserId?: string | null;
  pendingClaimantZohoUserId?: string | null;
  assignmentCount?: number;
  openPoolAttemptCount?: number;
  outOfReachAttempts?: number;
  dealOwnerChanged?: boolean;
  currentDeadlineAt?: Date | null;
  currentDeadlineType?: string | null;
  vacationCountdownEnd?: Date | null;
  citiFolderEnteredAt?: Date | null;
  citiFolderHoldUntil?: Date | null;
  eventType: string;
  eventNotes?: string;
}

export function stampBusinessDays(
  days: number,
  type: string,
  now: Date = new Date(),
): DeadlineStamp {
  return { currentDeadlineAt: addBusinessDays(now, days), currentDeadlineType: type };
}

export function stampCalendarDays(
  days: number,
  type: string,
  now: Date = new Date(),
): DeadlineStamp {
  const at = new Date(now.getTime());
  at.setUTCDate(at.getUTCDate() + days);
  return { currentDeadlineAt: at, currentDeadlineType: type };
}

export function stampPhase1ActionDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(2, PHASE1_DEADLINE_TYPE, now);
}

export function stampCommsAttemptDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(1, COMMS_ATTEMPT_DEADLINE_TYPE, now);
}

export function stampPostContactDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(5, POST_CONTACT_DEADLINE_TYPE, now);
}

export function stampPoolClaimDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(3, POOL_CLAIM_DEADLINE_TYPE, now);
}

export function stampNewOwnerDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(3, NEW_OWNER_DEADLINE_TYPE, now);
}

export function stampRetentionWaitDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(10, RETENTION_WAIT_DEADLINE_TYPE, now);
}

export function stampVacationCountdown(now: Date = new Date()): {
  vacationCountdownEnd: Date;
} & DeadlineStamp {
  const stamp = stampCalendarDays(VACATION_COUNTDOWN_DAYS, VACATION_COUNTDOWN_TYPE, now);
  return { ...stamp, vacationCountdownEnd: stamp.currentDeadlineAt };
}

export function stampVacationFollowupDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(2, VACATION_FOLLOWUP_DEADLINE_TYPE, now);
}

/** Phase 2 Retention desk — wait 10 BD for a new transaction. */
export function handoffToRetention(
  opts: {
    agentOutcome?: AgentOutcome | null;
    notes?: string;
    now?: Date;
  } = {},
): CaseTransitionPatch {
  const now = opts.now ?? new Date();
  const wait = stampRetentionWaitDeadline(now);
  return {
    phaseCode: RETENTION_PHASE.retention,
    statusCode: 'p2_new',
    agentOutcome: opts.agentOutcome ?? null,
    assignedAgentZohoUserId: null,
    currentDeadlineAt: wait.currentDeadlineAt,
    currentDeadlineType: wait.currentDeadlineType,
    vacationCountdownEnd: null,
    eventType: 'status_change',
    eventNotes: opts.notes ?? 'Handed to Retention — 10 BD wait for new transaction',
  };
}

export function stampClaimApproveDeadline(now: Date = new Date()): DeadlineStamp {
  return stampBusinessDays(1, CLAIM_APPROVE_DEADLINE_TYPE, now);
}

/** Sales Open Pool — 3 BD to claim; clears assignee; keeps previous owner for approve. */
export function enterOpenPool(
  opts: {
    notes?: string;
    agentOutcome?: AgentOutcome | null;
    now?: Date;
    previousOwnerZohoUserId?: string | null;
  } = {},
): CaseTransitionPatch {
  const now = opts.now ?? new Date();
  const claim = stampPoolClaimDeadline(now);
  const prev = opts.previousOwnerZohoUserId?.trim() || null;
  return {
    phaseCode: RETENTION_PHASE.agent,
    statusCode: 'p1_open_pool',
    agentOutcome: opts.agentOutcome ?? 'out_of_reach',
    assignedAgentZohoUserId: null,
    poolOwnerZohoUserId: prev,
    pendingClaimantZohoUserId: null,
    outOfReachAttempts: 0,
    currentDeadlineAt: claim.currentDeadlineAt,
    currentDeadlineType: claim.currentDeadlineType,
    eventType: 'status_change',
    eventNotes: opts.notes ?? 'Sent to Sales Open Pool (3 BD to claim)',
  };
}

/** CITI folder — final hold; never auto-closed by DWH sync. */
export function moveToCiti(
  opts: { notes?: string; now?: Date } = {},
): CaseTransitionPatch {
  const now = opts.now ?? new Date();
  const hold = stampCalendarDays(CITI_HOLD_DAYS, CITI_HOLD_DEADLINE_TYPE, now);
  return {
    phaseCode: RETENTION_PHASE.citi,
    statusCode: 'p3_hold',
    assignedAgentZohoUserId: null,
    currentDeadlineAt: hold.currentDeadlineAt,
    currentDeadlineType: hold.currentDeadlineType,
    citiFolderEnteredAt: now,
    citiFolderHoldUntil: hold.currentDeadlineAt,
    vacationCountdownEnd: null,
    eventType: 'timer_expired',
    eventNotes: opts.notes ?? 'Moved to CITI folder',
  };
}

export function vacationFollowupTask(
  opts: { now?: Date } = {},
): CaseTransitionPatch {
  const now = opts.now ?? new Date();
  const follow = stampVacationFollowupDeadline(now);
  return {
    phaseCode: RETENTION_PHASE.agent,
    statusCode: 'p1_vacation_followup',
    agentOutcome: 'vacation',
    currentDeadlineAt: follow.currentDeadlineAt,
    currentDeadlineType: follow.currentDeadlineType,
    eventType: 'timer_expired',
    eventNotes: 'Vacation countdown ended — new task (2 BD)',
  };
}

export function awaitingOpsSignoff(
  opts: { now?: Date } = {},
): CaseTransitionPatch {
  return {
    phaseCode: RETENTION_PHASE.agent,
    statusCode: 'p1_awaiting_ops',
    agentOutcome: 'vacation',
    currentDeadlineAt: null,
    currentDeadlineType: null,
    eventType: 'timer_expired',
    eventNotes: 'Vacation again — awaiting Ops Manager confirmation',
  };
}

/** Reset to Phase 1 after Ops confirms still on vacation. */
export function resetPhase1AfterOps(
  opts: { now?: Date } = {},
): CaseTransitionPatch {
  const now = opts.now ?? new Date();
  const action = stampPhase1ActionDeadline(now);
  return {
    phaseCode: RETENTION_PHASE.agent,
    statusCode: 'p1_new',
    agentOutcome: null,
    outOfReachAttempts: 0,
    vacationCountdownEnd: null,
    currentDeadlineAt: action.currentDeadlineAt,
    currentDeadlineType: action.currentDeadlineType,
    eventType: 'signoff',
    eventNotes: 'Ops confirmed vacation — back to Phase 1',
  };
}

export function reachedWatching(opts: { now?: Date } = {}): CaseTransitionPatch {
  const now = opts.now ?? new Date();
  const watch = stampPostContactDeadline(now);
  return {
    phaseCode: RETENTION_PHASE.agent,
    statusCode: 'p1_reached',
    agentOutcome: 'returned',
    currentDeadlineAt: watch.currentDeadlineAt,
    currentDeadlineType: watch.currentDeadlineType,
    eventType: 'outcome_recorded',
    eventNotes: 'Reached — 5 BD window for new transaction',
  };
}

/** Apply a transition patch via retentionCaseRepo.update fields. */
export function patchToUpdateInput(
  patch: CaseTransitionPatch,
  actorZohoUserId?: string,
): {
  phaseCode: string;
  statusCode: string;
  agentOutcome?: AgentOutcome | null;
  assignedAgentZohoUserId?: string | null;
  assignmentCount?: number;
  openPoolAttemptCount?: number;
  outOfReachAttempts?: number;
  dealOwnerChanged?: boolean;
  currentDeadlineAt?: Date | null;
  currentDeadlineType?: string | null;
  vacationCountdownEnd?: Date | null;
  citiFolderEnteredAt?: Date | null;
  citiFolderHoldUntil?: Date | null;
  reasonNote?: string | null;
  eventType: string;
  eventNotes?: string;
  actorZohoUserId?: string;
} {
  return {
    phaseCode: patch.phaseCode,
    statusCode: patch.statusCode,
    ...(patch.agentOutcome !== undefined ? { agentOutcome: patch.agentOutcome } : {}),
    ...(patch.assignedAgentZohoUserId !== undefined
      ? { assignedAgentZohoUserId: patch.assignedAgentZohoUserId }
      : {}),
    ...(patch.poolOwnerZohoUserId !== undefined
      ? { poolOwnerZohoUserId: patch.poolOwnerZohoUserId }
      : {}),
    ...(patch.pendingClaimantZohoUserId !== undefined
      ? { pendingClaimantZohoUserId: patch.pendingClaimantZohoUserId }
      : {}),
    ...(patch.assignmentCount !== undefined ? { assignmentCount: patch.assignmentCount } : {}),
    ...(patch.openPoolAttemptCount !== undefined
      ? { openPoolAttemptCount: patch.openPoolAttemptCount }
      : {}),
    ...(patch.outOfReachAttempts !== undefined
      ? { outOfReachAttempts: patch.outOfReachAttempts }
      : {}),
    ...(patch.dealOwnerChanged !== undefined ? { dealOwnerChanged: patch.dealOwnerChanged } : {}),
    ...(patch.currentDeadlineAt !== undefined
      ? { currentDeadlineAt: patch.currentDeadlineAt }
      : {}),
    ...(patch.currentDeadlineType !== undefined
      ? { currentDeadlineType: patch.currentDeadlineType }
      : {}),
    ...(patch.vacationCountdownEnd !== undefined
      ? { vacationCountdownEnd: patch.vacationCountdownEnd }
      : {}),
    ...(patch.citiFolderEnteredAt !== undefined
      ? { citiFolderEnteredAt: patch.citiFolderEnteredAt }
      : {}),
    ...(patch.citiFolderHoldUntil !== undefined
      ? { citiFolderHoldUntil: patch.citiFolderHoldUntil }
      : {}),
    eventType: patch.eventType,
    ...(patch.eventNotes !== undefined ? { eventNotes: patch.eventNotes } : {}),
    ...(actorZohoUserId ? { actorZohoUserId } : {}),
  };
}

export function isAgentActionDeadline(type: string | null | undefined): boolean {
  return type === PHASE1_DEADLINE_TYPE;
}

export function describeDeadline(row: Pick<RetentionCase, 'currentDeadlineType'>): string {
  switch (row.currentDeadlineType) {
    case PHASE1_DEADLINE_TYPE:
      return '2 BD agent action';
    case COMMS_ATTEMPT_DEADLINE_TYPE:
      return '1 BD comms attempt';
    case POST_CONTACT_DEADLINE_TYPE:
      return '5 BD post-contact';
    case POOL_CLAIM_DEADLINE_TYPE:
      return '3 BD pool claim';
    case CLAIM_APPROVE_DEADLINE_TYPE:
      return '1 BD claim approve';
    case NEW_OWNER_DEADLINE_TYPE:
      return '3 BD new owner';
    case RETENTION_WAIT_DEADLINE_TYPE:
      return '10 BD Retention wait';
    case VACATION_COUNTDOWN_TYPE:
      return '14D vacation';
    case VACATION_FOLLOWUP_DEADLINE_TYPE:
      return '2 BD vacation follow-up';
    case CITI_HOLD_DEADLINE_TYPE:
      return '7D CITI hold';
    default:
      return row.currentDeadlineType ?? 'deadline';
  }
}
