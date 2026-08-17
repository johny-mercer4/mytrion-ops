import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Which surface fired the automation.
 *
 * 'Mytrion Zoho' is the DEFAULT ON PURPOSE, and it is a fallback rather than a guess: every row
 * written before this column existed came from either the legacy Zoho widget or Horizon, and the
 * two are indistinguishable after the fact. Defaulting the backfill to Zoho keeps the new value
 * honest — a row reading 'Mytrion Horizon' is one a Horizon caller explicitly claimed.
 */
export const AUTOMATION_ORIGIN_SOURCES = ['Mytrion Horizon', 'Mytrion Zoho'] as const;
export type AutomationOriginSource = (typeof AUTOMATION_ORIGIN_SOURCES)[number];
export const DEFAULT_AUTOMATION_ORIGIN: AutomationOriginSource = 'Mytrion Zoho';

/**
 * Automation_Logs — an append-only log of automation triggers, written from the front-end
 * (Horizon CRM or the legacy Zoho widget) via POST /v1/automation/logs. Trigger time/date are
 * stored as the strings the caller sends (pass-through); `created_at` is the authoritative
 * server time.
 *
 * Scope: one row per catalog block A PERSON triggered. The scheduled department automations
 * deliberately do NOT write here — a cron-run agent job fits neither origin, and it surfaced in
 * the Automation Logs tab as a type that appears in no catalog. Those runs are recorded by
 * `agent_tasks` + the `agent.turn` audit row instead (see jobs/workers/automations.ts).
 * ~38 rows written before that decision remain; this table is append-only.
 */
export const automationLogs = pgTable(
  'automation_logs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    triggerTime: text('trigger_time'),
    triggerDate: text('trigger_date'),
    automationType: text('automation_type').notNull(),
    agentName: text('agent_name'),
    /** Picklist — see AUTOMATION_ORIGIN_SOURCES. Never null; defaults to 'Mytrion Zoho'. */
    originSource: text('origin_source')
      .$type<AutomationOriginSource>()
      .notNull()
      .default(DEFAULT_AUTOMATION_ORIGIN),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('automation_logs_tenant_idx').on(table.tenantId, table.createdAt),
    typeIdx: index('automation_logs_type_idx').on(table.automationType),
    originIdx: index('automation_logs_origin_idx').on(table.tenantId, table.originSource),
    agentIdx: index('automation_logs_agent_idx').on(table.tenantId, table.agentName),
  }),
);

export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;
