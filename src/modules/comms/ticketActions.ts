import { actorZohoUserIdOf } from '../../repos/commsThreadRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { commsTicketStateRepo } from '../../repos/commsTicketStateRepo.js';
import type {
  CommsTicketPriority,
  CommsTicketStatus,
  MytrionTicket,
} from '../../db/schema/index.js';
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

/**
 * Change a ticket's priority.
 *
 * A sibling to `changeTicketStatus`: same optimistic-concurrency contract (null on a stale version → 409),
 * same journal-then-publish shape, so a re-prioritisation is auditable and the queue board re-sorts live.
 */
export async function changeTicketPriority(
  ctx: TenantContext,
  ticket: MytrionTicket,
  opts: { toPriority: CommsTicketPriority; expectedVersion: number },
): Promise<MytrionTicket | null> {
  const actor = actorZohoUserIdOf(ctx);
  const updated = await commsTicketStateRepo.setPriority(ctx, {
    ticketId: ticket.id,
    expectedVersion: opts.expectedVersion,
    toPriority: opts.toPriority,
  });
  // Stale version — someone changed it first. The route turns null into a 409 rather than clobbering.
  if (!updated) return null;

  await commsTicketEventRepo.append(ctx, {
    ticketId: ticket.id,
    threadId: ticket.threadId,
    eventType: 'priority_changed',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    detail: { from: ticket.priority, to: opts.toPriority },
  });

  publishSafely('comms.ticket.priority_changed', () => {
    publishThreadEvent(
      { id: ticket.threadId, department: ticket.targetDepartment },
      [],
      {
        type: 'comms.ticket.priority_changed',
        threadId: ticket.threadId,
        ticketId: ticket.id,
        number: ticket.number,
        toPriority: opts.toPriority,
      },
      { alsoQueue: true },
    );
  });

  return updated;
}

/**
 * Normalise a tag set: trim, drop blanks, collapse whitespace, cap each label's length, dedupe
 * case-insensitively (keeping the first spelling), and cap the count. Client input is not trusted to be
 * clean, and an unbounded/duplicated set would bloat both the row and the queue board.
 */
export function normalizeTags(raw: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const clean = t.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 20) break;
  }
  return out;
}

/**
 * Replace a ticket's tags. Journals the new set and broadcasts so the queue board re-renders the chips
 * live. Returns null only if the ticket vanished between the caller's read and here.
 */
export async function setTicketTags(
  ctx: TenantContext,
  ticket: MytrionTicket,
  rawTags: string[],
): Promise<MytrionTicket | null> {
  const actor = actorZohoUserIdOf(ctx);
  const tags = normalizeTags(rawTags);
  const updated = await commsTicketStateRepo.setTags(ctx, ticket.id, tags);
  if (!updated) return null;

  await commsTicketEventRepo.append(ctx, {
    ticketId: ticket.id,
    threadId: ticket.threadId,
    eventType: 'tagged',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    detail: { tags },
  });

  publishSafely('comms.ticket.tagged', () => {
    publishThreadEvent(
      { id: ticket.threadId, department: ticket.targetDepartment },
      [],
      {
        type: 'comms.ticket.tagged',
        threadId: ticket.threadId,
        ticketId: ticket.id,
        number: ticket.number,
        tags,
      },
      { alsoQueue: true },
    );
  });

  return updated;
}
