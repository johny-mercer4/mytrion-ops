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

/**
 * How a new ticket picks an assignee.
 *
 * `round_robin` = the least-recently-assigned eligible agent. Chosen over a strict rotation cursor
 * because a cursor needs a write per assignment (serialising every create in the department on one
 * row), corrupts whenever the pool changes, and — decisively — is presence-blind, so it gives an
 * agent online one hour a day the same share as one online all day. Least-recently-assigned
 * self-heals and composes with presence for free: an agent who was offline has a stale timestamp and
 * is first in line when they return, which is correct — they are owed work.
 */
export type TicketAssignmentStrategy = 'round_robin' | 'least_open' | 'manual';

/**
 * The explicit, admin-managed pool of people for a department.
 *
 * Two jobs:
 *   1. Ticket round-robin for an operational department (`customer-service`, `billing`, …).
 *   2. **ESCALATION LEVEL 4** — the `c-level` pool, which holds CEO and COO. Level 4 is not one
 *      person, so it cannot be a single column; it is a pool whose members carry a `role_title`
 *      and are picked explicitly by the escalating manager (strategy `manual`).
 *
 * Explicit rather than derived, because who works a queue is an operational decision and not a
 * side effect of access control. Deriving from `worker_mytrion_access` would auto-assign live client
 * tickets to every admin and every read-only viewer who can merely open the Mytrion; deriving from
 * `hr_employees.department_id` conflates being in a department with being on the rota (a department
 * head, a trainee and someone on parental leave are all "in" CS).
 *
 * `hr_employees` and `hr_departments` are the CANDIDATE SOURCE for the Mytrion Admin pickers —
 * `hr_employees.zoho_user_id` supplies the routing key and `hr_departments.lead_employee_id`
 * pre-selects a likely manager — but the row written here is what routes. HR suggests; this decides.
 * That split matters because `hr_employees.zoho_user_id` is nullable and heuristic, and a NULL there
 * must never be treated as a wildcard.
 */
export const mytrionDepartmentAgents = pgTable(
  'mytrion_department_agents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mda_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    department: text('department').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    /** Snapshot so a roster renders without a Zoho round trip. */
    displayName: text('display_name'),
    /**
     * Human label for this person's seat in the pool — 'CEO', 'COO', 'Team Lead', 'Senior Agent'.
     * Load-bearing for the `c-level` pool, where an escalating manager picks a specific person and
     * "Escalate to CEO" has to be distinguishable from "Escalate to COO" in the UI.
     * Advisory only: it never affects routing, which goes by zoho_user_id.
     */
    roleTitle: text('role_title'),
    /** Off the rota entirely (left the team, long leave) — distinct from temporarily not accepting. */
    active: boolean('active').notNull().default(true),
    /** Admin-side "do not send this agent new work", separate from the agent's own availability. */
    acceptsNew: boolean('accepts_new').notNull().default(true),
    /** Concurrency cap. NULL = uncapped. Bounds the burst an agent gets after time off. */
    maxOpen: integer('max_open'),
    sortOrder: integer('sort_order').notNull().default(0),
    /** The round-robin ordering key: oldest first. NULL sorts first, so a new member goes next. */
    lastAssignedAt: timestamp('last_assigned_at', { withTimezone: true }),
    assignedCount: integer('assigned_count').notNull().default(0),
    addedByZohoUserId: text('added_by_zoho_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberUk: uniqueIndex('mytrion_department_agents_dept_user_uk').on(
      table.tenantId,
      table.department,
      table.zohoUserId,
    ),
    /** THE selector index: eligible members of a department, least-recently-assigned first. */
    poolIdx: index('mytrion_department_agents_pool_idx').on(
      table.tenantId,
      table.department,
      table.active,
      table.acceptsNew,
      table.lastAssignedAt,
    ),
    /** "Which pools is this agent on" — drives the availability control's visibility. */
    agentIdx: index('mytrion_department_agents_agent_idx').on(table.tenantId, table.zohoUserId),
  }),
);

/**
 * Per-department routing configuration — one row per department, one admin screen.
 *
 * Note what is NOT here: the escalation fall-to user. Escalation routing is keyed on the REASON
 * ("based on escalation reason they default fall to the particular user, for example CS Agent"), so
 * that lives on `mytrion_ticket_types.default_assignee_zoho_user_id` for rows with
 * `kind='escalation_reason'`. This table owns ticket assignment and the level-3 manager.
 */
export const mytrionDepartmentConfig = pgTable(
  'mytrion_department_config',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mdcf_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    department: text('department').notNull(),
    ticketAssignmentStrategy: text('ticket_assignment_strategy')
      .$type<TicketAssignmentStrategy>()
      .notNull()
      .default('round_robin'),
    /**
     * Whether an assignee must be socket-live to be eligible. Lets the pool be populated and
     * exercised before presence is switched on, and is the kill switch if presence misbehaves.
     */
    requireOnline: boolean('require_online').notNull().default(true),
    /** Fallback when the strategy is 'manual', or when the pool yields nobody and a human is preferred. */
    defaultAssigneeZohoUserId: text('default_assignee_zoho_user_id'),
    /**
     * ESCALATION LEVEL 3 — the department manager / Department Lead an escalation rises to from the
     * agent level. Configured explicitly rather than read from `hr_departments.lead_employee_id`
     * because that resolves through `hr_employees.zoho_user_id`, which is nullable and heuristic —
     * and a NULL there must never be treated as a wildcard. HR remains the fallback to *suggest* a
     * value in the admin UI, never to route silently.
     */
    managerZohoUserId: text('manager_zoho_user_id'),
    managerName: text('manager_name'),
    /** Department can be the target of new tickets. */
    acceptsTickets: boolean('accepts_tickets').notNull().default(true),
    /** Department can receive a sideways escalation hand-off. */
    acceptsEscalations: boolean('accepts_escalations').notNull().default(true),
    slaHoursOverride: integer('sla_hours_override'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    departmentUk: uniqueIndex('mytrion_department_config_dept_uk').on(
      table.tenantId,
      table.department,
    ),
  }),
);

export type MytrionDepartmentAgent = typeof mytrionDepartmentAgents.$inferSelect;
export type NewMytrionDepartmentAgent = typeof mytrionDepartmentAgents.$inferInsert;
export type MytrionDepartmentConfig = typeof mytrionDepartmentConfig.$inferSelect;
export type NewMytrionDepartmentConfig = typeof mytrionDepartmentConfig.$inferInsert;
