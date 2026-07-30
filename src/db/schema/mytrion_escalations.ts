import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * The four fixed escalation levels.
 *
 *   1 requester  — any Zoho user; in practice a Sales agent using the Create tab's Escalation Request
 *   2 agent      — the reason's default fall-to user (e.g. a CS Agent)
 *   3 manager    — the department manager / Department Lead of the department it fell into
 *   4 c_level    — C-Level
 *
 * From level 2 the assignee may go UP to level 3, or SIDEWAYS to another department (which re-enters
 * at that department's agent level, i.e. level 2 again with a new department).
 */
export type EscalationLevel = 1 | 2 | 3 | 4;

export const ESCALATION_LEVEL_LABELS: Record<EscalationLevel, string> = {
  1: 'Requester',
  2: 'Agent',
  3: 'Department Manager',
  4: 'C-Level',
};

export type EscalationStatus = 'pending' | 'resolved' | 'rejected' | 'withdrawn' | 'expired';

/** How a hop's assignee was chosen. */
export type EscalationRoutingSource =
  | 'requester'
  | 'reason_default'
  | 'department_manager'
  | 'c_level'
  | 'manual'
  | 'unresolved';

/** What happened at a hop. */
export type EscalationHopDecision =
  | 'raised'
  | 'escalated_up'
  | 'handed_off'
  | 'reassigned'
  | 'resolved'
  | 'rejected'
  | 'withdrawn'
  | 'expired';

export type EscalationHopStatus =
  | 'pending'
  | 'escalated_up'
  | 'handed_off'
  | 'resolved'
  | 'rejected'
  | 'skipped';

/**
 * An escalation request. PERSONAL — tied to the requester's Zoho identity, never to a client.
 * A ticket is about a carrier; an escalation is about a person's request.
 *
 * It shares the thread substrate with tickets (so messages, attachments, read state and the realtime
 * topic are identical) and has its own `E-` numbered row in mytrion_tickets. This table holds only
 * the routing cursor and the resolved chain.
 */
export const mytrionEscalations = pgTable(
  'mytrion_escalations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mesc_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    threadId: text('thread_id').notNull(),
    /** The escalation's own ticket row, which carries the E- number. */
    ticketId: text('ticket_id').notNull(),

    // --- reason, snapshotted so a later catalog rename cannot rewrite history ---
    reasonTypeId: text('reason_type_id'),
    reasonCode: text('reason_code'),
    reasonLabel: text('reason_label'),

    /** The person who raised it. This is what makes an escalation personal. */
    requesterZohoUserId: text('requester_zoho_user_id').notNull(),
    requesterName: text('requester_name').notNull(),
    /** Their department at raise time, for reporting. */
    requesterDepartment: text('requester_department'),

    status: text('status').$type<EscalationStatus>().notNull().default('pending'),

    // --- routing cursor: where it is RIGHT NOW ---
    currentLevel: integer('current_level').notNull().default(2),
    currentHopIndex: integer('current_hop_index').notNull().default(1),
    currentDepartment: text('current_department'),
    /** NULL once resolved. Indexed — this is the "my escalation inbox" lookup. */
    currentAssigneeZohoUserId: text('current_assignee_zoho_user_id'),
    currentAssigneeName: text('current_assignee_name'),
    hopDueAt: timestamp('hop_due_at', { withTimezone: true }),

    resolutionComment: text('resolution_comment'),
    resolvedByZohoUserId: text('resolved_by_zoho_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),

    /** Optimistic concurrency: two people deciding at once, one wins and one gets a 409. */
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketUk: uniqueIndex('mytrion_escalations_ticket_uk').on(table.tenantId, table.ticketId),
    /** "Escalations waiting on me" — the direct analogue of the leave-request approver inbox index. */
    inboxIdx: index('mytrion_escalations_inbox_idx').on(
      table.tenantId,
      table.currentAssigneeZohoUserId,
      table.status,
      table.createdAt,
    ),
    /** "Escalations I raised". */
    requesterIdx: index('mytrion_escalations_requester_idx').on(
      table.tenantId,
      table.requesterZohoUserId,
      table.status,
      table.createdAt,
    ),
    /** Per-department view + the expiry sweeper. */
    deptIdx: index('mytrion_escalations_dept_idx').on(
      table.tenantId,
      table.currentDepartment,
      table.status,
    ),
    dueIdx: index('mytrion_escalations_due_idx').on(table.tenantId, table.status, table.hopDueAt),
  }),
);

