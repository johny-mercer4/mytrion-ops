/**
 * Native tickets (/v1/comms/tickets) — the Zoho Desk replacement for the Sales Mytrion's ticket flow.
 *
 * Differences from /v1/desk that are load-bearing, not cosmetic:
 *   * The QUEUE is derived from the catalog row, not sent in the body. A client cannot choose whose
 *     queue its ticket lands in.
 *   * The client SNAPSHOT (carrier, company, application) is read off the CRM Deal the ticket is filed
 *     against, so it cannot disagree with the deal.
 *   * Reads are gated by `commsThreadReaderFilter`, the same filter the WebSocket uses. "Each user sees
 *     the tickets he created" is the participant arm; "the target queue works the inbound list" is the
 *     department arm. Neither knows anything about Sales, which is what makes this surface reusable by
 *     Customer Service, Billing and Verification unchanged.
 *   * A non-readable id answers 404, never 403 — a 403 confirms that a guessed id is real.
 *
 * Conversation lives on /v1/comms/threads (commsThreads.routes.ts): an escalation's whole ladder talks in
 * one thread, so messages are keyed on the thread and not on the ticket.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  readerOf,
  toTicketDto,
  toTicketEventDto,
} from '../../modules/comms/dto.js';
import { createClientTicket } from '../../modules/comms/ticketService.js';
import {
  changeTicketPriority,
  changeTicketStatus,
  setTicketTags,
} from '../../modules/comms/ticketActions.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import {
  commsTicketRepo,
  encodeTicketCursor,
  type ListTicketsOptions,
} from '../../repos/commsTicketRepo.js';
import { requireDepartment, requireInternal } from './helpers.js';

const TICKET_STATUSES = [
  'open',
  'in_progress',
  'pending_requester',
  'on_hold',
  'escalated',
  'resolved',
  'closed',
  'cancelled',
] as const;

const TICKET_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;

const createBody = z.object({
  /** Catalog code. Chooses the queue — there is deliberately no `department` field. */
  typeCode: z.string().min(1).max(60),
  subject: z.string().min(1).max(300),
  description: z.string().min(1).max(8000),
  /** CRM record ids are numeric strings; re-checked in fetchDealSnapshot for COQL safety. */
  dealId: z.string().regex(/^\d+$/, 'dealId must be a CRM record id').max(60),
  cardNumber: z.string().max(60).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  sourceMytrion: z.string().max(60).optional(),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

const listQuery = z.object({
  kind: z.enum(['ticket', 'request', 'escalation']).optional(),
  /** Repeatable / comma-joined. Absent means every status, which is what a history view wants. */
  status: z.string().max(200).optional(),
  department: z.string().max(60).optional(),
  assignee: z.string().max(120).optional(),
  requester: z.string().max(120).optional(),
  carrier_id: z.string().max(60).optional(),
  tag: z.string().max(40).optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  /** 'mine' narrows to tickets the caller raised; default is everything the gate allows. */
  scope: z.enum(['mine', 'all']).optional(),
});

/** Parse `status=open,in_progress` into the validated subset. Unknown values are dropped, not fatal. */
function parseStatuses(raw?: string): (typeof TICKET_STATUSES)[number][] {
  if (!raw) return [];
  const wanted = new Set(raw.split(',').map((s) => s.trim().toLowerCase()));
  return TICKET_STATUSES.filter((s) => wanted.has(s));
}

