import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/**
 * A chunk of a knowledge doc plus its embedding. `embedding` is a pgvector column;
 * dimension 1536 matches OpenAI text-embedding-3-small (see EMBEDDING_DIMENSIONS).
 * The HNSW index uses cosine distance — match it in the retriever's ORDER BY.
 */
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    docId: text('doc_id').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    embedding: vector('embedding', { dimensions: 1536 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docIdx: index('knowledge_chunks_doc_idx').on(table.docId),
    tenantIdx: index('knowledge_chunks_tenant_idx').on(table.tenantId, table.audience),
    embeddingIdx: index('knowledge_chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  }),
);

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert;
