import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * User-visible background tasks (pg-boss jobs with progress/result tracking): async agent runs,
 * scheduled department automations, bulk ingests, report generation. The pg-boss `pgboss.job`
 * row is the execution record; this row is the product-facing one.
 */
export const agentTasks = pgTable(
  'agent_tasks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    /** Requester (e.g. 'zoho:123') or 'system:scheduler' for cron automations. */
    userId: text('user_id'),
    /** 'agent.run' | 'automation.<key>' | 'knowledge.bulk_ingest' | 'report.generate'. */
    kind: text('kind').notNull(),
    queue: text('queue').notNull(),
    /** pg-boss job id (uuid) — used for cancel. */
    jobId: text('job_id'),
    status: text('status')
      .$type<'queued' | 'running' | 'completed' | 'failed' | 'cancelled'>()
      .notNull()
      .default('queued'),
    progress: jsonb('progress').$type<Record<string, unknown>>().notNull().default({}),
    request: jsonb('request').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<Record<string, unknown>>(),
    error: text('error'),
    conversationId: text('conversation_id'),
    fileId: text('file_id'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('agent_tasks_tenant_idx').on(table.tenantId, table.status, table.createdAt),
    userIdx: index('agent_tasks_user_idx').on(table.tenantId, table.userId, table.createdAt),
  }),
);

export type AgentTask = typeof agentTasks.$inferSelect;
export type NewAgentTask = typeof agentTasks.$inferInsert;
