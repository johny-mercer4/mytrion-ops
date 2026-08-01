import {
  ESCALATION_LEVEL_LABELS,
  type EscalationLevel,
  type MytrionEscalation,
} from '../../db/schema/index.js';
import { ConflictError, NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { commsEscalationRepo } from '../../repos/commsEscalationRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { actorZohoUserIdOf } from '../../repos/commsThreadRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  C_LEVEL_DEPARTMENT,
  resolveCLevel,
  resolveDepartmentManager,
  resolveHandOffTarget,
  resolveWorkerName,
} from './escalationRouting.js';
import {
  hopDueAt,
  loadForDecision,
  MAX_HOPS,
  notifyChain,
  type EscalationEventType,
} from './escalationNotify.js';
import { publishSafely, publishUserEvent } from './publish.js';

/**
 * Everything that happens to an escalation AFTER it is raised: up a level, sideways to another
 * department, or terminal (resolved / rejected / withdrawn).
 *
 * Every transition resolves its next assignee from admin config at that instant and then SNAPSHOTS the
 * answer onto the new hop, so editing config later cannot reroute a chain already in flight.
 */

export interface EscalateUpInput {
  escalationId: string;
  expectedVersion: number;
  comment?: string | undefined;
  /** REQUIRED to reach level 4: which C-Level member. Validated against the `c-level` pool. */
  toZohoUserId?: string | undefined;
}

/**
 * Escalate UP one level: agent (2) → department manager (3) → C-Level (4).
 *
 * Level 4 needs an explicit person because it is CEO *and* COO and which to involve is a human call —
 * the reason 0087 replaced the single `c_level_zoho_user_id` column with a pool.
 */
export async function escalateUp(
  ctx: TenantContext,
  input: EscalateUpInput,
): Promise<MytrionEscalation> {
  const { escalation, actor } = await loadForDecision(
    ctx,
    input.escalationId,
    input.expectedVersion,
  );

  if (escalation.currentLevel >= 4) {
    throw new ValidationError(
      'This escalation is already at C-Level — there is no level above it. Resolve it or hand it off instead.',
    );
  }
  if (escalation.currentHopIndex >= MAX_HOPS) {
    throw new ValidationError(
      `This escalation has already been through ${MAX_HOPS} hops. Resolve it or take it off-system.`,
    );
  }

  let nextLevel: EscalationLevel;
  let nextAssignee: string;
  let nextName: string;
  let nextDepartment: string | null;
  let routingSource: 'department_manager' | 'c_level';

  // Level 3 is only a real rung when the department HAS a manager and that manager is not the person
  // currently holding it. In a small department the agent and the head are often the same person, and
  // routing an escalation to whoever already has it is a dead end rather than a hop.
  const dept = escalation.currentDepartment ?? escalation.requesterDepartment;
  const manager = escalation.currentLevel === 2 ? await resolveDepartmentManager(ctx, dept) : null;
  const managerRungAvailable =
    manager !== null && manager.zohoUserId !== null && manager.zohoUserId !== actor;

  if (managerRungAvailable && manager?.zohoUserId) {
    nextLevel = 3;
    routingSource = 'department_manager';
    nextAssignee = manager.zohoUserId;
    nextName = await resolveWorkerName(ctx, manager.zohoUserId, manager.name);
    nextDepartment = dept;
  } else {
    // Straight to C-Level. Reachable from level 3 normally, and from level 2 when the manager rung is
    // vacuous — otherwise a lone department head holding their own escalation would be stuck, told to
    // escalate to C-Level by an operation that could not take them there.
    nextLevel = 4;
    routingSource = 'c_level';
    if (!input.toZohoUserId) {
      const why =
        escalation.currentLevel === 2
          ? manager?.zohoUserId === actor
            ? 'You are the configured manager for this department, so the next rung is C-Level'
            : `${dept ? `The ${dept} department has` : 'This escalation has'} no manager configured, so the next rung is C-Level`
          : 'Escalating to C-Level';
      throw new ValidationError(`${why} — pick the CEO or the COO.`);
    }
    const cLevel = await resolveCLevel(ctx, input.toZohoUserId);
    nextAssignee = cLevel.zohoUserId;
    nextName = cLevel.name;
    nextDepartment = C_LEVEL_DEPARTMENT;
  }

  return applyHop(ctx, escalation, actor, {
    nextLevel,
    nextAssignee,
    nextName,
    nextDepartment,
    routingSource,
    closeStatus: 'escalated_up',
    closeDecision: 'escalated_up',
    eventType: 'comms.escalation.advanced',
    comment: input.comment ?? null,
    systemBody: `Escalated to ${ESCALATION_LEVEL_LABELS[nextLevel]} — ${nextName}.`,
  });
}

