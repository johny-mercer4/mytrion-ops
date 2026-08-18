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
    /** Actor display name (worker user_name / carrier login) — who a human reads this row as. */
    userName: text('user_name'),
    /** Actor's external profile(s) — Zoho profile for workers, access profile for carrier users. */
    profile: text('profile'),
    /** Actor's external (Zoho) role name. */
    callerRole: text('caller_role'),
    /** Internal RBAC role the request ran with ('admin' | 'worker' | 'viewer' | …). */
    role: text('role'),
    /** Carrier/application tag(s) for customer-audience actors — "which company did this". */
    company: text('company'),
    /** Real admin's userId when the action ran under "act as agent" impersonation. */
    impersonatorUserId: text('impersonator_user_id'),
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
    /**
     * The Admin Audit Log filters on these columns directly (agent name / profile / role), and the
     * facet endpoint runs a DISTINCT over each. Without them every filtered page was a seq scan
     * over the whole table — 41k rows in 30 days and growing.
     */
    userNameIdx: index('audit_log_user_name_idx').on(table.tenantId, table.userName),
    profileIdx: index('audit_log_profile_idx').on(table.tenantId, table.profile),
    roleIdx: index('audit_log_role_idx').on(table.tenantId, table.role),
    callerRoleIdx: index('audit_log_caller_role_idx').on(table.tenantId, table.callerRole),
    /** Action + time — the Logins / Mytrion-access views, and the login-throttle lookback. */
    actionCreatedIdx: index('audit_log_action_created_idx').on(
      table.tenantId,
      table.action,
      table.createdAt,
    ),
    /** 'which Mytrion did this touch' — mytrion.access rows key on (resource_type, resource_id). */
    resourceIdx: index('audit_log_resource_idx').on(
      table.tenantId,
      table.resourceType,
      table.resourceId,
    ),
    tenantUserTimeIdx: index('audit_log_tenant_user_time_idx').on(
      table.tenantId,
      table.userId,
      table.createdAt,
    ),
  }),
);

// Note: no FK on tenantId — audit rows must survive tenant deletion for compliance.

export type AuditEntry = typeof auditLog.$inferSelect;
export type NewAuditEntry = typeof auditLog.$inferInsert;
