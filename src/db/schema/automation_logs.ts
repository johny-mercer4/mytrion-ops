import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Automation_Logs — a simple append-only log of automation triggers, written from the
 * front-end (Zoho widget) via POST /v1/automation/logs. Trigger time/date are stored as
 * the strings the caller sends (pass-through); `created_at` is the authoritative server time.
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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('automation_logs_tenant_idx').on(table.tenantId, table.createdAt),
    typeIdx: index('automation_logs_type_idx').on(table.automationType),
  }),
);

export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;
