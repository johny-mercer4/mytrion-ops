import { createId } from '@paralleldrive/cuid2';
import { index, integer, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

/** A source document. Chunks + embeddings live in knowledge_chunks. */
export const knowledgeDocs = pgTable(
  'knowledge_docs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    audience: text('audience').$type<Audience>().notNull(),
    title: text('title').notNull(),
    /** Department this doc belongs to for RBAC. NULL = shared/global (all departments). */
    departmentAccess: text('department_access'),
    source: text('source'),
    mimeType: text('mime_type'),
    status: text('status')
      .$type<'pending' | 'processing' | 'ready' | 'failed'>()
      .notNull()
      .default('pending'),
    /** sha256 of raw content, for idempotent re-ingest. */
    checksum: text('checksum'),
    chunkCount: integer('chunk_count').notNull().default(0),
    error: text('error'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('knowledge_docs_tenant_idx').on(table.tenantId, table.audience),
    checksumIdx: index('knowledge_docs_checksum_idx').on(table.tenantId, table.checksum),
    deptIdx: index('knowledge_docs_dept_idx').on(table.tenantId, table.departmentAccess),
  }),
);

export type KnowledgeDoc = typeof knowledgeDocs.$inferSelect;
export type NewKnowledgeDoc = typeof knowledgeDocs.$inferInsert;
