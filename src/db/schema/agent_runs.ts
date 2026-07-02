import { createId } from '@paralleldrive/cuid2';
import { index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * One row per orchestrator/child-agent run: which agent ran, for which conversation/thread,
 * with what outcome and token/cost usage. Powers per-agent cost attribution and debugging;
 * tool_calls.agent_run_id links every tool call back to its run.
 */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id'),
    /** LangGraph thread id (`<tenantId>:<conversationId>`) when checkpointing is on. */
    threadId: text('thread_id'),
    /** 'orchestrator' or a child AgentKey ('billing', 'sales', …). */
    agentKey: text('agent_key').notNull(),
    status: text('status').$type<'ok' | 'error'>().notNull(),
    model: text('model'),
    promptTokens: integer('prompt_tokens').notNull().default(0),
    completionTokens: integer('completion_tokens').notNull().default(0),
    totalCost: numeric('total_cost', { precision: 12, scale: 6 }).notNull().default('0'),
    durationMs: integer('duration_ms'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantConvIdx: index('agent_runs_tenant_conv_idx').on(table.tenantId, table.conversationId),
    tenantAgentIdx: index('agent_runs_tenant_agent_idx').on(table.tenantId, table.agentKey, table.createdAt),
  }),
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;