export async function commsTicketsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /**
   * File a client ticket.
   *
   * Sales-gated because filing against a Deal is a Sales act; the RECEIVING department reads the same
   * ticket through the list below with no Sales grant, via the reader filter's department arm.
   */
  app.post('/comms/tickets', guard, async (request, reply) => {
    const ctx = requireDepartment(request, 'sales', 'Comms tickets');
    const body = createBody.parse(request.body);

    const created = await createClientTicket(ctx, {
      typeCode: body.typeCode,
      subject: body.subject,
      description: body.description,
      dealId: body.dealId,
      cardNumber: body.cardNumber,
      priority: body.priority,
      sourceMytrion: body.sourceMytrion ?? 'sales',
      sourceDepartment: 'sales',
      idempotencyKey: body.idempotencyKey,
    });

    await auditFromContext(ctx, {
      action: 'comms.ticket.create',
      status: 'ok',
      resourceType: 'comms_ticket',
      resourceId: created.ticket.id,
      detail: {
        number: created.ticket.number,
        typeCode: created.ticket.ticketTypeCode,
        targetDepartment: created.ticket.targetDepartment,
        dealId: created.ticket.crmDealId,
        carrierId: created.ticket.carrierId,
        // Never the full card — cardLast4 is the most that may be recorded.
        cardLast4: created.ticket.cardLast4,
        replay: !created.created,
      },
    });

    // 200 rather than 201 on an idempotent replay: nothing was created this time.
    return reply.code(created.created ? 201 : 200).send({
      ticket: toTicketDto(
        { ticket: created.ticket, thread: created.thread, readSeq: created.message.seq },
        readerOf(ctx),
      ),
      created: created.created,
    });
  });

  /**
   * The caller's readable tickets, newest first, keyset-paged.
   *
   * Internal-only with NO department requirement: the reader filter already decides what is visible, and
   * requiring a specific department here would either lock the receiving queue out of its own inbound
   * list or force one route per Mytrion.
   */
  app.get('/comms/tickets', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms tickets');
    const q = listQuery.parse(request.query);

    const opts: ListTicketsOptions = {};
    if (q.kind) opts.kind = q.kind;
    const statuses = parseStatuses(q.status);
    if (statuses.length > 0) opts.status = statuses;
    if (q.department) opts.targetDepartment = q.department;
    if (q.assignee) opts.assigneeZohoUserId = q.assignee;
    if (q.carrier_id) opts.carrierId = q.carrier_id;
    if (q.tag) opts.tag = q.tag;
    if (q.q) opts.search = q.q;
    if (q.cursor) opts.cursor = q.cursor;
    if (q.limit) opts.limit = q.limit;

    // `scope=mine` is a NARROWING convenience over the gate, never a widening one: it can only filter
    // down to rows the reader filter already allows.
    const reader = readerOf(ctx);
    if (q.requester) {
      opts.requesterZohoUserId = q.requester;
    } else if (q.scope === 'mine' && reader.actorZohoUserId) {
      opts.requesterZohoUserId = reader.actorZohoUserId;
    }

    const rows = await commsTicketRepo.list(ctx, opts);
    const limit = q.limit ?? 25;
    const last = rows[rows.length - 1];

    return {
      tickets: rows.map((row) => toTicketDto(row, reader)),
      // hasMore is "the page came back full", which can be one request early at an exact boundary. The
      // alternative — fetching limit+1 and discarding a row — costs a row on every page to avoid one
      // empty fetch at the end.
      hasMore: rows.length >= limit,
      nextCursor: rows.length >= limit && last ? encodeTicketCursor(last.ticket) : null,
    };
  });

  /** One ticket. 404 when the gate does not allow it, so a probe cannot confirm the id exists. */
  app.get('/comms/tickets/:id', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms tickets');
    const { id } = request.params as { id: string };
    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');
    return { ticket: toTicketDto(row, readerOf(ctx)) };
  });

  /** The append-only activity trail: assignments, transitions, escalation hops, with reasons. */
  app.get('/comms/tickets/:id/events', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms tickets');
    const { id } = request.params as { id: string };
    // Authorize via the ticket read, not the event table — the journal has no gate of its own.
    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');
    const events = await commsTicketEventRepo.listByTicket(ctx, id);
    return { events: events.map(toTicketEventDto) };
  });

  /**
   * Move a ticket's status — the agent action (resolve / close / reopen / put in progress). Gated by
   * the same reader filter as the read (a non-readable id 404s), carries `expectedVersion` so a stale
   * decision 409s instead of overwriting, and journals + broadcasts the transition.
   */
  app.post('/comms/tickets/:id/status', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms tickets');
    const { id } = request.params as { id: string };
    const body = z
      .object({
        toStatus: z.enum(TICKET_STATUSES),
        expectedVersion: z.number().int().min(1),
        comment: z.string().max(4000).optional(),
      })
      .parse(request.body);
    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');
    const updated = await changeTicketStatus(ctx, row.ticket, {
      toStatus: body.toStatus,
      expectedVersion: body.expectedVersion,
      comment: body.comment ?? null,
    });
    if (!updated) {
      throw new AppError('This ticket changed since you loaded it — reload and try again.', {
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        expose: true,
      });
    }
    await auditFromContext(ctx, {
      action: 'comms.ticket.status',
      status: 'ok',
      resourceType: 'comms_ticket',
      resourceId: id,
      detail: { from: row.ticket.status, to: body.toStatus },
    });
    const fresh = await commsTicketRepo.getForReader(ctx, id);
    return { ticket: toTicketDto(fresh ?? row, readerOf(ctx)) };
  });

  /**
   * Re-prioritise a ticket. Same gate, version contract and 409 semantics as the status route: a
   * non-readable id 404s, a stale `expectedVersion` 409s, and the change is journalled + broadcast so the
   * queue board re-sorts for everyone watching.
   */
  app.post('/comms/tickets/:id/priority', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms tickets');
    const { id } = request.params as { id: string };
    const body = z
      .object({
        toPriority: z.enum(TICKET_PRIORITIES),
        expectedVersion: z.number().int().min(1),
      })
      .parse(request.body);
    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');
    const updated = await changeTicketPriority(ctx, row.ticket, {
      toPriority: body.toPriority,
      expectedVersion: body.expectedVersion,
    });
    if (!updated) {
      throw new AppError('This ticket changed since you loaded it — reload and try again.', {
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        expose: true,
      });
    }
    await auditFromContext(ctx, {
      action: 'comms.ticket.priority',
      status: 'ok',
      resourceType: 'comms_ticket',
      resourceId: id,
      detail: { from: row.ticket.priority, to: body.toPriority },
    });
    const fresh = await commsTicketRepo.getForReader(ctx, id);
    return { ticket: toTicketDto(fresh ?? row, readerOf(ctx)) };
  });

  /**
   * Replace a ticket's tags. Same reader gate (a non-readable id 404s). Not version-gated — tags are
   * low-contention triage labels — and the server normalises the set (trim / dedupe / cap) before it
   * lands, so the client cannot store an unbounded or dirty set.
   */
  app.post('/comms/tickets/:id/tags', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms tickets');
    const { id } = request.params as { id: string };
    const body = z
      .object({ tags: z.array(z.string().max(60)).max(50) })
      .parse(request.body);
    const row = await commsTicketRepo.getForReader(ctx, id);
    if (!row) throw new NotFoundError('Ticket not found.');
    const updated = await setTicketTags(ctx, row.ticket, body.tags);
    if (!updated) throw new NotFoundError('Ticket not found.');
    await auditFromContext(ctx, {
      action: 'comms.ticket.tags',
      status: 'ok',
      resourceType: 'comms_ticket',
      resourceId: id,
      detail: { count: updated.tags.length },
    });
    const fresh = await commsTicketRepo.getForReader(ctx, id);
    return { ticket: toTicketDto(fresh ?? row, readerOf(ctx)) };
  });
}
