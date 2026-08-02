import { and, eq, gt, lt, ne, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionThreadMembers,
  mytrionThreads,
  type CommsMemberKind,
  type CommsMemberNotify,
  type CommsMemberRole,
  type MytrionThreadMember,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

export interface AddMemberInput {
  threadId: string;
  memberKind: CommsMemberKind;
  /** Zoho user id for a worker, carrier id for a carrier. */
  memberKey: string;
  memberName?: string | null;
  role?: CommsMemberRole;
  notify?: CommsMemberNotify;
  addedByZohoUserId?: string | null;
}

export interface UnreadTotal {
  threadId: string;
  unread: number;
}

export const commsThreadMemberRepo = {
  /**
   * Add a participant, or revive one who had left.
   *
   * Idempotent by design, because escalation hand-off calls this on every hop and a bounce back to a
   * department that was already involved must not fail. Reviving sets state back to 'active' and
   * refreshes the role, which is what makes "everyone who has been involved can keep talking" work
   * without special-casing the return path.
   */
  async add(ctx: TenantContext, input: AddMemberInput): Promise<MytrionThreadMember> {
    const now = new Date();
    const rows = await db
      .insert(mytrionThreadMembers)
      .values({
        tenantId: ctx.tenantId,
        threadId: input.threadId,
        memberKind: input.memberKind,
        memberKey: input.memberKey,
        memberName: input.memberName ?? null,
        role: input.role ?? 'participant',
        notify: input.notify ?? 'all',
        addedByZohoUserId: input.addedByZohoUserId ?? null,
      })
      .onConflictDoUpdate({
        target: [
          mytrionThreadMembers.tenantId,
          mytrionThreadMembers.threadId,
          mytrionThreadMembers.memberKind,
          mytrionThreadMembers.memberKey,
        ],
        set: {
          state: 'active',
          leftAt: null,
          role: input.role ?? sql`${mytrionThreadMembers.role}`,
          memberName: input.memberName ?? sql`${mytrionThreadMembers.memberName}`,
          updatedAt: now,
        },
      })
      .returning();
    return firstOrThrow(rows, 'thread member upsert returned no row');
  },

  async listByThread(ctx: TenantContext, threadId: string): Promise<MytrionThreadMember[]> {
    return db
      .select()
      .from(mytrionThreadMembers)
      .where(
        and(
          eq(mytrionThreadMembers.tenantId, ctx.tenantId),
          eq(mytrionThreadMembers.threadId, threadId),
          ne(mytrionThreadMembers.state, 'left'),
        ),
      );
  },

  /**
   * Move the `assignee` role to someone else WITHOUT evicting the previous holder.
   *
   * This is the growing-group invariant in code: a reassignment or an escalation hop changes who
   * holds the role, and the previous holder stays an active participant who can still read and
   * reply. Removing them would silently drop people out of a conversation they are part of.
   */
  async transferAssignee(
    ctx: TenantContext,
    threadId: string,
    next: { memberKind: CommsMemberKind; memberKey: string; memberName?: string | null },
  ): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(mytrionThreadMembers)
        .set({ role: 'participant', updatedAt: now })
        .where(
          and(
            eq(mytrionThreadMembers.tenantId, ctx.tenantId),
            eq(mytrionThreadMembers.threadId, threadId),
            eq(mytrionThreadMembers.role, 'assignee'),
          ),
        );
      await tx
        .insert(mytrionThreadMembers)
        .values({
          tenantId: ctx.tenantId,
          threadId,
          memberKind: next.memberKind,
          memberKey: next.memberKey,
          memberName: next.memberName ?? null,
          role: 'assignee',
        })
        .onConflictDoUpdate({
          target: [
            mytrionThreadMembers.tenantId,
            mytrionThreadMembers.threadId,
            mytrionThreadMembers.memberKind,
            mytrionThreadMembers.memberKey,
          ],
          set: { role: 'assignee', state: 'active', leftAt: null, updatedAt: now },
        });
    });
  },

  /**
   * Lazily join the caller as a watcher when they open a department-queue thread.
   *
   * Without this, a CS agent reading the queue has no member row and therefore no read state, so the
   * thread would show as unread forever. It also means a department thread carries only the people
   * who actually engaged, rather than materialising every department member up front — which is what
   * keeps the department arm a cheap index scan instead of a fan-out.
   */
  async ensureWatcher(
    ctx: TenantContext,
    threadId: string,
    member: { memberKind: CommsMemberKind; memberKey: string; memberName?: string | null },
  ): Promise<void> {
    await db
      .insert(mytrionThreadMembers)
      .values({
        tenantId: ctx.tenantId,
        threadId,
        memberKind: member.memberKind,
        memberKey: member.memberKey,
        memberName: member.memberName ?? null,
        role: 'watcher',
      })
      // Do NOT touch role/state here: someone already the requester or assignee must not be demoted
      // to a watcher just because they opened the thread.
      .onConflictDoNothing();
  },

  /**
   * Advance the caller's read watermark. Monotonic: a lower seq is ignored, so an out-of-order
   * client (two tabs, a replayed frame) can never make a thread look unread again.
   */
  async markRead(
    ctx: TenantContext,
    threadId: string,
    member: { memberKind: CommsMemberKind; memberKey: string },
    seq: number,
  ): Promise<void> {
    const now = new Date();
    await db
      .update(mytrionThreadMembers)
      .set({ lastReadSeq: seq, lastReadAt: now, updatedAt: now })
      .where(
        and(
          eq(mytrionThreadMembers.tenantId, ctx.tenantId),
          eq(mytrionThreadMembers.threadId, threadId),
          eq(mytrionThreadMembers.memberKind, member.memberKind),
          eq(mytrionThreadMembers.memberKey, member.memberKey),
          lt(mytrionThreadMembers.lastReadSeq, seq),
        ),
      );
  },

  /**
   * Per-thread unread counts for one member — `message_count - last_read_seq`, arithmetic only.
   *
   * Split out for SQL assertions, and the reason read state is an integer seq rather than a message
   * id: with an id, every badge would need a subquery to resolve that id's position in the thread.
   */
  buildUnreadQuery(ctx: TenantContext, member: { memberKind: CommsMemberKind; memberKey: string }) {
    return db
      .select({
        threadId: mytrionThreads.id,
        unread: sql<number>`(${mytrionThreads.messageCount} - ${mytrionThreadMembers.lastReadSeq})::int`,
      })
      .from(mytrionThreadMembers)
      .innerJoin(
        mytrionThreads,
        and(
          eq(mytrionThreads.tenantId, mytrionThreadMembers.tenantId),
          eq(mytrionThreads.id, mytrionThreadMembers.threadId),
        ),
      )
      .where(
        and(
          eq(mytrionThreadMembers.tenantId, ctx.tenantId),
          eq(mytrionThreadMembers.memberKind, member.memberKind),
          eq(mytrionThreadMembers.memberKey, member.memberKey),
          ne(mytrionThreadMembers.state, 'left'),
          ne(mytrionThreadMembers.notify, 'none'),
          gt(mytrionThreads.messageCount, mytrionThreadMembers.lastReadSeq),
        ),
      );
  },

  async unreadTotals(
    ctx: TenantContext,
    member: { memberKind: CommsMemberKind; memberKey: string },
  ): Promise<UnreadTotal[]> {
    const rows = await this.buildUnreadQuery(ctx, member);
    return rows.map((r) => ({ threadId: r.threadId, unread: Number(r.unread) }));
  },

  /** Leave a thread: keeps the row for history, but drops read access via the reader filter. */
  async leave(
    ctx: TenantContext,
    threadId: string,
    member: { memberKind: CommsMemberKind; memberKey: string },
  ): Promise<void> {
    const now = new Date();
    await db
      .update(mytrionThreadMembers)
      .set({ state: 'left', leftAt: now, updatedAt: now })
      .where(
        and(
          eq(mytrionThreadMembers.tenantId, ctx.tenantId),
          eq(mytrionThreadMembers.threadId, threadId),
          eq(mytrionThreadMembers.memberKind, member.memberKind),
          eq(mytrionThreadMembers.memberKey, member.memberKey),
        ),
      );
  },
};
