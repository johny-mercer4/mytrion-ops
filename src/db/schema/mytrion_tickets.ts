import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** A ticket is about a client; a request is the lightweight form; an escalation is about a person. */
export type CommsTicketKind = 'ticket' | 'request' | 'escalation';

/**
 * Work state. Deliberately does NOT contain escalation position: in Zoho Desk the ladder IS the
 * status (`Stream Manager`, `Head of Department`, `C-Level`), which makes "is this open?" and "how
 * far up has it gone?" the same question — the reason CS_OPEN_STATUSES has to hardcode a list.
 * Here status is lifecycle and the ladder is `escalation_level`.
 */
export type CommsTicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending_requester'
  | 'on_hold'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'cancelled';

/** Zoho's live value is 'Medium', not 'Normal' — verified against the real org. */
export type CommsTicketPriority = 'low' | 'medium' | 'high' | 'critical';

/** Who raised it. There is no contact concept: a carrier IS the client, keyed by carrier_id. */
export type CommsRequesterKind = 'worker' | 'carrier';

export type CommsTicketChannel = 'web' | 'mini_app' | 'telegram' | 'email' | 'phone' | 'automation';
export type CommsTicketSource = 'worker' | 'mini_app' | 'automation' | 'webhook';

export type CommsTicketEventType =
  | 'created'
  | 'assigned'
  | 'auto_assigned'
  | 'claimed'
  | 'reassigned'
  | 'unassigned'
  | 'assignment_failed'
  | 'status_changed'
  | 'priority_changed'
  | 'type_changed'
  | 'department_changed'
  | 'tagged'
  | 'escalated'
  | 'escalation_advanced'
  | 'escalation_resolved'
  | 'commented'
  | 'note_added'
  | 'attachment_added'
  | 'sla_breached'
  | 'resolved'
  | 'closed'
  | 'reopened'
  | 'cancelled';

/**
 * The admin-editable catalog that replaces three hardcoded frontend arrays: the 49 `C-*`/`Q-*`/`V-*`/
 * `M-*` ticket types, the four department options, and the 11 escalation reasons.
 *
 * Escalation reasons live here too (`kind='escalation_reason'`) because routing is keyed on the
 * REASON: "based on escalation reason they default fall to the particular user, for example CS
 * Agent". `default_assignee_zoho_user_id` is that fall-to user, and it is what makes an escalation
 * land at level 2 without any department lookup.
 */
export const mytrionTicketTypes = pgTable(
  'mytrion_ticket_types',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtty_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** e.g. 'C-7', 'Q-1', 'V-3'. Unique per tenant. */
    code: text('code').notNull(),
    label: text('label').notNull(),
    kind: text('kind').$type<'ticket' | 'escalation_reason'>().notNull().default('ticket'),
    /**
     * The queue a ticket of this type lands in. Server-derived from this row and NEVER taken from a
     * request body, so a worker cannot file into a queue of their choosing — and retargeting a whole
     * family of types is a catalog UPDATE rather than a deploy.
     */
    targetDepartment: text('target_department'),
    /** Display grouping for the wizard's first step. */
    group: text('group'),
    defaultPriority: text('default_priority').$type<CommsTicketPriority>(),
    slaHours: integer('sla_hours'),
    /**
     * For kind='escalation_reason': the Zoho user this reason falls to at level 2 (the agent level).
     * NULL means unrouted — an escalation on this reason cannot be raised until an admin sets it.
     */
    defaultAssigneeZohoUserId: text('default_assignee_zoho_user_id'),
    /** Exposed in the lightweight Requests tab that non-operational Mytrions get. */
    requestable: boolean('requestable').notNull().default(false),
    requiresCarrier: boolean('requires_carrier').notNull().default(false),
    requiresCard: boolean('requires_card').notNull().default(false),
    /** Links to an existing self-service automation, for the "you can do this yourself" deflection. */
    automationKey: text('automation_key'),
    /** Deactivate, never delete — historical tickets still reference the row. */
    active: boolean('active').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    codeUk: uniqueIndex('mytrion_ticket_types_tenant_code_uk').on(table.tenantId, table.code),
    pickerIdx: index('mytrion_ticket_types_picker_idx').on(
      table.tenantId,
      table.kind,
      table.active,
      table.sortOrder,
    ),
    deptIdx: index('mytrion_ticket_types_dept_idx').on(
      table.tenantId,
      table.targetDepartment,
      table.active,
    ),
  }),
);

