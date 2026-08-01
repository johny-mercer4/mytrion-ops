/**
 * Queue operations (/v1/comms/queue) — claim, reassign, hand back.
 *
 * Auto-assignment on create is the normal path; this is what a team does around it. Every route resolves the
 * ticket through `commsTicketRepo.getForReader` FIRST, so the department reader arm is the gate: you can only
 * act on a ticket you can already see, and an unreadable id answers 404 rather than confirming it exists.
 *
 * Deliberately NOT gated on one department name. A CS agent holds `customer-service`, a Billing agent holds
 * `billing`, and hardcoding either would need one route per Mytrion — the reader filter already encodes
 * exactly the right answer for both.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConflictError, NotFoundError, RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { assignTicketManually } from '../../modules/comms/assignment.js';
import { readerOf, toTicketDto } from '../../modules/comms/dto.js';
import { commsDepartmentRepo } from '../../repos/commsDepartmentRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { commsTicketRepo } from '../../repos/commsTicketRepo.js';
import { commsTicketStateRepo } from '../../repos/commsTicketStateRepo.js';
import { hrEmployeeRepo } from '../../repos/hrEmployeeRepo.js';
import { requireInternal } from './helpers.js';

const assignBody = z.object({
  /** Omit to claim it for yourself. */
  toZohoUserId: z.string().regex(/^\d+$/, 'must be a Zoho user id').max(60).optional(),
});

/** Display name for an assignment target, best-effort from HR. */
async function nameFor(
  ctx: Parameters<typeof hrEmployeeRepo.findByZohoUserId>[0],
  zohoUserId: string,
  fallback: string | null,
): Promise<string | null> {
  if (fallback) return fallback;
  const row = await hrEmployeeRepo.findByZohoUserId(ctx, zohoUserId).catch(() => undefined);
  if (!row) return null;
  const full = [row.firstName, row.lastName].filter((p) => p && p.trim()).join(' ').trim();
  return full.length > 0 ? full : null;
}

