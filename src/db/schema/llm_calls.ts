import { createId } from '@paralleldrive/cuid2';
import { index, integer, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const llmCalls = pgTable(
  'llm_calls',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    conversationId: text('conversation_id'),
    agentRunId: text('agent_run_id'),
    role: text('role').notNull(),
    provider: text('provider').$type<'openai' | 'groq' | 'glm'>().notNull(),
    model: text('model').notNull(),
    status: text('status').$type<'ok' | 'error'>().notNull(),
    latencyMs: integer('latency_ms'),
    ttftMs: integer('ttft_ms'),
    inputTokens: integer('input_tokens').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    reasoningTokens: integer('reasoning_tokens').notNull().default(0),
    estimatedCost: numeric('estimated_cost', { precision: 12, scale: 6 }).notNull().default('0'),
    retryCount: integer('retry_count').notNull().default(0),
    fallbackFrom: text('fallback_from'),
    requestHash: text('request_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index('llm_calls_tenant_created_idx').on(table.tenantId, table.createdAt),
    agentRunIdx: index('llm_calls_agent_run_idx').on(table.tenantId, table.agentRunId),
    modelIdx: index('llm_calls_model_idx').on(table.tenantId, table.provider, table.model, table.createdAt),
  }),
);

export type LlmCall = typeof llmCalls.$inferSelect;
export type NewLlmCall = typeof llmCalls.$inferInsert;
