import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/client.js';
import {
  mytrionEscalationHops,
  mytrionEscalations,
  mytrionThreads,
  mytrionTickets,
  type EscalationHopDecision,
  type EscalationHopStatus,
  type EscalationLevel,
  type EscalationRoutingSource,
  type EscalationStatus,
  type MytrionEscalation,
  type MytrionEscalationHop,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { commsThreadReaderFilter } from './commsThreadRepo.js';
import { firstOrThrow } from './util.js';

/**
 * The escalation routing cursor and its append-only hop chain.
 *
 * Reads go through the thread, like every other comms read, so `commsThreadReaderFilter` is the single
 * gate. An escalation thread is `visibility='participants'` for its whole life, so the department arm
 * never applies to it: only the people actually on the chain can read it. That is deliberate — switching
 * to 'department' on a hand-off would expose the full history to everyone holding the receiving
 * department, a much wider audience than the people involved.
 *
 * The hop rows SNAPSHOT their assignee. A later config edit — a new reason default, a new department
 * manager — must never silently reroute an escalation already in flight.
 */

export interface CreateEscalationInput {
  threadId: string;
  ticketId: string;
  reasonTypeId?: string | null;
  reasonCode?: string | null;
  reasonLabel?: string | null;
  requesterZohoUserId: string;
  requesterName: string;
  requesterDepartment?: string | null;
  /** Where hop 1's outcome puts it: level 2 with the reason's fall-to user, normally. */
  currentLevel: EscalationLevel;
  currentDepartment?: string | null;
  currentAssigneeZohoUserId?: string | null;
  currentAssigneeName?: string | null;
  hopDueAt?: Date | null;
}

export interface AppendHopInput {
  escalationId: string;
  hopIndex: number;
  level: EscalationLevel;
  levelLabel: string;
  department?: string | null;
  assigneeZohoUserId?: string | null;
  assigneeName?: string | null;
  routingSource: EscalationRoutingSource;
  /** 'no_reason_default' | 'no_manager' | 'inactive' | 'is_requester' — why it could not route here. */
  skipReason?: string | null;
  handoffNote?: string | null;
  decidedByZohoUserId?: string | null;
  decision?: EscalationHopDecision | null;
  status?: EscalationHopStatus;
  decisionComment?: string | null;
  slaHours?: number | null;
  dueAt?: Date | null;
}

export interface AdvanceCursorInput {
  escalationId: string;
  expectedVersion: number;
  currentLevel: EscalationLevel;
  currentHopIndex: number;
  currentDepartment?: string | null;
  currentAssigneeZohoUserId?: string | null;
  currentAssigneeName?: string | null;
  hopDueAt?: Date | null;
  status?: EscalationStatus;
  resolutionComment?: string | null;
  resolvedByZohoUserId?: string | null;
}

export interface ListEscalationsOptions {
  status?: EscalationStatus[];
  /** "Escalations waiting on me". */
  currentAssigneeZohoUserId?: string;
  /** "Escalations I raised". */
  requesterZohoUserId?: string;
  currentDepartment?: string;
  limit?: number;
}

export interface EscalationWithThread {
  escalation: MytrionEscalation;
  threadId: string;
}

export const commsEscalationRepo = {
  /**
   * Insert the escalation cursor. Called INSIDE the caller's transaction so the escalation, its first
   * hop and the E- ticket either all exist or none do.
   */
  async create(
    ctx: TenantContext,
    input: CreateEscalationInput,
    tx: DbOrTx = db,
  ): Promise<MytrionEscalation> {
    const rows = await tx
      .insert(mytrionEscalations)
      .values({
        tenantId: ctx.tenantId,
        threadId: input.threadId,
        ticketId: input.ticketId,
        reasonTypeId: input.reasonTypeId ?? null,
        reasonCode: input.reasonCode ?? null,
        reasonLabel: input.reasonLabel ?? null,
        requesterZohoUserId: input.requesterZohoUserId,
        requesterName: input.requesterName,
        requesterDepartment: input.requesterDepartment ?? null,
        status: 'pending',
        currentLevel: input.currentLevel,
        currentHopIndex: 1,
        currentDepartment: input.currentDepartment ?? null,
        currentAssigneeZohoUserId: input.currentAssigneeZohoUserId ?? null,
        currentAssigneeName: input.currentAssigneeName ?? null,
        hopDueAt: input.hopDueAt ?? null,
      })
      .returning();
    return firstOrThrow(rows, 'escalation insert returned no row');
  },

  async appendHop(
    ctx: TenantContext,
    input: AppendHopInput,
    tx: DbOrTx = db,
  ): Promise<MytrionEscalationHop> {
    const rows = await tx
      .insert(mytrionEscalationHops)
      .values({
        tenantId: ctx.tenantId,
        escalationId: input.escalationId,
        hopIndex: input.hopIndex,
        level: input.level,
        levelLabel: input.levelLabel,
        department: input.department ?? null,
        assigneeZohoUserId: input.assigneeZohoUserId ?? null,
        assigneeName: input.assigneeName ?? null,
        routingSource: input.routingSource,
        skipReason: input.skipReason ?? null,
        handoffNote: input.handoffNote ?? null,
        decidedByZohoUserId: input.decidedByZohoUserId ?? null,
        decision: input.decision ?? null,
        status: input.status ?? 'pending',
        decisionComment: input.decisionComment ?? null,
        slaHours: input.slaHours ?? null,
        dueAt: input.dueAt ?? null,
      })
      .returning();
    return firstOrThrow(rows, 'escalation hop insert returned no row');
  },

  /** Close out the hop the escalation is currently sitting on. */
  async closeHop(
    ctx: TenantContext,
    escalationId: string,
    hopIndex: number,
    outcome: {
      status: EscalationHopStatus;
      decision: EscalationHopDecision;
      decidedByZohoUserId: string;
      decisionComment?: string | null;
      handoffNote?: string | null;
    },
    tx: DbOrTx = db,
  ): Promise<void> {
    await tx
      .update(mytrionEscalationHops)
      .set({
        status: outcome.status,
        decision: outcome.decision,
        decidedByZohoUserId: outcome.decidedByZohoUserId,
        decisionComment: outcome.decisionComment ?? null,
        handoffNote: outcome.handoffNote ?? null,
        decidedAt: new Date(),
      })
      .where(
        and(
          eq(mytrionEscalationHops.tenantId, ctx.tenantId),
          eq(mytrionEscalationHops.escalationId, escalationId),
          eq(mytrionEscalationHops.hopIndex, hopIndex),
        ),
      );
  },

  /**
   * Move the cursor under optimistic concurrency; undefined means the version moved on (route 409s).
   *
   * Last-write-wins is not acceptable here: two managers deciding at the same instant would silently
   * discard one decision, and "who escalated this to the CEO?" is exactly the question the chain exists
   * to answer.
   */
  async advanceCursor(
    ctx: TenantContext,
    input: AdvanceCursorInput,
    tx: DbOrTx = db,
  ): Promise<MytrionEscalation | undefined> {
    const now = new Date();
    const set: Partial<typeof mytrionEscalations.$inferInsert> = {
      currentLevel: input.currentLevel,
      currentHopIndex: input.currentHopIndex,
      currentDepartment: input.currentDepartment ?? null,
      currentAssigneeZohoUserId: input.currentAssigneeZohoUserId ?? null,
      currentAssigneeName: input.currentAssigneeName ?? null,
      hopDueAt: input.hopDueAt ?? null,
      version: input.expectedVersion + 1,
      updatedAt: now,
    };
    if (input.status !== undefined) set.status = input.status;
    if (input.resolutionComment !== undefined) set.resolutionComment = input.resolutionComment;
    if (input.resolvedByZohoUserId !== undefined) {
      set.resolvedByZohoUserId = input.resolvedByZohoUserId;
      set.resolvedAt = now;
    }

    const rows = await tx
      .update(mytrionEscalations)
      .set(set)
      .where(
        and(
          eq(mytrionEscalations.tenantId, ctx.tenantId),
          eq(mytrionEscalations.id, input.escalationId),
          eq(mytrionEscalations.version, input.expectedVersion),
          // Only a PENDING escalation can move. Without this a resolved chain could be reopened by a
          // request that happens to carry the right version, which the version check alone allows.
          eq(mytrionEscalations.status, 'pending'),
        ),
      )
      .returning();
    return rows[0];
  },

  /**
   * Mirror the cursor onto the escalation's `E-` ticket row.
   *
   * `mytrion_tickets.escalation_id / escalation_level / escalation_level_label` exist only to render the
   * ladder position in a ticket list without joining. The write lives HERE, not in commsTicketRepo,
   * because this module owns the source of truth those three columns copy — splitting them apart is how
   * a mirror silently stops matching. Runs inside the caller's transaction for the same reason.
   *
   * `status` is also mirrored: a pending escalation shows as 'escalated' in a ticket list, and a resolved
   * one must not keep claiming it is.
   */
  async mirrorOntoTicket(
    ctx: TenantContext,
    ticketId: string,
    mirror: {
      escalationId: string;
      level: EscalationLevel;
      levelLabel: string;
      assigneeZohoUserId?: string | null;
      assigneeName?: string | null;
      targetDepartment?: string | null;
      status?: 'escalated' | 'resolved' | 'closed' | 'cancelled';
    },
    tx: DbOrTx = db,
  ): Promise<void> {
    const now = new Date();
    const set: Partial<typeof mytrionTickets.$inferInsert> = {
      escalationId: mirror.escalationId,
      escalationLevel: mirror.level,
      escalationLevelLabel: mirror.levelLabel,
      updatedAt: now,
    };
    if (mirror.assigneeZohoUserId !== undefined) {
      set.assigneeZohoUserId = mirror.assigneeZohoUserId;
      set.assigneeName = mirror.assigneeName ?? null;
      set.assignedAt = now;
      set.assignmentReason = 'auto';
    }
    if (mirror.targetDepartment !== undefined) set.targetDepartment = mirror.targetDepartment;
    if (mirror.status !== undefined) {
      set.status = mirror.status;
      if (mirror.status === 'resolved') set.resolvedAt = now;
      if (mirror.status === 'closed') set.closedAt = now;
      if (mirror.status === 'cancelled') set.cancelledAt = now;
    }

    await tx
      .update(mytrionTickets)
      .set({
        ...set,
        // Passed here rather than in `set` above: the increment is SQL, and `Partial<$inferInsert>` types
        // `version` as a plain number. Bumped so a concurrent ticket-level transition sees a stale
        // version and 409s instead of overwriting the escalation's own state change.
        version: sql`${mytrionTickets.version} + 1`,
      })
      .where(and(eq(mytrionTickets.tenantId, ctx.tenantId), eq(mytrionTickets.id, ticketId)));
  },

  /**
   * One escalation the caller may read, joined through its thread so the shared gate applies.
   *
   * Undefined rather than a throw, so the route answers 404 and a guessed id is not confirmed.
   */
  async getForReader(
    ctx: TenantContext,
    escalationId: string,
  ): Promise<MytrionEscalation | undefined> {
    const [row] = await db
      .select({ escalation: mytrionEscalations })
      .from(mytrionEscalations)
      .innerJoin(
        mytrionThreads,
        and(
          eq(mytrionThreads.tenantId, mytrionEscalations.tenantId),
          eq(mytrionThreads.id, mytrionEscalations.threadId),
        ),
      )
      .where(
        and(
          eq(mytrionEscalations.tenantId, ctx.tenantId),
          eq(mytrionEscalations.id, escalationId),
          commsThreadReaderFilter(ctx),
        ),
      )
      .limit(1);
    return row?.escalation;
  },

  async getByTicketForReader(
    ctx: TenantContext,
    ticketId: string,
  ): Promise<MytrionEscalation | undefined> {
    const [row] = await db
      .select({ escalation: mytrionEscalations })
      .from(mytrionEscalations)
      .innerJoin(
        mytrionThreads,
        and(
          eq(mytrionThreads.tenantId, mytrionEscalations.tenantId),
          eq(mytrionThreads.id, mytrionEscalations.threadId),
        ),
      )
      .where(
        and(
          eq(mytrionEscalations.tenantId, ctx.tenantId),
          eq(mytrionEscalations.ticketId, ticketId),
          commsThreadReaderFilter(ctx),
        ),
      )
      .limit(1);
    return row?.escalation;
  },

  /** Split out for offline `.toSQL()` assertions in the RBAC-leakage suite. */
  buildListQuery(ctx: TenantContext, opts: ListEscalationsOptions = {}) {
    const where = [eq(mytrionEscalations.tenantId, ctx.tenantId), commsThreadReaderFilter(ctx)];
    if (opts.status && opts.status.length > 0) {
      where.push(inArray(mytrionEscalations.status, opts.status));
    }
    if (opts.currentAssigneeZohoUserId) {
      where.push(
        eq(mytrionEscalations.currentAssigneeZohoUserId, opts.currentAssigneeZohoUserId),
      );
    }
    if (opts.requesterZohoUserId) {
      where.push(eq(mytrionEscalations.requesterZohoUserId, opts.requesterZohoUserId));
    }
    if (opts.currentDepartment) {
      where.push(eq(mytrionEscalations.currentDepartment, opts.currentDepartment));
    }
    return db
      .select({ escalation: mytrionEscalations })
      .from(mytrionEscalations)
      .innerJoin(
        mytrionThreads,
        and(
          eq(mytrionThreads.tenantId, mytrionEscalations.tenantId),
          eq(mytrionThreads.id, mytrionEscalations.threadId),
        ),
      )
      .where(and(...where))
      .orderBy(desc(mytrionEscalations.createdAt))
      .limit(Math.min(Math.max(opts.limit ?? 50, 1), 200));
  },

  async list(
    ctx: TenantContext,
    opts: ListEscalationsOptions = {},
  ): Promise<MytrionEscalation[]> {
    const rows = await this.buildListQuery(ctx, opts);
    return rows.map((r) => r.escalation);
  },

  /**
   * The whole chain, oldest hop first. Authorization is the caller's job — reach this only after
   * `getForReader` has proved the caller may read the escalation.
   */
  buildHopsQuery(ctx: TenantContext, escalationId: string) {
    return db
      .select()
      .from(mytrionEscalationHops)
      .where(
        and(
          eq(mytrionEscalationHops.tenantId, ctx.tenantId),
          eq(mytrionEscalationHops.escalationId, escalationId),
        ),
      )
      .orderBy(asc(mytrionEscalationHops.hopIndex));
  },

  async listHops(ctx: TenantContext, escalationId: string): Promise<MytrionEscalationHop[]> {
    return this.buildHopsQuery(ctx, escalationId);
  },

  /**
   * Has this person already held a hop on this chain?
   *
   * Used to refuse routing an escalation to someone who has already had it, which is what stops a
   * ping-pong loop between two departments whose configs point at each other.
   */
  async hasHeldHop(
    ctx: TenantContext,
    escalationId: string,
    zohoUserId: string,
  ): Promise<boolean> {
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(mytrionEscalationHops)
      .where(
        and(
          eq(mytrionEscalationHops.tenantId, ctx.tenantId),
          eq(mytrionEscalationHops.escalationId, escalationId),
          eq(mytrionEscalationHops.assigneeZohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return row !== undefined;
  },
};
