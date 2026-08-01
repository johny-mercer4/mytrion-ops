import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { agentPresenceRepo } from '../../repos/agentPresenceRepo.js';
import { commsDepartmentRepo } from '../../repos/commsDepartmentRepo.js';
import { commsThreadMemberRepo } from '../../repos/commsThreadMemberRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { commsTicketStateRepo } from '../../repos/commsTicketStateRepo.js';
import type { MytrionTicket } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { publishSafely, publishThreadEvent, publishUserEvent } from './publish.js';

/**
 * Round-robin ticket assignment over the department roster.
 *
 * The roster is `mytrion_department_agents` — explicit rows an admin manages in Mytrion Admin, NOT derived
 * from who holds the department grant. Deriving it would auto-assign live client tickets to every admin and
 * every read-only viewer who can merely open the Mytrion; deriving from `hr_employees.department_id` would
 * conflate being in a department with being on the rota (a head, a trainee and someone on parental leave are
 * all "in" CS).
 *
 * ASSIGNMENT MUST NEVER FAIL A CREATE. A ticket that could not be assigned is still a filed ticket: it stays
 * visible to the whole department through the queue, and the journal records why nobody got it. Throwing
 * here would lose a customer request over a staffing gap.
 */

/** Why a ticket ended up unassigned. Stored on the journal row so the queue can explain itself. */
export type AssignmentSkipReason =
  | 'manual_strategy'
  | 'no_department'
  | 'department_not_configured'
  | 'empty_roster'
  | 'nobody_eligible'
  | 'nobody_online';

export interface AssignmentOutcome {
  assigned: boolean;
  zohoUserId?: string;
  name?: string | null;
  strategy?: string;
  skipReason?: AssignmentSkipReason;
}

/**
 * Which roster members count as reachable right now.
 *
 * Returns `undefined` — meaning "do not filter on presence at all" — in two cases, and the distinction
 * matters:
 *   * the department does not require online agents, or
 *   * PRESENCE TRACKING IS OFF (`FF_COMMS_PRESENCE=0`). With the feature flag off nothing is ever written to
 *     `mytrion_agent_presence`, so honouring `require_online` would make the eligible set permanently empty
 *     and no ticket would ever be assigned. 0087 seeds `require_online = true` for customer-service, billing
 *     and verification, so without this the default configuration would silently assign nothing.
 */
async function onlineFilterFor(
  ctx: TenantContext,
  department: string,
  requireOnline: boolean,
): Promise<string[] | undefined> {
  if (!requireOnline) return undefined;
  if (!env.FF_COMMS_PRESENCE) {
    logger.debug(
      { department },
      'assignment: require_online ignored because presence tracking is disabled',
    );
    return undefined;
  }
  const roster = await commsDepartmentRepo.listPool(ctx, {
    departments: [department],
    activeOnly: true,
  });
  if (roster.length === 0) return [];
  const ids = roster.map((r) => r.zohoUserId);
  const staleBefore = new Date(Date.now() - env.PRESENCE_STALE_MS);
  const [presence, availability] = await Promise.all([
    agentPresenceRepo.presenceFor(ctx, ids, staleBefore),
    agentPresenceRepo.listAvailability(ctx, ids),
  ]);

  // TWO independent conditions, and both are needed:
  //   socketCount > 0   they are actually reachable (a lease refreshed within PRESENCE_STALE_MS)
  //   availability      they have not marked themselves away or do-not-assign
  // Connected-but-away is the common case an hour before end of shift, and giving that person the next
  // ticket is exactly what makes agents distrust the rotation.
  const notAvailable = new Set(
    availability.filter((a) => a.availability !== 'available').map((a) => a.zohoUserId),
  );
  return presence
    .filter((p) => p.socketCount > 0 && !notAvailable.has(p.zohoUserId))
    .map((p) => p.zohoUserId);
}

/**
 * Pick and record an assignee for a freshly created ticket.
 *
 * Order of writes is deliberate: the roster claim happens FIRST (it is the atomic, contended step), and only
 * then is the ticket stamped. If the stamp fails the claim is released, so an agent cannot be pushed to the
 * back of the rotation for work they never received.
 */