export interface HandOffInput {
  escalationId: string;
  expectedVersion: number;
  toDepartment: string;
  /** Optional specific person; must hold a seat in that department or be its configured default/manager. */
  toZohoUserId?: string | undefined;
  note?: string | undefined;
}

/**
 * Hand off SIDEWAYS to another department, re-entering at its agent level (level 2 again).
 *
 * The level RESETS to 2 rather than carrying over: the receiving department's ladder starts at its own
 * agent, so a chain handed off by a manager at level 3 must still be able to rise to the NEW department's
 * manager afterwards. Carrying level 3 across would skip that person entirely.
 */
export async function handOffEscalation(
  ctx: TenantContext,
  input: HandOffInput,
): Promise<MytrionEscalation> {
  const { escalation, actor } = await loadForDecision(
    ctx,
    input.escalationId,
    input.expectedVersion,
  );

  if (escalation.currentHopIndex >= MAX_HOPS) {
    throw new ValidationError(
      `This escalation has already been through ${MAX_HOPS} hops. Resolve it or take it off-system.`,
    );
  }
  if (input.toDepartment === C_LEVEL_DEPARTMENT) {
    throw new ValidationError('Use Escalate to C-Level rather than a sideways hand-off.');
  }
  if (input.toDepartment === escalation.currentDepartment) {
    throw new ValidationError('This escalation is already in that department.');
  }

  const target = await resolveHandOffTarget(ctx, input.toDepartment, input.toZohoUserId);
  if (target.zohoUserId === actor) {
    throw new ValidationError('That hand-off would assign the escalation back to you.');
  }

  return applyHop(ctx, escalation, actor, {
    nextLevel: 2,
    nextAssignee: target.zohoUserId,
    nextName: target.name,
    nextDepartment: target.department,
    routingSource: 'manual',
    closeStatus: 'handed_off',
    closeDecision: 'handed_off',
    eventType: 'comms.escalation.handed_off',
    comment: input.note ?? null,
    handoffNote: input.note ?? null,
    systemBody: `Handed off to ${target.department} — ${target.name}.`,
  });
}

interface HopMove {
  nextLevel: EscalationLevel;
  nextAssignee: string;
  nextName: string;
  nextDepartment: string | null;
  routingSource: 'department_manager' | 'c_level' | 'manual';
  closeStatus: 'escalated_up' | 'handed_off';
  closeDecision: 'escalated_up' | 'handed_off';
  eventType: EscalationEventType;
  comment: string | null;
  handoffNote?: string | null;
  systemBody: string;
}

