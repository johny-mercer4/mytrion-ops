import { createId } from '@paralleldrive/cuid2';
import { boolean, index, integer, jsonb, numeric, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const ragRuns = pgTable(
  'rag_runs',
  {
    id: text('id').primaryKey().$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    userId: text('user_id').notNull(),
    conversationId: text('conversation_id'),
    agentRunId: text('agent_run_id'),
    queryHash: text('query_hash').notNull(),
    route: text('route').$type<'none' | 'knowledge' | 'tool' | 'external'>().notNull(),
    grade: text('grade').notNull(),
    confidence: numeric('confidence', { precision: 5, scale: 4 }).notNull().default('0'),
    abstained: boolean('abstained').notNull().default(false),
    hops: integer('hops').notNull().default(0),
    candidateCount: integer('candidate_count').notNull().default(0),
    selectedCount: integer('selected_count').notNull().default(0),
    retrievalStrategy: text('retrieval_strategy').notNull().default('exact'),
    durationMs: integer('duration_ms'),
    stageTrace: jsonb('stage_trace').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCreatedIdx: index('rag_runs_tenant_created_idx').on(table.tenantId, table.createdAt),
    agentRunIdx: index('rag_runs_agent_run_idx').on(table.tenantId, table.agentRunId),
  }),
);

export type RagRun = typeof ragRuns.$inferSelect;
export type NewRagRun = typeof ragRuns.$inferInsert;
