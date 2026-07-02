import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, real, text, timestamp, vector } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/**
 * Long-term agent memory — model-DISTILLED facts, deliberately separate from knowledge_docs:
 * different trust level (always rendered UNTRUSTED, never cited as authoritative KB), and a
 * decay/eviction lifecycle instead of checksum-idempotent ingest.
 */
export const agentMemories = pgTable(
  'agent_memories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    /** 'billing', 'sales', … or 'orchestrator'. */
    agentKey: text('agent_key').notNull(),
    /** Same semantics as knowledge_chunks (NULL = tenant-global). */
    departmentAccess: text('department_access'),
    /** Optional per-user memory (conversation preferences). */
    userId: text('user_id'),
    kind: text('kind').$type<'fact' | 'preference' | 'summary'>().notNull().default('fact'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    importance: real('importance').notNull().default(0.5),
    accessCount: integer('access_count').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantAgentIdx: index('agent_memories_tenant_idx').on(table.tenantId, table.agentKey),
    embeddingIdx: index('agent_memories_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  }),
);

export type AgentMemory = typeof agentMemories.$inferSelect;
export type NewAgentMemory = typeof agentMemories.$inferInsert;