export async function commsQueueRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * Claim a ticket, or assign it to a colleague.
   *
   * Claiming is the common case and needs no body. Assigning to someone ELSE requires them to hold a seat on
   * that department's roster: "assign to Nodira" must not become "assign to anyone whose id I can type",
   * and the roster is the same list the round-robin draws from, so the two cannot disagree about who works
   * the queue.
   */
  app.post('/comms/queue/:id/assign', guard, async (request) => {
    const ctx = requireInternal(request, 'Ticket queue');
    const { id } = request.params as { id: string };
    const body = assignBody.parse(request.body ?? {});

    const reader = readerOf(ctx);
    if (!reader.actorZohoUserId) throw new RBACError('Claiming requires a signed-in worker identity.');

    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');
    if (row.ticket.kind === 'escalation') {
      // An escalation moves along its ladder, not by queue claim — otherwise the hop chain and the assignee
      // would disagree about who holds it.
      throw new ValidationError('Escalations move through the escalation actions, not the queue.');
    }

    const target = body.toZohoUserId ?? reader.actorZohoUserId;
    const isSelf = target === reader.actorZohoUserId;

    let targetName: string | null = null;
    if (!isSelf) {
      const department = row.ticket.targetDepartment;
      if (!department) throw new ValidationError('This ticket has no department to assign within.');
      const seat = await commsDepartmentRepo.getPoolMember(ctx, department, target);
      if (!seat || !seat.active) {
        throw new ValidationError(
          `That person is not on the ${department} roster. Add them in Mytrion Admin first.`,
        );
      }
      targetName = seat.displayName;
    }

    const assigned = await assignTicketManually(ctx, {
      ticket: row.ticket,
      threadId: row.ticket.threadId,
      toZohoUserId: target,
      toName: await nameFor(ctx, target, targetName ?? (isSelf ? (ctx.userName ?? null) : null)),
      actorZohoUserId: reader.actorZohoUserId,
      actorName: ctx.userName ?? null,
    });
    if (!assigned) {
      // The `IS NULL OR = me` predicate refused it: somebody else claimed it in the meantime.
      throw new ConflictError('Somebody else already took this ticket. Reload to see who.');
    }

    await auditFromContext(ctx, {
      action: isSelf ? 'comms.ticket.claim' : 'comms.ticket.assign',
      status: 'ok',
      resourceType: 'comms_ticket',
      resourceId: id,
      detail: { number: row.ticket.number, to: target, from: row.ticket.assigneeZohoUserId },
    });

    return { ticket: toTicketDto({ ...row, ticket: assigned }, reader) };
  });

  /**
   * Hand a ticket back to the queue.
   *
   * Only the current holder (or an admin) may do it: releasing someone else's work is how a ticket silently
   * loses its owner mid-conversation. It does NOT re-run the round-robin — the point is to make it available
   * to whoever is actually free, and re-assigning immediately would often hand it straight back.
   */
  app.post('/comms/queue/:id/release', guard, async (request) => {
    const ctx = requireInternal(request, 'Ticket queue');
    const { id } = request.params as { id: string };
    const reader = readerOf(ctx);
    if (!reader.actorZohoUserId) throw new RBACError('Releasing requires a signed-in worker identity.');

    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');

    const blanket = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
    if (!blanket && row.ticket.assigneeZohoUserId !== reader.actorZohoUserId) {
      throw new RBACError('Only the person this ticket is assigned to can hand it back.');
    }
    if (!row.ticket.assigneeZohoUserId) {
      throw new ValidationError('This ticket is already in the queue.');
    }

    const released = await commsTicketStateRepo.unassign(ctx, id);
    if (!released) throw new NotFoundError('Ticket not found.');

    await commsTicketEventRepo.append(ctx, {
      ticketId: id,
      threadId: row.ticket.threadId,
      eventType: 'unassigned',
      actorZohoUserId: reader.actorZohoUserId,
      actorName: ctx.userName ?? null,
      detail: { from: row.ticket.assigneeZohoUserId },
    });

    await auditFromContext(ctx, {
      action: 'comms.ticket.release',
      status: 'ok',
      resourceType: 'comms_ticket',
      resourceId: id,
      detail: { number: row.ticket.number, from: row.ticket.assigneeZohoUserId },
    });

    return { ticket: toTicketDto({ ...row, ticket: released }, reader) };
  });

  /**
   * The roster a queue is drawing from, with each member's current open load.
   *
   * Read-only and visible to anyone who can see the department's tickets, not just admins: "why did this go
   * to her and not me" is a fair question for an agent to answer without filing a request.
   */
  app.get('/comms/queue/:department/roster', guard, async (request) => {
    const ctx = requireInternal(request, 'Ticket queue');
    const department = z
      .string()
      .min(2)
      .max(40)
      .regex(/^[a-z][a-z0-9-]*$/)
      .parse((request.params as { department: string }).department);

    const blanket = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
    if (!blanket && !ctx.departments.includes(department)) {
      throw new RBACError(`You do not have access to the ${department} queue.`);
    }

    const [config, roster] = await Promise.all([
      commsDepartmentRepo.get(ctx, department),
      commsDepartmentRepo.listPool(ctx, { departments: [department] }),
    ]);

    return {
      department,
      strategy: config?.ticketAssignmentStrategy ?? 'round_robin',
      requireOnline: config?.requireOnline ?? false,
      roster: roster.map((r) => ({
        zohoUserId: r.zohoUserId,
        name: r.displayName,
        roleTitle: r.roleTitle,
        active: r.active,
        acceptsNew: r.acceptsNew,
        maxOpen: r.maxOpen,
        sortOrder: r.sortOrder,
        // The rotation cursor, in plain sight: least-recently-assigned goes next.
        lastAssignedAt: r.lastAssignedAt?.toISOString() ?? null,
        assignedCount: r.assignedCount,
      })),
    };
  });
}
