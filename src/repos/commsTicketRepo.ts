import { createId } from '@paralleldrive/cuid2';
import { and, desc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionThreadMembers,
  mytrionThreadMessages,
  mytrionThreads,
  mytrionTickets,
  type CommsRequesterKind,
  type CommsThreadVisibility,
  type CommsTicketChannel,
  type CommsTicketKind,
  type CommsTicketPriority,
  type CommsTicketSource,
  type CommsTicketStatus,
  type MytrionThread,
  type MytrionThreadMember,
  type MytrionThreadMessage,
  type MytrionTicket,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { ConflictError } from '../lib/errors.js';
import { allocateTicketNumber } from '../modules/comms/ticketNumber.js';
import { actorZohoUserIdOf, commsThreadReaderFilter } from './commsThreadRepo.js';
import { encodeKeysetCursor, decodeKeysetCursor } from './keysetCursor.js';
import { firstOrThrow, isUniqueViolation } from './util.js';

/**
 * Tickets, requests and escalations — the row that hangs off a thread.
 *
 * Reads go through `commsThreadReaderFilter` via a join on the thread, never through a filter of their
 * own. That is the point of putting the gate on threads: a ticket and its conversation cannot disagree
 * about who may see them, and adding a ticket-shaped filter here would be a second implementation to
 * keep in sync.
 */

const PREVIEW_CHARS = 160;

export interface CreateTicketInput {
  kind: CommsTicketKind;

  /** Catalog snapshot — copied so a later rename or retirement cannot rewrite history. */
  ticketTypeId?: string | null;
  ticketTypeCode?: string | null;
  ticketTypeLabel?: string | null;

  /** The queue. Server-derived from the catalog row; never accepted from a request body. */
  targetDepartment: string | null;
  sourceDepartment?: string | null;
  sourceMytrion?: string | null;

  priority: CommsTicketPriority;

  requesterKind: CommsRequesterKind;
  requesterZohoUserId?: string | null;
  requesterCarrierId?: string | null;
  requesterName: string;

  /** Client linkage: carrier_id + company_name and nothing else. Absent on an escalation. */
  carrierId?: string | null;
  companyName?: string | null;
  applicationId?: string | null;
  crmDealId?: string | null;
  cardNumber?: string | null;
  cardLast4?: string | null;

  channel?: CommsTicketChannel;
  source?: CommsTicketSource;

  slaHours?: number | null;
  dueAt?: Date | null;
  firstResponseDueAt?: Date | null;

  idempotencyKey?: string | null;
  createdByZohoUserId?: string | null;

  /** Thread side. */
  subject: string;
  visibility: CommsThreadVisibility;
  threadDepartment: string | null;
  /** The opening message — becomes seq 1. */
  body: string;
  bodyFormat?: 'text' | 'markdown';
}

export interface CreatedTicket {
  ticket: MytrionTicket;
  thread: MytrionThread;
  members: MytrionThreadMember[];
  message: MytrionThreadMessage;
  /** False when an idempotency key matched an existing row and nothing was written. */
  created: boolean;
}

export interface ListTicketsOptions {
  kind?: CommsTicketKind;
  status?: CommsTicketStatus[];
  targetDepartment?: string;
  assigneeZohoUserId?: string;
  requesterZohoUserId?: string;
  carrierId?: string;
  /** Free text over number, subject, company and type label. */
  search?: string;
  /** Opaque keyset cursor from a previous page. */
  cursor?: string;
  limit?: number;
}

/** A ticket joined to its thread — what every list and detail read returns. */
export interface TicketWithThread {
  ticket: MytrionTicket;
  thread: MytrionThread;
  /**
   * The reading worker's own read watermark, or null when they hold no member row (a department-queue
   * thread they have not opened yet). Carried on the row so an unread badge is arithmetic on data the
   * list already fetched, rather than a second round trip per ticket.
   */
  readSeq: number | null;
}

/**
 * LEFT JOIN condition for the reader's own member row.
 *
 * A left join, not an inner one: a CS agent must see an inbound queue ticket they have never opened, and
 * an inner join would hide exactly those. The `false` branch keeps the shape identical for a caller with
 * no worker identity instead of dropping the column and forking every consumer.
 */
function readerMemberOn(ctx: TenantContext): SQL {
  const actor = actorZohoUserIdOf(ctx);
  if (!actor) return sql`false`;
  const cond = and(
    eq(mytrionThreadMembers.tenantId, mytrionThreads.tenantId),
    eq(mytrionThreadMembers.threadId, mytrionThreads.id),
    eq(mytrionThreadMembers.memberKind, 'worker'),
    eq(mytrionThreadMembers.memberKey, actor),
  );
  // `and()` is typed SQL | undefined; every arm above is defined, so this cannot actually be undefined.
  return cond ?? sql`false`;
}

/**
 * The shape EVERY ticket read shares: ticket ⋈ thread, plus the reader's own member row.
 *
 * Factored out rather than repeated across list / find / find-by-thread because these joins ARE the
 * authorization surface — the thread join is what lets `commsThreadReaderFilter` apply at all. Three
 * copies would be three chances for one of them to drift and quietly read unfiltered.
 */
function selectTicketWithThread(ctx: TenantContext) {
  return db
    .select({
      ticket: mytrionTickets,
      thread: mytrionThreads,
      readSeq: mytrionThreadMembers.lastReadSeq,
    })
    .from(mytrionTickets)
    .innerJoin(
      mytrionThreads,
      and(
        eq(mytrionThreads.tenantId, mytrionTickets.tenantId),
        eq(mytrionThreads.id, mytrionTickets.threadId),
      ),
    )
    .leftJoin(mytrionThreadMembers, readerMemberOn(ctx));
}

/** Page boundary for the ticket list. The encoding itself lives in repos/keysetCursor.ts. */
export const encodeTicketCursor = encodeKeysetCursor;

export const commsTicketRepo = {
  /**
   * Create the whole unit — thread, requester member, ticket, opening message, journal row — in ONE
   * transaction.
   *
   * All five ids are generated up front rather than read back, so the thread can be inserted with its
   * final message counters already set. That removes the read-then-write round trip a first message
   * would otherwise need, and it is why `commsMessageRepo.append` is NOT reused here: `append` opens its
   * own `db.transaction`, which would take a second pool connection and block on the very thread row
   * this transaction holds — a self-deadlock, not a slow path.
   */
  async createWithThread(ctx: TenantContext, input: CreateTicketInput): Promise<CreatedTicket> {
    const source = input.source ?? 'worker';

    // Replay check before doing any work. The unique index is partial (`WHERE idempotency_key IS NOT
    // NULL`), and Postgres will not accept a partial index as an ON CONFLICT arbiter unless the
    // statement restates the predicate — which Drizzle cannot express. Select-then-insert with a
    // unique-violation catch below is therefore both simpler and the only correct option.
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(ctx, source, input.idempotencyKey, {
        requesterZohoUserId: input.requesterZohoUserId ?? null,
        requesterCarrierId: input.requesterCarrierId ?? null,
      });
      if (existing) return { ...existing, created: false };
    }

    try {
      return await this.insertUnit(ctx, input, source);
    } catch (err) {
      if (input.idempotencyKey && isUniqueViolation(err)) {
        // Lost the race with a concurrent replay of the same key: the other request's row is the answer.
        const existing = await this.findByIdempotencyKey(ctx, source, input.idempotencyKey, {
          requesterZohoUserId: input.requesterZohoUserId ?? null,
          requesterCarrierId: input.requesterCarrierId ?? null,
        });
        if (existing) return { ...existing, created: false };
        // The key is taken, but not by this requester, so its row must not be returned. A 409 with a
        // clear message beats the raw 23505 that would otherwise surface as an opaque 500.
        throw new ConflictError(
          'That idempotency key has already been used by another request. Use a fresh key.',
        );
      }
      throw err;
    }
  },

  /** The write half of `createWithThread`, split out to keep the replay handling readable. */
  async insertUnit(
    ctx: TenantContext,
    input: CreateTicketInput,
    source: CommsTicketSource,
  ): Promise<CreatedTicket> {
    const threadId = `mth_${createId()}`;
    const messageId = `mtm_${createId()}`;
    const now = new Date();
    const preview = input.body.slice(0, PREVIEW_CHARS);
    const isWorker = input.requesterKind === 'worker';

    return db.transaction(async (tx) => {
      const number = await allocateTicketNumber(tx, input.kind);

      const threadRows = await tx
        .insert(mytrionThreads)
        .values({
          id: threadId,
          tenantId: ctx.tenantId,
          kind: input.kind,
          visibility: input.visibility,
          department: input.threadDepartment,
          subject: input.subject,
          state: 'open',
          // Set to the final post-first-message state up front — see the method comment.
          messageCount: 1,
          lastMessageAt: now,
          lastMessageId: messageId,
          lastMessageSeq: 1,
          lastMessagePreview: preview,
          lastMessageAuthorZohoUserId: input.requesterZohoUserId ?? null,
          createdByZohoUserId: input.createdByZohoUserId ?? input.requesterZohoUserId ?? 'system',
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const thread = firstOrThrow(threadRows, 'comms thread insert returned no row');

      const messageRows = await tx
        .insert(mytrionThreadMessages)
        .values({
          id: messageId,
          tenantId: ctx.tenantId,
          threadId,
          threadKind: input.kind,
          seq: 1,
          kind: 'message',
          body: input.body,
          bodyFormat: input.bodyFormat ?? 'text',
          authorKind: input.requesterKind,
          authorZohoUserId: input.requesterZohoUserId ?? null,
          authorCarrierId: input.requesterCarrierId ?? null,
          authorName: input.requesterName,
          isInternal: false,
          createdAt: now,
        })
        .returning();
      const message = firstOrThrow(messageRows, 'comms message insert returned no row');

      // The requester's own read watermark starts AT their message: nobody's own ticket should show up
      // unread to them the instant they file it.
      const memberRows = await tx
        .insert(mytrionThreadMembers)
        .values({
          tenantId: ctx.tenantId,
          threadId,
          memberKind: input.requesterKind,
          memberKey: isWorker ? (input.requesterZohoUserId ?? '') : (input.requesterCarrierId ?? ''),
          memberName: input.requesterName,
          role: 'requester',
          notify: 'all',
          lastReadSeq: 1,
          lastReadAt: now,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      const ticketRows = await tx
        .insert(mytrionTickets)
        .values({
          tenantId: ctx.tenantId,
          threadId,
          number,
          kind: input.kind,
          ticketTypeId: input.ticketTypeId ?? null,
          ticketTypeCode: input.ticketTypeCode ?? null,
          ticketTypeLabel: input.ticketTypeLabel ?? null,
          targetDepartment: input.targetDepartment,
          sourceDepartment: input.sourceDepartment ?? null,
          sourceMytrion: input.sourceMytrion ?? null,
          priority: input.priority,
          status: 'open',
          requesterKind: input.requesterKind,
          requesterZohoUserId: input.requesterZohoUserId ?? null,
          requesterCarrierId: input.requesterCarrierId ?? null,
          requesterName: input.requesterName,
          carrierId: input.carrierId ?? null,
          companyName: input.companyName ?? null,
          applicationId: input.applicationId ?? null,
          crmDealId: input.crmDealId ?? null,
          cardNumber: input.cardNumber ?? null,
          cardLast4: input.cardLast4 ?? null,
          channel: input.channel ?? 'web',
          source,
          slaHours: input.slaHours ?? null,
          dueAt: input.dueAt ?? null,
          firstResponseDueAt: input.firstResponseDueAt ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdByZohoUserId: input.createdByZohoUserId ?? input.requesterZohoUserId ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const ticket = firstOrThrow(ticketRows, 'comms ticket insert returned no row');

      return { ticket, thread, members: memberRows, message, created: true };
    });
  },

  /**
   * Replay lookup: has this exact create already happened?
   *
   * Scoped three ways, and each one matters:
   *   * `source`, matching the unique index — a mini-app key and a webhook key are separate spaces.
   *   * the key itself.
   *   * THE REQUESTER. This runs before the reader filter exists (there is no row yet), so without the
   *     requester bound, an agent who guessed or replayed someone else's idempotency key would be handed
   *     that person's ticket — thread, client snapshot and opening message included. The key is a
   *     client-chosen string, so it is not a secret and cannot be the only thing standing between two
   *     users. Binding the requester makes the lookup answer only "did *I* already file this?".
   */
  async findByIdempotencyKey(
    ctx: TenantContext,
    source: CommsTicketSource,
    key: string,
    requester: { requesterZohoUserId: string | null; requesterCarrierId: string | null },
  ): Promise<Omit<CreatedTicket, 'created'> | undefined> {
    const requesterArm = requester.requesterZohoUserId
      ? eq(mytrionTickets.requesterZohoUserId, requester.requesterZohoUserId)
      : requester.requesterCarrierId
        ? eq(mytrionTickets.requesterCarrierId, requester.requesterCarrierId)
        : // No requester identity means no way to prove ownership of the key, so refuse to match at all
          // rather than fall back to key-only — which is precisely the leak this arm exists to close.
          sql`false`;

    const [row] = await db
      .select({ ticket: mytrionTickets, thread: mytrionThreads })
      .from(mytrionTickets)
      .innerJoin(
        mytrionThreads,
        and(
          eq(mytrionThreads.tenantId, mytrionTickets.tenantId),
          eq(mytrionThreads.id, mytrionTickets.threadId),
        ),
      )
      .where(
        and(
          eq(mytrionTickets.tenantId, ctx.tenantId),
          eq(mytrionTickets.source, source),
          eq(mytrionTickets.idempotencyKey, key),
          requesterArm,
        ),
      )
      .limit(1);
    if (!row) return undefined;

    const [members, messages] = await Promise.all([
      db
        .select()
        .from(mytrionThreadMembers)
        .where(
          and(
            eq(mytrionThreadMembers.tenantId, ctx.tenantId),
            eq(mytrionThreadMembers.threadId, row.thread.id),
          ),
        ),
      db
        .select()
        .from(mytrionThreadMessages)
        .where(
          and(
            eq(mytrionThreadMessages.tenantId, ctx.tenantId),
            eq(mytrionThreadMessages.threadId, row.thread.id),
            eq(mytrionThreadMessages.seq, 1),
          ),
        )
        .limit(1),
    ]);
    const message = messages[0];
    if (!message) return undefined;
    return { ticket: row.ticket, thread: row.thread, members, message };
  },

  /**
   * Split from `list` so the RBAC-leakage suite can assert on `.toSQL()` with no database — the same
   * discipline as every other comms read.
   */
  buildListQuery(ctx: TenantContext, opts: ListTicketsOptions = {}) {
    const where: (SQL | undefined)[] = [
      eq(mytrionTickets.tenantId, ctx.tenantId),
      // THE gate. Lives on the thread so REST, the socket and this list cannot diverge.
      commsThreadReaderFilter(ctx),
    ];

    if (opts.kind) where.push(eq(mytrionTickets.kind, opts.kind));
    if (opts.status && opts.status.length > 0) {
      where.push(inArray(mytrionTickets.status, opts.status));
    }
    if (opts.targetDepartment) {
      where.push(eq(mytrionTickets.targetDepartment, opts.targetDepartment));
    }
    if (opts.assigneeZohoUserId) {
      where.push(eq(mytrionTickets.assigneeZohoUserId, opts.assigneeZohoUserId));
    }
    if (opts.requesterZohoUserId) {
      where.push(eq(mytrionTickets.requesterZohoUserId, opts.requesterZohoUserId));
    }
    if (opts.carrierId) where.push(eq(mytrionTickets.carrierId, opts.carrierId));

    const search = opts.search?.trim();
    if (search) {
      // Server-side because the client only holds the current page — searching in the browser silently
      // means "search the 20 tickets you happen to have loaded".
      const like = `%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
      where.push(
        or(
          sql`${mytrionTickets.number} ILIKE ${like}`,
          sql`${mytrionThreads.subject} ILIKE ${like}`,
          sql`${mytrionTickets.companyName} ILIKE ${like}`,
          sql`${mytrionTickets.ticketTypeLabel} ILIKE ${like}`,
        ),
      );
    }

    const cursor = opts.cursor ? decodeKeysetCursor(opts.cursor) : null;
    if (cursor) {
      // Row comparison, not `created_at < x OR (created_at = x AND id < y)` — same semantics, and it
      // matches the composite ORDER BY so the planner can walk the index.
      where.push(
        sql`(${mytrionTickets.createdAt}, ${mytrionTickets.id}) < (${cursor.at}::timestamptz, ${cursor.id})`,
      );
    }

    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

    return selectTicketWithThread(ctx)
      .where(and(...where))
      .orderBy(desc(mytrionTickets.createdAt), desc(mytrionTickets.id))
      .limit(limit);
  },

  async list(ctx: TenantContext, opts: ListTicketsOptions = {}): Promise<TicketWithThread[]> {
    return this.buildListQuery(ctx, opts);
  },

  buildFindQuery(ctx: TenantContext, ticketId: string) {
    return selectTicketWithThread(ctx)
      .where(
        and(
          eq(mytrionTickets.tenantId, ctx.tenantId),
          eq(mytrionTickets.id, ticketId),
          commsThreadReaderFilter(ctx),
        ),
      )
      .limit(1);
  },

  /**
   * One ticket the caller may read, or undefined.
   *
   * Undefined rather than a throw so the route answers 404: a 403 would confirm that a guessed id is
   * real. Better IDOR hygiene than the Desk path's `assertTicketOwned`, which answers 403.
   */
  async getForReader(ctx: TenantContext, ticketId: string): Promise<TicketWithThread | undefined> {
    const [row] = await this.buildFindQuery(ctx, ticketId);
    return row;
  },

  /** Same gate, keyed by thread — for the chat surface, which knows the thread and not the ticket. */
  async getByThreadForReader(
    ctx: TenantContext,
    threadId: string,
  ): Promise<TicketWithThread | undefined> {
    const [row] = await selectTicketWithThread(ctx)
      .where(
        and(
          eq(mytrionTickets.tenantId, ctx.tenantId),
          eq(mytrionTickets.threadId, threadId),
          commsThreadReaderFilter(ctx),
        ),
      )
      .limit(1);
    return row;
  },

  /**
   * Move a ticket's status under optimistic concurrency.
   *
   * Returns undefined when `expectedVersion` no longer matches, which the route turns into a 409. The
   * alternative — last write wins — silently discards the other actor's decision, and "who closed my
   * escalated ticket?" is exactly the question a support system must be able to answer.
   */
  async transitionStatus(
    ctx: TenantContext,
    opts: {
      ticketId: string;
      expectedVersion: number;
      toStatus: CommsTicketStatus;
      substatus?: string | null;
      closeReason?: string | null;
      actorZohoUserId?: string | null;
    },
  ): Promise<MytrionTicket | undefined> {
    const now = new Date();
    const patch: Partial<typeof mytrionTickets.$inferInsert> = {
      status: opts.toStatus,
      version: opts.expectedVersion + 1,
      updatedAt: now,
    };
    if (opts.substatus !== undefined) patch.substatus = opts.substatus;
    if (opts.closeReason !== undefined) patch.closeReason = opts.closeReason;

    // Terminal timestamps are stamped here rather than by the caller so every path that reaches a
    // status agrees on what that status means for the SLA sweeper's partial index.
    if (opts.toStatus === 'resolved') {
      patch.resolvedAt = now;
      patch.resolvedByZohoUserId = opts.actorZohoUserId ?? null;
    }
    if (opts.toStatus === 'closed') patch.closedAt = now;
    if (opts.toStatus === 'cancelled') patch.cancelledAt = now;
    if (opts.toStatus === 'open') patch.reopenedAt = now;

    const rows = await db
      .update(mytrionTickets)
      .set(patch)
      .where(
        and(
          eq(mytrionTickets.tenantId, ctx.tenantId),
          eq(mytrionTickets.id, opts.ticketId),
          eq(mytrionTickets.version, opts.expectedVersion),
        ),
      )
      .returning();
    return rows[0];
  },

  /**
   * Stamp the first response, once.
   *
   * The `IS NULL` guard is in the WHERE, not in a prior read: two agents replying at the same instant
   * would both see NULL and the second would overwrite the first with a later time, which is precisely
   * the metric being measured.
   */
  async stampFirstResponse(ctx: TenantContext, ticketId: string, at: Date): Promise<void> {
    await db
      .update(mytrionTickets)
      .set({ firstResponseAt: at, updatedAt: at })
      .where(
        and(
          eq(mytrionTickets.tenantId, ctx.tenantId),
          eq(mytrionTickets.id, ticketId),
          sql`${mytrionTickets.firstResponseAt} IS NULL`,
        ),
      );
  },
};
