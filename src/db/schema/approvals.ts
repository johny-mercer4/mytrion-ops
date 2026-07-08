import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Human-in-the-loop write approvals: when FF_WRITE_APPROVALS is on, a write/destructive tool
 * call proposed BY AN AGENT is parked here instead of executing; an admin approves/denies via
 * /v1/approvals. ctx_snapshot preserves the proposer's authority — the executor re-checks
 * access against it at execution time (catches policy drift between proposal and approval).
 */
export const approvals = pgTable(
  'approvals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id'),
    /** Proposing principal (ctx.userId) — the authority the execution will run under. */
    requestedBy: text('requested_by').notNull(),
    actingAgent: text('acting_agent'),
    agentRunId: text('agent_run_id'),
    toolName: text('tool_name').notNull(),
    riskClass: text('risk_class').$type<'write' | 'destructive'>().notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull().default({}),
    reason: text('reason'),
    ctxSnapshot: jsonb('ctx_snapshot').$type<Record<string, unknown>>().notNull(),
    status: text('status')
      .$type<'pending' | 'approved' | 'denied' | 'expired' | 'executed' | 'failed'>()
      .notNull()
      .default('pending'),
    approvedBy: text('approved_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    result: jsonb('result').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index('approvals_tenant_status_idx').on(table.tenantId, table.status, table.createdAt),
  }),
);

export type Approval = typeof approvals.$inferSelect;
export type NewApproval = typeof approvals.$inferInsert;