/**
 * Append-only record of every hop, so the whole chain is queryable at any length.
 *
 * Renders as: `Sales · Ali (raised) → Customer Service · Dilnoza, level 2 (escalated up)
 * → Customer Service · Bekzod, level 3 (handed off to Billing) → Billing · Nodira, level 2 …`
 *
 * The assignee is SNAPSHOTTED at each hop. A later config edit — a new reason default, a new
 * department manager — must never silently reroute an escalation that is already in flight, which is
 * the same reason hr_leave_requests snapshots its approvers at submit.
 *
 * ESCALATION IS A GROWING GROUP CONVERSATION. A hop ADDS the new assignee to
 * mytrion_thread_members and never removes anyone: everyone who has been involved keeps reading and
 * replying, so the thread accumulates into a group chat of all participants. Two consequences the
 * service layer must respect:
 *   - Advancing or handing off is an INSERT into members, never an UPDATE of the existing row's key.
 *     Reassignment changes which member holds role='assignee'; it does not evict the previous one.
 *   - Because the set only grows, `visibility` stays 'participants' for an escalation. Switching it
 *     to 'department' on a hand-off would silently expose the whole history to everyone holding the
 *     receiving department, which is a much wider audience than the people actually involved.
 */
export const mytrionEscalationHops = pgTable(
  'mytrion_escalation_hops',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mesh_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    escalationId: text('escalation_id').notNull(),
    /** 1-based position in the chain. Arbitrary length — a hand-off can bounce between departments. */
    hopIndex: integer('hop_index').notNull(),
    level: integer('level').notNull(),
    levelLabel: text('level_label').notNull(),
    department: text('department'),

    assigneeZohoUserId: text('assignee_zoho_user_id'),
    assigneeName: text('assignee_name'),
    routingSource: text('routing_source').$type<EscalationRoutingSource>().notNull(),
    /** Why it could not be routed here: 'no_reason_default' | 'no_manager' | 'inactive' | 'is_requester'. */
    skipReason: text('skip_reason'),

    /** Free text the sender supplied when moving it here. */
    handoffNote: text('handoff_note'),
    /** Who moved it here. NULL on hop 1 — that is the requester raising it. */
    decidedByZohoUserId: text('decided_by_zoho_user_id'),
    decision: text('decision').$type<EscalationHopDecision>(),
    status: text('status').$type<EscalationHopStatus>().notNull().default('pending'),
    decisionComment: text('decision_comment'),

    slaHours: integer('sla_hours'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
  },
  (table) => ({
    hopUk: uniqueIndex('mytrion_escalation_hops_hop_uk').on(
      table.tenantId,
      table.escalationId,
      table.hopIndex,
    ),
    chainIdx: index('mytrion_escalation_hops_chain_idx').on(
      table.tenantId,
      table.escalationId,
      table.hopIndex,
    ),
    /** "What is sitting at level 3 in Billing" — load and ladder reporting. */
    deptLevelIdx: index('mytrion_escalation_hops_dept_level_idx').on(
      table.tenantId,
      table.department,
      table.level,
      table.status,
    ),
  }),
);

export type MytrionEscalation = typeof mytrionEscalations.$inferSelect;
export type NewMytrionEscalation = typeof mytrionEscalations.$inferInsert;
export type MytrionEscalationHop = typeof mytrionEscalationHops.$inferSelect;
export type NewMytrionEscalationHop = typeof mytrionEscalationHops.$inferInsert;
