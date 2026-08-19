import { actorZohoUserIdOf } from '../../repos/commsThreadRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { commsTicketStateRepo } from '../../repos/commsTicketStateRepo.js';
import type { CommsTicketStatus, MytrionTicket } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { publishSafely, publishThreadEvent } from './publish.js';

/**
 * Agent-driven ticket state changes — the "work a ticket" actions the queue needs (resolve, close,
 * reopen, put in progress). Split from the auto-assigner in assignment.ts: these are MANUAL
 * transitions a person makes, each under optimistic concurrency so two agents deciding at once don't
 * silently overwrite each other. Every change journals the transition and pushes a realtime frame so
 * the open conversation and the queue board both reflect it.
 */
export async function changeTicketStatus(
  ctx: TenantContext,
  ticket: MytrionTicket,
  opts: { toStatus: CommsTicketStatus; expectedVersion: number; comment?: string | null },
): Promise<MytrionTicket | null> {
  const actor = actorZohoUserIdOf(ctx);
  const updated = await commsTicketStateRepo.transitionStatus(ctx, {
    ticketId: ticket.id,
    expectedVersion: opts.expectedVersion,
    toStatus: opts.toStatus,
    actorZohoUserId: actor,
  });
  // Stale version — someone moved it first. The route turns null into a 409 rather than clobbering.
  if (!updated) return null;

  await commsTicketEventRepo.append(ctx, {
    ticketId: ticket.id,
    threadId: ticket.threadId,
    eventType: 'status_changed',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    fromStatus: ticket.status,
    toStatus: opts.toStatus,
    ...(opts.comment ? { detail: { comment: opts.comment } } : {}),
  });

  publishSafely('comms.ticket.status_changed', () => {
    publishThreadEvent(
      { id: ticket.threadId, department: ticket.targetDepartment },
      [],
      {
        type: 'comms.ticket.status_changed',
        threadId: ticket.threadId,
        ticketId: ticket.id,
        number: ticket.number,
        toStatus: opts.toStatus,
      },
      // The queue board so the row moves between Open/Resolved; the open thread updates from the list.
      { alsoQueue: true },
    );
  });

  return updated;
}
