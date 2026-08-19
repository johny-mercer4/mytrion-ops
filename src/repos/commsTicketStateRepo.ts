import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionTickets,
  type CommsTicketPriority,
  type CommsTicketStatus,
  type MytrionTicket,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * Ticket STATE writes — status transitions, assignment, and the first-response stamp.
 *
 * Split from `commsTicketRepo` (which owns create and the reader-filtered reads) because these three share a
 * property the read path does not: each one is a CONTENDED write whose correctness depends on the WHERE
 * clause rather than on the caller checking first. Two agents deciding at once, two replies landing in the
 * same instant, an auto-assigner racing a manual claim — every case is settled by a predicate here, and
 * keeping them together is what makes that pattern visible instead of scattered.
 */

export const commsTicketStateRepo = {
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
   * Change priority under optimistic concurrency.
   *
   * Version-gated like `transitionStatus` and for the same reason: priority is what an SLA report and a
   * queue sort read off, so two agents re-prioritising at once must not silently clobber one another.
   * Returns undefined when `expectedVersion` no longer matches, which the route turns into a 409.
   */
  async setPriority(
    ctx: TenantContext,
    opts: { ticketId: string; expectedVersion: number; toPriority: CommsTicketPriority },
  ): Promise<MytrionTicket | undefined> {
    const now = new Date();
    const rows = await db
      .update(mytrionTickets)
      .set({ priority: opts.toPriority, version: opts.expectedVersion + 1, updatedAt: now })
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

  /**
   * Stamp an assignee.
   *
   * The `IS NULL OR <> new` predicate is the race guard: an auto-assign and a manual claim landing together
   * must produce ONE winner, and re-stamping the same person would otherwise bump `assigned_at` and make the
   * queue's "waiting since" jump backwards. Returns undefined when somebody else already took it, which the
   * caller treats as "release my roster claim" rather than as an error.
   */
  async assign(
    ctx: TenantContext,
    opts: {
      ticketId: string;
      zohoUserId: string;
      name: string | null;
      reason: 'auto' | 'claimed' | 'manual' | 'default';
      /** Set for a REASSIGN, where overwriting an existing assignee is the whole point. */
      allowOverwrite?: boolean;
    },
  ): Promise<MytrionTicket | undefined> {
    const now = new Date();
    const rows = await db
      .update(mytrionTickets)
      .set({
        assigneeZohoUserId: opts.zohoUserId,
        assigneeName: opts.name,
        assignedAt: now,
        assignmentReason: opts.reason,
        updatedAt: now,
      })
      .where(
        and(
          eq(mytrionTickets.tenantId, ctx.tenantId),
          eq(mytrionTickets.id, opts.ticketId),
          opts.allowOverwrite
            ? sql`TRUE`
            : sql`(${mytrionTickets.assigneeZohoUserId} IS NULL OR ${mytrionTickets.assigneeZohoUserId} = ${opts.zohoUserId})`,
        ),
      )
      .returning();
    return rows[0];
  },

  /**
   * Replace a ticket's tags outright.
   *
   * NOT version-gated, unlike status/priority: tags are low-contention triage labels, and 409-ing an
   * agent for adding a label while someone else changed the status would be noise. The caller passes the
   * full desired set (add/remove is computed client-side), so this is a plain set, and it deliberately
   * does not bump `version` — an independent status transition in flight must still succeed.
   */
  async setTags(
    ctx: TenantContext,
    ticketId: string,
    tags: string[],
  ): Promise<MytrionTicket | undefined> {
    const rows = await db
      .update(mytrionTickets)
      .set({ tags, updatedAt: new Date() })
      .where(and(eq(mytrionTickets.tenantId, ctx.tenantId), eq(mytrionTickets.id, ticketId)))
      .returning();
    return rows[0];
  },

  /** Drop the assignee — back to the queue. Used when someone goes off shift mid-ticket. */
  async unassign(ctx: TenantContext, ticketId: string): Promise<MytrionTicket | undefined> {
    const rows = await db
      .update(mytrionTickets)
      .set({
        assigneeZohoUserId: null,
        assigneeName: null,
        assignedAt: null,
        assignmentReason: null,
        updatedAt: new Date(),
      })
      .where(and(eq(mytrionTickets.tenantId, ctx.tenantId), eq(mytrionTickets.id, ticketId)))
      .returning();
    return rows[0];
  },
};
