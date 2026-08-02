import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionThreadMembers,
  mytrionThreadMessages,
  mytrionThreads,
  type CommsMessageAuthorKind,
  type CommsMessageKind,
  type MytrionThreadMessage,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

/** How far into a message body the thread-list preview reaches. */
const PREVIEW_CHARS = 160;

export interface AppendMessageInput {
  threadId: string;
  body: string;
  kind?: CommsMessageKind;
  bodyFormat?: 'text' | 'markdown';
  authorKind: CommsMessageAuthorKind;
  authorZohoUserId?: string | null;
  authorCarrierId?: string | null;
  authorName?: string | null;
  /** True = internal note, never shown to a carrier. Defaults to a visible reply. */
  isInternal?: boolean;
  mentions?: string[];
  /** For kind='system': the journal event name ('assigned', 'escalated', 'closed', …). */
  systemEvent?: string | null;
  detail?: Record<string, unknown> | null;
}

export interface ListMessagesOptions {
  /** Forward paging / gap-fill after a socket reconnect. */
  afterSeq?: number;
  /** Backward paging when scrolling up. */
  beforeSeq?: number;
  limit?: number;
  /**
   * Drop internal notes. Set for any reader who must not see them (a carrier). Applied in SQL, not
   * in the DTO builder, so an internal note cannot reach the response object at all.
   */
  excludeInternal?: boolean;
}

export const commsMessageRepo = {
  /**
   * Append a message and allocate its `seq`, atomically.
   *
   * The counter bump is the transaction's FIRST statement on purpose. `UPDATE … SET message_count =
   * message_count + 1 … RETURNING` takes a row lock on the thread, which serialises concurrent posts
   * to the SAME thread — messages within one conversation must totally order — while costing nothing
   * across different threads. It also hands back the next seq in the same round trip, so there is no
   * read-then-write race and no per-tenant sequence to contend on.
   *
   * The member rows' `last_message_at` mirror is maintained here too. That is a handful of extra row
   * writes per message, and it buys "my threads, most recent first, with unread counts" as one index
   * range scan on the inbox index instead of a join plus a sort.
   */
  async append(ctx: TenantContext, input: AppendMessageInput): Promise<MytrionThreadMessage> {
    const body = input.body;
    const preview = body.slice(0, PREVIEW_CHARS);

    return db.transaction(async (tx) => {
      const bumped = await tx
        .update(mytrionThreads)
        .set({
          messageCount: sql`${mytrionThreads.messageCount} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(eq(mytrionThreads.tenantId, ctx.tenantId), eq(mytrionThreads.id, input.threadId)),
        )
        .returning({
          seq: mytrionThreads.messageCount,
          kind: mytrionThreads.kind,
        });

      // No row means the thread does not exist in this tenant. Surfacing it as an error rather than
      // inserting an orphan message keeps the seq space and the thread counters consistent.
      const thread = firstOrThrow(bumped, 'thread not found for message append');

      const rows = await tx
        .insert(mytrionThreadMessages)
        .values({
          tenantId: ctx.tenantId,
          threadId: input.threadId,
          threadKind: thread.kind,
          seq: thread.seq,
          kind: input.kind ?? 'message',
          body,
          bodyFormat: input.bodyFormat ?? 'text',
          authorKind: input.authorKind,
          authorZohoUserId: input.authorZohoUserId ?? null,
          authorCarrierId: input.authorCarrierId ?? null,
          authorName: input.authorName ?? null,
          isInternal: input.isInternal ?? false,
          mentions: input.mentions ?? [],
          systemEvent: input.systemEvent ?? null,
          detail: input.detail ?? null,
        })
        .returning();
      const message = firstOrThrow(rows, 'message insert returned no row');

      const now = message.createdAt;
      await tx
        .update(mytrionThreads)
        .set({
          lastMessageAt: now,
          lastMessageId: message.id,
          lastMessageSeq: message.seq,
          lastMessagePreview: preview,
          lastMessageAuthorZohoUserId: input.authorZohoUserId ?? null,
        })
        .where(
          and(eq(mytrionThreads.tenantId, ctx.tenantId), eq(mytrionThreads.id, input.threadId)),
        );

      await tx
        .update(mytrionThreadMembers)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(
          and(
            eq(mytrionThreadMembers.tenantId, ctx.tenantId),
            eq(mytrionThreadMembers.threadId, input.threadId),
            ne(mytrionThreadMembers.state, 'left'),
          ),
        );

      return message;
    });
  },

  /**
   * Messages in a thread, oldest first.
   *
   * AUTHORIZATION IS THE CALLER'S JOB: this is only ever reached after
   * `commsThreadRepo.getForReader` has proved the caller may read the thread, which is why there is
   * no reader filter here. Calling it without that check is an IDOR.
   */
  buildListQuery(ctx: TenantContext, threadId: string, opts: ListMessagesOptions = {}) {
    const where = [
      eq(mytrionThreadMessages.tenantId, ctx.tenantId),
      eq(mytrionThreadMessages.threadId, threadId),
    ];
    if (opts.afterSeq !== undefined) where.push(gt(mytrionThreadMessages.seq, opts.afterSeq));
    if (opts.beforeSeq !== undefined) where.push(lt(mytrionThreadMessages.seq, opts.beforeSeq));
    if (opts.excludeInternal) where.push(eq(mytrionThreadMessages.isInternal, false));

    const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);

    // beforeSeq is a scroll-up: take the newest below the cursor, so the caller gets the page
    // adjacent to what they already have rather than the start of the thread.
    return opts.beforeSeq !== undefined
      ? db
          .select()
          .from(mytrionThreadMessages)
          .where(and(...where))
          .orderBy(desc(mytrionThreadMessages.seq))
          .limit(limit)
      : db
          .select()
          .from(mytrionThreadMessages)
          .where(and(...where))
          .orderBy(asc(mytrionThreadMessages.seq))
          .limit(limit);
  },

  async listByThread(
    ctx: TenantContext,
    threadId: string,
    opts: ListMessagesOptions = {},
  ): Promise<MytrionThreadMessage[]> {
    const rows = await this.buildListQuery(ctx, threadId, opts);
    // Callers always render oldest-first; the scroll-up page is fetched descending, so flip it back.
    return opts.beforeSeq !== undefined ? [...rows].reverse() : rows;
  },

  async getById(
    ctx: TenantContext,
    threadId: string,
    messageId: string,
  ): Promise<MytrionThreadMessage | undefined> {
    const [row] = await db
      .select()
      .from(mytrionThreadMessages)
      .where(
        and(
          eq(mytrionThreadMessages.tenantId, ctx.tenantId),
          eq(mytrionThreadMessages.threadId, threadId),
          eq(mytrionThreadMessages.id, messageId),
        ),
      )
      .limit(1);
    return row;
  },

  /** Attachment fan-out: which of these messages carry files, without N queries. */
  async listByIds(ctx: TenantContext, ids: string[]): Promise<MytrionThreadMessage[]> {
    if (ids.length === 0) return [];
    return db
      .select()
      .from(mytrionThreadMessages)
      .where(
        and(
          eq(mytrionThreadMessages.tenantId, ctx.tenantId),
          inArray(mytrionThreadMessages.id, ids),
        ),
      );
  },
};