/** "Close this hop, open the next, move the cursor, add the new person, tell everyone." */
async function applyHop(
  ctx: TenantContext,
  escalation: MytrionEscalation,
  actor: string,
  move: HopMove,
): Promise<MytrionEscalation> {
  const nextHopIndex = escalation.currentHopIndex + 1;
  const sla = await hopDueAt(ctx, new Date());

  // The cursor moves FIRST, because it carries the optimistic-version check. Closing the hop before
  // knowing whether this caller won the race would leave a hop marked decided on a chain that someone
  // else moved a different way.
  const moved = await commsEscalationRepo.advanceCursor(ctx, {
    escalationId: escalation.id,
    expectedVersion: escalation.version,
    currentLevel: move.nextLevel,
    currentHopIndex: nextHopIndex,
    currentDepartment: move.nextDepartment,
    currentAssigneeZohoUserId: move.nextAssignee,
    currentAssigneeName: move.nextName,
    hopDueAt: sla.dueAt,
  });
  if (!moved) {
    throw new ConflictError('This escalation moved while you were deciding. Reload and try again.');
  }

  await commsEscalationRepo.closeHop(ctx, escalation.id, escalation.currentHopIndex, {
    status: move.closeStatus,
    decision: move.closeDecision,
    decidedByZohoUserId: actor,
    decisionComment: move.comment,
    handoffNote: move.handoffNote ?? null,
  });

  await commsEscalationRepo.appendHop(ctx, {
    escalationId: escalation.id,
    hopIndex: nextHopIndex,
    level: move.nextLevel,
    levelLabel: ESCALATION_LEVEL_LABELS[move.nextLevel],
    department: move.nextDepartment,
    assigneeZohoUserId: move.nextAssignee,
    assigneeName: move.nextName,
    routingSource: move.routingSource,
    handoffNote: move.handoffNote ?? null,
    decidedByZohoUserId: actor,
    status: 'pending',
    slaHours: sla.hours,
    dueAt: sla.dueAt,
  });

  await commsEscalationRepo.mirrorOntoTicket(ctx, escalation.ticketId, {
    escalationId: escalation.id,
    level: move.nextLevel,
    levelLabel: ESCALATION_LEVEL_LABELS[move.nextLevel],
    assigneeZohoUserId: move.nextAssignee,
    assigneeName: move.nextName,
    targetDepartment: move.nextDepartment,
  });

  // GROWING GROUP: transferAssignee moves the ROLE and demotes the previous holder to participant — it
  // never removes them, so everyone who has been involved keeps reading and replying. ensureWatcher keeps
  // the deciding admin on the thread in the blanket-access case, where they held no row before.
  await commsThreadMemberRepo.transferAssignee(ctx, escalation.threadId, {
    memberKind: 'worker',
    memberKey: move.nextAssignee,
    memberName: move.nextName,
  });
  await commsThreadMemberRepo.ensureWatcher(ctx, escalation.threadId, {
    memberKind: 'worker',
    memberKey: actor,
    memberName: ctx.userName ?? null,
  });

  await commsTicketEventRepo.append(ctx, {
    ticketId: escalation.ticketId,
    threadId: escalation.threadId,
    eventType: 'escalation_advanced',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    detail: {
      escalationId: escalation.id,
      fromLevel: escalation.currentLevel,
      toLevel: move.nextLevel,
      assignee: move.nextAssignee,
      department: move.nextDepartment,
      routingSource: move.routingSource,
    },
  });

  await notifyChain(ctx, {
    threadId: escalation.threadId,
    escalationId: escalation.id,
    ticketId: escalation.ticketId,
    type: move.eventType,
    level: move.nextLevel,
    assignee: move.nextAssignee,
    assigneeName: move.nextName,
    actor,
    systemBody: move.systemBody,
  });

  return moved;
}

export interface CloseEscalationInput {
  escalationId: string;
  expectedVersion: number;
  comment?: string | undefined;
}

/**
 * Resolve or reject. Terminal either way — the cursor's assignee is cleared so it leaves every "waiting on
 * me" inbox, while the chain stays fully readable to everyone who was ever on it.
 */
export async function closeEscalation(
  ctx: TenantContext,
  outcome: 'resolved' | 'rejected',
  input: CloseEscalationInput,
): Promise<MytrionEscalation> {
  const { escalation, actor } = await loadForDecision(
    ctx,
    input.escalationId,
    input.expectedVersion,
  );
  return finalize(ctx, escalation, outcome, actor, input.comment ?? null);
}

/**
 * Withdraw — the REQUESTER's own cancel.
 *
 * Deliberately not routed through `loadForDecision`: that gate asks "is this currently with you", and a
 * requester whose escalation is three hops up never is. The gate here is "did you raise it".
 */