/**
 * A ticket, request or escalation. The conversation lives on the referenced thread.
 *
 * CLIENT LINKAGE. A client ticket is tied to `carrier_id` + `company_name` and nothing else. There
 * is deliberately no contact record anywhere in this system: clients already exist in the DWH as
 * `octane.dim_company`, which is a read-only replica with several rows per carrier, so these two
 * columns are a SNAPSHOT taken at create time and DWH stays the lookup source. Escalations are
 * personal — keyed on the requester's Zoho identity — and carry no carrier at all.
 */
export const mytrionTickets = pgTable(
  'mytrion_tickets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtk_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    threadId: text('thread_id').notNull(),
    /** Human-readable, kind-prefixed: T-000123 / R-000045 / E-000012. */
    number: text('number').notNull(),
    kind: text('kind').$type<CommsTicketKind>().notNull(),

    // --- catalog, snapshotted so a later rename cannot rewrite history ---
    ticketTypeId: text('ticket_type_id'),
    ticketTypeCode: text('ticket_type_code'),
    ticketTypeLabel: text('ticket_type_label'),

    targetDepartment: text('target_department'),
    /** Where it came FROM — answers "which Mytrion generates the most CS load". */
    sourceDepartment: text('source_department'),
    sourceMytrion: text('source_mytrion'),

    priority: text('priority').$type<CommsTicketPriority>().notNull().default('medium'),
    status: text('status').$type<CommsTicketStatus>().notNull().default('open'),
    substatus: text('substatus'),
    /**
     * Free-form triage labels. Filtered with `tags @> ARRAY[...]` over a GIN index (created in the
     * migration, not here — the repo hand-writes idempotent migrations). Empty array, never null, so a
     * reader never has to null-check.
     */
    tags: text('tags').array().notNull().default([]),

    // --- requester ---
    requesterKind: text('requester_kind').$type<CommsRequesterKind>().notNull(),
    /** Worker requester. Also the key an escalation is personal to. */
    requesterZohoUserId: text('requester_zoho_user_id'),
    /** Carrier requester (mini-app). Same id space as the client linkage below. */
    requesterCarrierId: text('requester_carrier_id'),
    /** Snapshot: the Zoho username, or the company name for a carrier. */
    requesterName: text('requester_name').notNull(),

    // --- assignment ---
    assigneeZohoUserId: text('assignee_zoho_user_id'),
    assigneeName: text('assignee_name'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    /** How the current assignee got it, so the queue can explain itself. */
    assignmentReason: text('assignment_reason').$type<'auto' | 'claimed' | 'manual' | 'default'>(),

    // --- client linkage: carrier_id + company_name, and nothing else ---
    carrierId: text('carrier_id'),
    companyName: text('company_name'),

    /**
     * Operational payload carried by specific ticket types (a card replacement needs the card, a
     * deal-scoped ticket needs the deal). NOT client identity — that is carrier_id + company_name.
     * Full card values are never logged or placed in audit detail; card_last4 is for display.
     */
    applicationId: text('application_id'),
    crmDealId: text('crm_deal_id'),
    cardNumber: text('card_number'),
    cardLast4: text('card_last4'),

    channel: text('channel').$type<CommsTicketChannel>().notNull().default('web'),
    source: text('source').$type<CommsTicketSource>().notNull().default('worker'),

    // --- SLA: resolution and first response are tracked separately, as Zoho does ---
    slaHours: integer('sla_hours'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    firstResponseDueAt: timestamp('first_response_due_at', { withTimezone: true }),
    firstResponseAt: timestamp('first_response_at', { withTimezone: true }),
    /** When it actually breached — a timestamp, not Desk's boolean, so you learn *when*. */
    breachedAt: timestamp('breached_at', { withTimezone: true }),

    // --- escalation position, denormalized for list rendering (detail is in mytrion_escalations) ---
    escalationId: text('escalation_id'),
    /** 1 requester · 2 agent · 3 department manager · 4 C-Level. */
    escalationLevel: integer('escalation_level'),
    escalationLevelLabel: text('escalation_level_label'),

    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedByZohoUserId: text('resolved_by_zoho_user_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    reopenedAt: timestamp('reopened_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    closeReason: text('close_reason'),

    /** Optimistic concurrency: a stale transition 409s instead of last-write-wins. */
    version: integer('version').notNull().default(1),
    /** Replay safety for webhook/mini-app ingest. */
    idempotencyKey: text('idempotency_key'),
    createdByZohoUserId: text('created_by_zoho_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    numberUk: uniqueIndex('mytrion_tickets_tenant_number_uk').on(table.tenantId, table.number),
    threadUk: uniqueIndex('mytrion_tickets_tenant_thread_uk').on(table.tenantId, table.threadId),
    /** Department queue. */
    queueIdx: index('mytrion_tickets_queue_idx').on(
      table.tenantId,
      table.targetDepartment,
      table.status,
      table.priority,
      table.createdAt,
    ),
    /** "Assigned to me". */
    assigneeIdx: index('mytrion_tickets_assignee_idx').on(
      table.tenantId,
      table.assigneeZohoUserId,
      table.status,
      table.dueAt,
    ),
    /** "Tickets I raised" — the requester side, and the Requests tab. */
    requesterIdx: index('mytrion_tickets_requester_idx').on(
      table.tenantId,
      table.requesterZohoUserId,
      table.status,
      table.createdAt,
    ),
    /** All tickets for one client. */
    carrierIdx: index('mytrion_tickets_carrier_idx').on(
      table.tenantId,
      table.carrierId,
      table.createdAt,
    ),
    /** SLA sweeper. */
    dueIdx: index('mytrion_tickets_due_idx').on(table.tenantId, table.status, table.dueAt),
    idemUk: uniqueIndex('mytrion_tickets_idem_uk').on(
      table.tenantId,
      table.source,
      table.idempotencyKey,
    ),
  }),
);

/** Append-only journal. Every assignment, transition and escalation hop lands here with a reason. */
export const mytrionTicketEvents = pgTable(
  'mytrion_ticket_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtke_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    ticketId: text('ticket_id').notNull(),
    threadId: text('thread_id'),
    eventType: text('event_type').$type<CommsTicketEventType>().notNull(),
    /** NULL for a system actor (the auto-assigner, the SLA sweeper). */
    actorZohoUserId: text('actor_zoho_user_id'),
    actorName: text('actor_name'),
    fromStatus: text('from_status').$type<CommsTicketStatus>(),
    toStatus: text('to_status').$type<CommsTicketStatus>(),
    /** Why: `{ reason: 'round_robin' | 'no_online_agent' | 'deferred_sweep', ... }`. */
    detail: text('detail'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    ticketTimeIdx: index('mytrion_ticket_events_ticket_time_idx').on(
      table.tenantId,
      table.ticketId,
      table.occurredAt,
    ),
  }),
);

export type MytrionTicketType = typeof mytrionTicketTypes.$inferSelect;
export type NewMytrionTicketType = typeof mytrionTicketTypes.$inferInsert;
export type MytrionTicket = typeof mytrionTickets.$inferSelect;
export type NewMytrionTicket = typeof mytrionTickets.$inferInsert;
export type MytrionTicketEvent = typeof mytrionTicketEvents.$inferSelect;
export type NewMytrionTicketEvent = typeof mytrionTicketEvents.$inferInsert;
