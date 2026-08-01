import {
  ESCALATION_LEVEL_LABELS,
  type EscalationLevel,
  type MytrionEscalation,
  type MytrionEscalationHop,
  type MytrionThread,
} from '../../db/schema/index.js';
import { NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { commsEscalationRepo } from '../../repos/commsEscalationRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { actorZohoUserIdOf, commsThreadRepo } from '../../repos/commsThreadRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { commsTicketRepo, type CreatedTicket } from '../../repos/commsTicketRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  departmentOfWorker,
  resolveDepartmentManager,
  resolveReason,
  resolveWorkerName,
} from './escalationRouting.js';
import { hopDueAt, notifyChain } from './escalationNotify.js';

/**
 * Raising an escalation. The transitions that follow live in escalationTransitions.ts.
 *
 * THE INVARIANT THAT SHAPES EVERYTHING: an escalation is a GROWING GROUP CONVERSATION. Every hop ADDS the
 * new assignee to the thread and never removes anyone, so the requester, the level-2 agent, the manager
 * and the C-Level all end up in the same chat and can all keep reading and replying. Consequently
 * `visibility` stays 'participants' for the escalation's whole life — flipping it to 'department' on a
 * hand-off would expose the entire history to everyone holding the receiving department, a far wider
 * audience than the people actually involved.
 *
 * An escalation is also PERSONAL: no carrier, no company. That is enforced by
 * `mytrion_tickets_escalation_personal_chk`, not by convention.
 */

export interface RaiseEscalationInput {
  reasonCode: string;
  subject: string;
  description: string;
  idempotencyKey?: string | undefined;
  sourceMytrion?: string | undefined;
  sourceDepartment?: string | undefined;
}

export interface RaisedEscalation {
  escalation: MytrionEscalation;
  created: CreatedTicket;
}

interface FirstLanding {
  level: EscalationLevel;
  assignee: string;
  department: string | null;
  routingSource: 'reason_default' | 'department_manager';
  skipReason: string | null;
}

/**
 * Where a freshly raised escalation lands.
 *
 * Normally level 2, the reason's configured fall-to user. If that user IS the person raising it, rise
 * straight to their department manager instead: routing someone's own escalation to themselves is a dead
 * end, not a hop, and `skip_reason='is_requester'` records why the ladder started a level higher.
 *
 * An unrouted reason is REFUSED rather than parked. An escalation with a null assignee sits in nobody's
 * inbox while looking submitted to the person who raised it, which is the worst of both outcomes.
 */
async function resolveFirstLanding(
  ctx: TenantContext,
  reasonLabel: string,
  reasonAssignee: string | null,
  actor: string,
): Promise<FirstLanding> {
  if (!reasonAssignee) {
    throw new ValidationError(
      `'${reasonLabel}' has no assignee configured yet. Ask an admin to set its fall-to user in Mytrion Admin.`,
    );
  }

  if (reasonAssignee !== actor) {
    return {
      level: 2,
      assignee: reasonAssignee,
      department: await departmentOfWorker(ctx, reasonAssignee),
      routingSource: 'reason_default',
      skipReason: null,
    };
  }

  const requesterDept = await departmentOfWorker(ctx, actor);
  const manager = await resolveDepartmentManager(ctx, requesterDept);
  if (!manager.zohoUserId || manager.zohoUserId === actor) {
    throw new ValidationError(
      `'${reasonLabel}' falls to you, and your department has no other manager configured to escalate to. Ask an admin to set one in Mytrion Admin.`,
    );
  }
  return {
    level: 3,
    assignee: manager.zohoUserId,
    department: requesterDept,
    routingSource: 'department_manager',
    skipReason: 'is_requester',
  };
}

/**
 * Raise an escalation: an `E-` ticket, its thread, the routing cursor and hop 1, then the fan-out.
 *
 * Hop 1 is the level-2 landing, NOT the requester — the requester is `requester_zoho_user_id` and holds
 * role='requester' on the thread. That is why hop 1's `decided_by` is NULL: nobody moved it there.
 */