export async function withdrawEscalation(
  ctx: TenantContext,
  input: CloseEscalationInput,
): Promise<MytrionEscalation> {
  const actor = actorZohoUserIdOf(ctx);
  if (!actor) throw new RBACError('Withdrawing an escalation requires a signed-in worker identity.');

  const escalation = await commsEscalationRepo.getForReader(ctx, input.escalationId);
  if (!escalation) throw new NotFoundError('Escalation not found.');
  if (escalation.status !== 'pending') {
    throw new ConflictError(`This escalation is already ${escalation.status}.`);
  }
  if (escalation.version !== input.expectedVersion) {
    throw new ConflictError(
      'This escalation moved while you were looking at it. Reload and try again.',
    );
  }
  const blanket = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
  if (!blanket && escalation.requesterZohoUserId !== actor) {
    throw new RBACError('Only the person who raised an escalation can withdraw it.');
  }
  return finalize(ctx, escalation, 'withdrawn', actor, input.comment ?? null);
}

async function finalize(
  ctx: TenantContext,
  escalation: MytrionEscalation,
  outcome: 'resolved' | 'rejected' | 'withdrawn',
  actor: string,
  comment: string | null,
): Promise<MytrionEscalation> {
  const level = escalation.currentLevel as EscalationLevel;

  const closed = await commsEscalationRepo.advanceCursor(ctx, {
    escalationId: escalation.id,
    expectedVersion: escalation.version,
    currentLevel: level,
    currentHopIndex: escalation.currentHopIndex,
    currentDepartment: escalation.currentDepartment,
    // Cleared so it leaves every "escalations waiting on me" inbox — that index is keyed on this column.
    currentAssigneeZohoUserId: null,
    currentAssigneeName: null,
    hopDueAt: null,
    status: outcome,
    resolutionComment: comment,
    resolvedByZohoUserId: actor,
  });
  if (!closed) {
    throw new ConflictError('This escalation moved while you were deciding. Reload and try again.');
  }

  await commsEscalationRepo.closeHop(ctx, escalation.id, escalation.currentHopIndex, {
    status: outcome === 'resolved' ? 'resolved' : 'rejected',
    decision: outcome,
    decidedByZohoUserId: actor,
    decisionComment: comment,
  });

  await commsEscalationRepo.mirrorOntoTicket(ctx, escalation.ticketId, {
    escalationId: escalation.id,
    level,
    levelLabel: ESCALATION_LEVEL_LABELS[level],
    assigneeZohoUserId: null,
    assigneeName: null,
    // A rejected or withdrawn escalation is cancelled, not resolved: the request did not get what it
    // asked for, and an SLA report that counted it as resolved would be flattering and wrong.
    status: outcome === 'resolved' ? 'resolved' : 'cancelled',
  });

  await commsTicketEventRepo.append(ctx, {
    ticketId: escalation.ticketId,
    threadId: escalation.threadId,
    eventType: 'escalation_resolved',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    toStatus: outcome === 'resolved' ? 'resolved' : 'cancelled',
    detail: { escalationId: escalation.id, outcome, level },
  });

  const systemBody =
    outcome === 'resolved'
      ? `Resolved${comment ? `: ${comment}` : '.'}`
      : outcome === 'rejected'
        ? `Rejected${comment ? `: ${comment}` : '.'}`
        : `Withdrawn by the requester${comment ? `: ${comment}` : '.'}`;

  await notifyChain(ctx, {
    threadId: escalation.threadId,
    escalationId: escalation.id,
    ticketId: escalation.ticketId,
    type: 'comms.escalation.resolved',
    level,
    assignee: null,
    assigneeName: null,
    actor,
    systemBody,
  });

  // The requester is pinged directly: they are on the thread, but a terminal outcome is the one event they
  // are actually waiting for and they may well not have it open.
  publishSafely('comms.escalation.resolved:requester', () => {
    publishUserEvent(escalation.requesterZohoUserId, {
      type: 'comms.escalation.resolved',
      threadId: escalation.threadId,
      escalationId: escalation.id,
      ticketId: escalation.ticketId,
      outcome,
    });
  });

  return closed;
}
