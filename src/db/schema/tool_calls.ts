import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** One row per dispatched tool call. Powers audit + cost + debugging. */
export const toolCalls = pgTable(
  'tool_calls',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    conversationId: text('conversation_id'),
    /** The id of the assistant message that requested this call (OpenAI tool_call id). */
    requestId: text('request_id'),
    toolName: text('tool_name').notNull(),
    riskClass: text('risk_class').$type<'read' | 'write' | 'destructive'>().notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull().default({}),
    result: jsonb('result').$type<unknown>(),
    status: text('status').$type<'ok' | 'error' | 'denied'>().notNull(),
    errorMessage: text('error_message'),
    durationMs: integer('duration_ms'),
    /** Child agent acting on the caller's behalf ('billing', …) — attribution, never authority. */
    actingAgent: text('acting_agent'),
    /** Groups every tool call of one orchestrator/child run (agent_runs.id). */
    agentRunId: text('agent_run_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    conversationIdx: index('tool_calls_conversation_idx').on(table.conversationId),
    tenantIdx: index('tool_calls_tenant_idx').on(table.tenantId, table.createdAt),
    agentRunIdx: index('tool_calls_agent_run_idx').on(table.tenantId, table.agentRunId),
  }),
);

export type ToolCall = typeof toolCalls.$inferSelect;
export type NewToolCall = typeof toolCalls.$inferInsert;