export async function autoAssignTicket(
  ctx: TenantContext,
  ticket: MytrionTicket,
  threadId: string,
): Promise<AssignmentOutcome> {
  const department = ticket.targetDepartment;
  if (!department) return skip(ctx, ticket, threadId, 'no_department');

  const config = await commsDepartmentRepo.get(ctx, department);
  if (!config) return skip(ctx, ticket, threadId, 'department_not_configured');
  // 'manual' is a real choice, not a gap: c-level and sales are seeded manual because nobody works a
  // round-robin queue there. It must not be reported as a staffing problem.
  if (config.ticketAssignmentStrategy === 'manual') {
    return skip(ctx, ticket, threadId, 'manual_strategy');
  }

  const roster = await commsDepartmentRepo.listPool(ctx, {
    departments: [department],
    activeOnly: true,
  });
  if (roster.length === 0) return skip(ctx, ticket, threadId, 'empty_roster');

  const online = await onlineFilterFor(ctx, department, config.requireOnline);
  const seat = await commsDepartmentRepo.claimNextAgent(ctx, department, {
    strategy: config.ticketAssignmentStrategy,
    onlineZohoUserIds: online,
  });
  if (!seat) {
    // Distinguish "everyone is offline" from "everyone is at capacity / not accepting" — they need
    // different fixes, and a queue that cannot say which is a queue nobody trusts.
    return skip(
      ctx,
      ticket,
      threadId,
      online !== undefined && online.length === 0 ? 'nobody_online' : 'nobody_eligible',
    );
  }

  const name = seat.displayName ?? seat.zohoUserId;
  const stamped = await commsTicketStateRepo.assign(ctx, {
    ticketId: ticket.id,
    zohoUserId: seat.zohoUserId,
    name,
    reason: 'auto',
  });
  if (!stamped) {
    await commsDepartmentRepo.releaseClaim(ctx, department, seat.zohoUserId);
    return skip(ctx, ticket, threadId, 'nobody_eligible');
  }

  // The assignee joins the thread so the ticket shows up in their own lane and read state, rather than only
  // in the department queue.
  await commsThreadMemberRepo.transferAssignee(ctx, threadId, {
    memberKind: 'worker',
    memberKey: seat.zohoUserId,
    memberName: name,
  });

  await commsTicketEventRepo.append(ctx, {
    ticketId: ticket.id,
    threadId,
    eventType: 'auto_assigned',
    // NULL actor: the auto-assigner is not a person.
    actorZohoUserId: null,
    detail: {
      assignee: seat.zohoUserId,
      department,
      strategy: config.ticketAssignmentStrategy,
      rosterSize: roster.length,
      onlineCount: online?.length ?? null,
      assignedCount: seat.assignedCount,
    },
  });

  publishSafely('comms.ticket.assigned', () => {
    const payload = {
      type: 'comms.ticket.assigned' as const,
      threadId,
      ticketId: ticket.id,
      number: ticket.number,
      assigneeZohoUserId: seat.zohoUserId,
      assigneeName: name,
      targetDepartment: department,
    };
    // The queue board (so the row moves out of "unassigned") and the assignee's own lane (so they are told
    // even with a different tab open).
    publishThreadEvent({ id: threadId, department }, [], payload, { alsoQueue: true });
    publishUserEvent(seat.zohoUserId, payload);
  });

  return {
    assigned: true,
    zohoUserId: seat.zohoUserId,
    name,
    strategy: config.ticketAssignmentStrategy,
  };
}

/** Journal the miss so the queue can explain an unassigned ticket, then return it unassigned. */
async function skip(
  ctx: TenantContext,
  ticket: MytrionTicket,
  threadId: string,
  reason: AssignmentSkipReason,
): Promise<AssignmentOutcome> {
  // 'manual' is the configured intent, not a failure — journalling it would fill the trail with noise.
  if (reason !== 'manual_strategy') {
    await commsTicketEventRepo
      .append(ctx, {
        ticketId: ticket.id,
        threadId,
        eventType: 'assignment_failed',
        actorZohoUserId: null,
        detail: { reason, department: ticket.targetDepartment },
      })
      .catch((err: unknown) => {
        logger.warn({ err, ticketId: ticket.id }, 'assignment: could not journal the skip');
      });
  }
  return { assigned: false, skipReason: reason };
}

/**
 * Take an unassigned ticket for yourself, or hand it to a named colleague.
 *
 * `claimed` vs `manual` in `assignment_reason` is the difference between "I picked this up" and "someone
 * gave it to me", which is exactly the question a queue report is asked.
 */
export async function assignTicketManually(
  ctx: TenantContext,
  opts: {
    ticket: MytrionTicket;
    threadId: string;
    toZohoUserId: string;
    toName: string | null;
    actorZohoUserId: string;
    actorName: string | null;
  },
): Promise<MytrionTicket | undefined> {
  const stamped = await commsTicketStateRepo.assign(ctx, {
    ticketId: opts.ticket.id,
    zohoUserId: opts.toZohoUserId,
    name: opts.toName,
    reason: opts.toZohoUserId === opts.actorZohoUserId ? 'claimed' : 'manual',
  });
  if (!stamped) return undefined;

  await commsThreadMemberRepo.transferAssignee(ctx, opts.threadId, {
    memberKind: 'worker',
    memberKey: opts.toZohoUserId,
    memberName: opts.toName,
  });
  // The person doing the assigning joins as a watcher: they made a decision on this ticket and should see
  // what happens next without having to search for it again.
  await commsThreadMemberRepo.ensureWatcher(ctx, opts.threadId, {
    memberKind: 'worker',
    memberKey: opts.actorZohoUserId,
    memberName: opts.actorName,
  });

  await commsTicketEventRepo.append(ctx, {
    ticketId: opts.ticket.id,
    threadId: opts.threadId,
    eventType: opts.toZohoUserId === opts.actorZohoUserId ? 'claimed' : 'reassigned',
    actorZohoUserId: opts.actorZohoUserId,
    actorName: opts.actorName,
    detail: { assignee: opts.toZohoUserId, from: opts.ticket.assigneeZohoUserId },
  });

  publishSafely('comms.ticket.assigned', () => {
    const payload = {
      type: 'comms.ticket.assigned' as const,
      threadId: opts.threadId,
      ticketId: opts.ticket.id,
      number: opts.ticket.number,
      assigneeZohoUserId: opts.toZohoUserId,
      assigneeName: opts.toName,
      targetDepartment: opts.ticket.targetDepartment,
    };
    publishThreadEvent(
      { id: opts.threadId, department: opts.ticket.targetDepartment },
      [],
      payload,
      { alsoQueue: true },
    );
    if (opts.toZohoUserId !== opts.actorZohoUserId) publishUserEvent(opts.toZohoUserId, payload);
  });

  return stamped;
}
