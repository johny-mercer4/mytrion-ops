/**
 * Append-only assignment log for the Verification desk.
 *
 * Its own file rather than another table in `verification_flow.ts`: that file is at the 600-line cap
 * and this is a satellite of the case, not part of the flow's own state — the same reason
 * `retention_ownership_transfers.ts` sits beside `retention_cases.ts`.
 */
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

/**
 * WHO THE DESK GAVE EACH CASE TO, and when. Append-only.
 *
 * `verification_cases.verification_owner_zoho_user_id` is the CURRENT credit agent — one column, read
 * on every queue row. This is the history behind it, and it exists for two jobs that a single column
 * cannot do:
 *
 *  1. **Fairness.** Stage-0 routing picks the credit agent who was assigned LEAST RECENTLY, so it
 *     needs `max(assigned_at)` per agent. Deriving that from the case row would break the moment a
 *     case is reassigned — the previous agent's turn would vanish with it.
 *  2. **Answering "why me".** An agent who inherits a case, or loses one, can be shown when it moved
 *     and what moved it. No cursor is stored anywhere: the rotation is a consequence of these rows,
 *     which is the same argument `mytrion_comms_routing` makes for its own least-recently-assigned
 *     claim rather than a counter that can drift out of step with reality.
 *
 * `reason` is the mechanism, not prose — `stage0_round_robin` today, and whatever a manual reassign or
 * an escalation calls itself later.
 */
export const verificationCaseAssignments = pgTable(
  'verification_case_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vca_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    /** The credit agent this case went to. */
    zohoUserId: text('zoho_user_id').notNull(),
    /** Directory name AT assignment time — a later rename must not rewrite history. */
    assigneeName: text('assignee_name'),
    /** Who it moved from, when it is a reassignment rather than the first assignment. */
    previousZohoUserId: text('previous_zoho_user_id'),
    /** 'stage0_round_robin' | 'manual' | … */
    reason: text('reason').notNull().default('stage0_round_robin'),
    /** The actor, when a human did it. NULL for the poller. */
    assignedByZohoUserId: text('assigned_by_zoho_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** The fairness probe: latest assignment per agent within a tenant. */
    tenantAgentTimeIdx: index('verification_case_assignments_tenant_agent_idx').on(
      table.tenantId,
      table.zohoUserId,
      table.assignedAt,
    ),
    /** One case's history, newest first. */
    tenantCaseIdx: index('verification_case_assignments_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
      table.assignedAt,
    ),
  }),
);

export type VerificationCaseAssignment = typeof verificationCaseAssignments.$inferSelect;
