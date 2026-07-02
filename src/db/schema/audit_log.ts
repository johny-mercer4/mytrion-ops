import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/** Append-only audit trail. Every chat turn, tool call, and auth event lands here. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>(),
    userId: text('user_id'),
    /** e.g. 'auth.login', 'chat.turn', 'tool.call', 'knowledge.embed'. */
    action: text('action').notNull(),
    resourceType: text('resource_type'),
    resourceId: text('resource_id'),
    toolName: text('tool_name'),
    status: text('status').$type<'ok' | 'denied' | 'error'>().notNull(),
    /** Child agent acting on the caller's behalf — audit attribution for multi-agent runs. */
    actingAgent: text('acting_agent'),
    agentRunId: text('agent_run_id'),
    detail: jsonb('detail').$type<Record<string, unknown>>(),
    requestId: text('request_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('audit_log_tenant_idx').on(table.tenantId, table.createdAt),
    actionIdx: index('audit_log_action_idx').on(table.action),
  }),
);

// Note: no FK on tenantId — audit rows must survive tenant deletion for compliance.

export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
