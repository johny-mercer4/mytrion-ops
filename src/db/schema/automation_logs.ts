import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

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
export const AUTOMATION_PHASES = ['started', 'succeeded', 'failed'] as const;
export type AutomationPhase = (typeof AUTOMATION_PHASES)[number];
/**
 * What a caller may write: ONE row per submit, at the outcome.
 *
 * 'started' stays in `AUTOMATION_PHASES` only so the 24 rows written on 2026-08-20 still read back
 * as their own phase — the endpoint no longer accepts it. A submit that produced a `started` row
 * and then a `succeeded` row put two records in the table for one click, which is what the
 * Automation Logs tab is meant to count once.
 */
export const AUTOMATION_TERMINAL_PHASES = ['succeeded', 'failed'] as const;

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
    runId: text('run_id')
      .notNull()
      .$defaultFn(() => createId()),
    phase: text('phase').$type<AutomationPhase>().notNull().default('succeeded'),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    sourceMytrion: text('source_mytrion').notNull().default('sales'),
    actorUserId: text('actor_user_id'),
    impersonatorUserId: text('impersonator_user_id'),
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
    tenantRunPhaseUk: uniqueIndex('automation_logs_tenant_run_phase_uk').on(
      table.tenantId,
      table.runId,
      table.phase,
    ),
    tenantRunTerminalUk: uniqueIndex('automation_logs_tenant_run_terminal_uk')
      .on(table.tenantId, table.runId)
      .where(sql`${table.phase} in ('succeeded', 'failed')`),
    tenantActorTimeIdx: index('automation_logs_tenant_actor_time_idx').on(
      table.tenantId,
      table.actorUserId,
      table.createdAt,
    ),
  }),
);

export type AutomationLog = typeof automationLogs.$inferSelect;
export type NewAutomationLog = typeof automationLogs.$inferInsert;
