import { and, asc, eq } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import {
  mytrionTicketEvents,
  type CommsTicketEventType,
  type CommsTicketStatus,
  type MytrionTicketEvent,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

/**
 * The append-only ticket journal — every assignment, transition and escalation hop, with a reason.
 *
 * Separate from `mytrion_thread_messages` on purpose. A journal row is a FACT about the ticket
 * ("auto-assigned, round_robin, 3 candidates skipped for being offline"), whereas a message is
 * conversation. Merging them would either flood the chat with bookkeeping or leave the audit trail
 * dependent on someone not deleting a message. The two are correlated by `ticket_id` when the UI wants
 * an interleaved activity view.
 */

export interface AppendTicketEventInput {
  ticketId: string;
  threadId?: string | null;
  eventType: CommsTicketEventType;
  /** NULL for a system actor — the auto-assigner, the SLA sweeper. */
  actorZohoUserId?: string | null;
  actorName?: string | null;
  fromStatus?: CommsTicketStatus | null;
  toStatus?: CommsTicketStatus | null;
  /** Structured `why`. Serialized here because the column is text, not jsonb. */
  detail?: Record<string, unknown> | null;
}

export const commsTicketEventRepo = {
  /**
   * Append one journal row.
   *
   * Takes an optional executor so a create/transition can write its event inside the SAME transaction
   * as the state change it describes. A journal that can be missing for a committed transition is
   * worse than no journal, because it makes the trail's absence ambiguous.
   */
  async append(
    ctx: TenantContext,
    input: AppendTicketEventInput,
    tx: DbOrTx = db,
  ): Promise<MytrionTicketEvent> {
    const rows = await tx
      .insert(mytrionTicketEvents)
      .values({
        tenantId: ctx.tenantId,
        ticketId: input.ticketId,
        threadId: input.threadId ?? null,
        eventType: input.eventType,
        actorZohoUserId: input.actorZohoUserId ?? null,
        actorName: input.actorName ?? null,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        detail: input.detail ? JSON.stringify(input.detail) : null,
      })
      .returning();
    // No firstOrThrow: an INSERT … RETURNING that yields nothing is impossible, and throwing here
    // would roll back the state change over a bookkeeping row. The non-null assert is unavoidable
    // under noUncheckedIndexedAccess and is justified by RETURNING on a single-row insert.
    const row = rows[0];
    if (row === undefined) throw new Error('ticket event insert returned no row');
    return row;
  },

  /** The activity trail for one ticket, oldest first. Authorization is the caller's job. */
  buildListQuery(ctx: TenantContext, ticketId: string, limit = 200) {
    return db
      .select()
      .from(mytrionTicketEvents)
      .where(
        and(
          eq(mytrionTicketEvents.tenantId, ctx.tenantId),
          eq(mytrionTicketEvents.ticketId, ticketId),
        ),
      )
      .orderBy(asc(mytrionTicketEvents.occurredAt))
      .limit(Math.min(Math.max(limit, 1), 500));
  },

  async listByTicket(
    ctx: TenantContext,
    ticketId: string,
    limit = 200,
  ): Promise<MytrionTicketEvent[]> {
    return this.buildListQuery(ctx, ticketId, limit);
  },
};
