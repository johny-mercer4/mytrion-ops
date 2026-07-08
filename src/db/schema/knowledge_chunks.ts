import { createId } from '@paralleldrive/cuid2';
import { sql, type SQL } from 'drizzle-orm';
import { customType, index, integer, jsonb, pgTable, text, timestamp, vector } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/** Postgres tsvector — drizzle has no built-in; value is read-only (generated column). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

/**
 * A chunk of a knowledge doc plus its embedding. `embedding` is a pgvector column;
 * dimension 1536 matches OpenAI text-embedding-3-small (see EMBEDDING_DIMENSIONS).
 * The HNSW index uses cosine distance — match it in the retriever's ORDER BY.
 * `content_tsv` is a stored generated column powering the hybrid (BM25-ish) retrieval leg.
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
    /** Mirrors the parent doc's department for RBAC-filtered retrieval. NULL = global. */
    departmentAccess: text('department_access'),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    embedding: vector('embedding', { dimensions: 1536 }),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', ${knowledgeChunks.content})`,
    ),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    docIdx: index('knowledge_chunks_doc_idx').on(table.docId),
    tenantIdx: index('knowledge_chunks_tenant_idx').on(table.tenantId, table.audience),
    deptIdx: index('knowledge_chunks_dept_idx').on(table.tenantId, table.departmentAccess),
    embeddingIdx: index('knowledge_chunks_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    tsvIdx: index('knowledge_chunks_tsv_idx').using('gin', table.contentTsv),
  }),
);

export type KnowledgeChunk = typeof knowledgeChunks.$inferSelect;
export type NewKnowledgeChunk = typeof knowledgeChunks.$inferInsert;