export async function raiseEscalation(
  ctx: TenantContext,
  input: RaiseEscalationInput,
): Promise<RaisedEscalation> {
  const actor = actorZohoUserIdOf(ctx);
  if (!actor) throw new RBACError('Raising an escalation requires a signed-in worker identity.');

  const { reason, assigneeZohoUserId } = await resolveReason(ctx, input.reasonCode);
  const landing = await resolveFirstLanding(ctx, reason.label, assigneeZohoUserId, actor);

  const assigneeName = await resolveWorkerName(ctx, landing.assignee);
  const requesterDepartment = await departmentOfWorker(ctx, actor);
  const sla = await hopDueAt(ctx, new Date());
  const levelLabel = ESCALATION_LEVEL_LABELS[landing.level];

  // The E- ticket carries the number and the lifecycle, and NO carrier / company — the CHECK constraint
  // enforces that. `visibility: 'participants'` with a null thread department is what keeps an escalation
  // off every department queue.
  const created = await commsTicketRepo.createWithThread(ctx, {
    kind: 'escalation',
    ticketTypeId: reason.id,
    ticketTypeCode: reason.code,
    ticketTypeLabel: reason.label,
    targetDepartment: landing.department,
    sourceDepartment: input.sourceDepartment ?? requesterDepartment,
    sourceMytrion: input.sourceMytrion ?? null,
    priority: reason.defaultPriority ?? 'high',
    requesterKind: 'worker',
    requesterZohoUserId: actor,
    requesterName: ctx.userName ?? actor,
    channel: 'web',
    source: 'worker',
    slaHours: sla.hours,
    dueAt: sla.dueAt,
    firstResponseDueAt: sla.dueAt,
    idempotencyKey: input.idempotencyKey ?? null,
    createdByZohoUserId: actor,
    subject: input.subject,
    visibility: 'participants',
    threadDepartment: null,
    body: input.description,
  });

  // A replay wrote nothing; hand back the existing chain rather than starting a second one on the same
  // ticket (`mytrion_escalations_ticket_uk` would refuse it anyway, as a 500 instead of an answer).
  if (!created.created) {
    const existing = await commsEscalationRepo.getByTicketForReader(ctx, created.ticket.id);
    if (existing) return { escalation: existing, created };
  }

  const escalation = await commsEscalationRepo.create(ctx, {
    threadId: created.thread.id,
    ticketId: created.ticket.id,
    reasonTypeId: reason.id,
    reasonCode: reason.code,
    reasonLabel: reason.label,
    requesterZohoUserId: actor,
    requesterName: ctx.userName ?? actor,
    requesterDepartment,
    currentLevel: landing.level,
    currentDepartment: landing.department,
    currentAssigneeZohoUserId: landing.assignee,
    currentAssigneeName: assigneeName,
    hopDueAt: sla.dueAt,
  });

  await commsEscalationRepo.appendHop(ctx, {
    escalationId: escalation.id,
    hopIndex: 1,
    level: landing.level,
    levelLabel,
    department: landing.department,
    assigneeZohoUserId: landing.assignee,
    assigneeName,
    routingSource: landing.routingSource,
    skipReason: landing.skipReason,
    decidedByZohoUserId: null,
    decision: 'raised',
    status: 'pending',
    slaHours: sla.hours,
    dueAt: sla.dueAt,
  });

  await commsEscalationRepo.mirrorOntoTicket(ctx, created.ticket.id, {
    escalationId: escalation.id,
    level: landing.level,
    levelLabel,
    assigneeZohoUserId: landing.assignee,
    assigneeName,
    targetDepartment: landing.department,
    status: 'escalated',
  });

  await commsThreadMemberRepo.transferAssignee(ctx, created.thread.id, {
    memberKind: 'worker',
    memberKey: landing.assignee,
    memberName: assigneeName,
  });

  await commsTicketEventRepo.append(ctx, {
    ticketId: created.ticket.id,
    threadId: created.thread.id,
    eventType: 'escalated',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    toStatus: 'escalated',
    detail: {
      escalationId: escalation.id,
      reasonCode: reason.code,
      level: landing.level,
      assignee: landing.assignee,
      routingSource: landing.routingSource,
      skipReason: landing.skipReason,
    },
  });

  await notifyChain(ctx, {
    threadId: created.thread.id,
    escalationId: escalation.id,
    ticketId: created.ticket.id,
    type: 'comms.escalation.raised',
    level: landing.level,
    assignee: landing.assignee,
    assigneeName,
    number: created.ticket.number,
    actor,
  });

  return { escalation, created };
}

export interface EscalationChain {
  escalation: MytrionEscalation;
  hops: MytrionEscalationHop[];
  thread: MytrionThread | undefined;
}

/** The full chain, for the ladder view. The readable load IS the authorization. */
export async function loadChain(
  ctx: TenantContext,
  escalationId: string,
): Promise<EscalationChain> {
  const escalation = await commsEscalationRepo.getForReader(ctx, escalationId);
  if (!escalation) throw new NotFoundError('Escalation not found.');
  const [hops, thread] = await Promise.all([
    commsEscalationRepo.listHops(ctx, escalationId),
    commsThreadRepo.getForReader(ctx, escalation.threadId),
  ]);
  return { escalation, hops, thread };
}
