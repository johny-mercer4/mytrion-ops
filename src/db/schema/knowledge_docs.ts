import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { Audience } from '../../types/tenantContext.js';

export type KnowledgeDomain = 'operations' | 'platform';
export type KnowledgeAuthorityClass = 'canonical' | 'runtime-generated' | 'manual' | 'external';
export type KnowledgeVerificationStatus = 'unverified' | 'verified' | 'stale' | 'superseded';

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
    /** Where the content came from: 'upload' | 'file' | 'api' | 'url'. */
    origin: text('origin'),
    domain: text('domain').$type<KnowledgeDomain>().notNull().default('operations'),
    language: text('language').notNull().default('en'),
    authorityClass: text('authority_class')
      .$type<KnowledgeAuthorityClass>()
      .notNull()
      .default('manual'),
    owner: text('owner'),
    sourceVersion: text('source_version').notNull().default('1'),
    sourceCommit: text('source_commit'),
    supersedesDocId: text('supersedes_doc_id'),
    verificationStatus: text('verification_status')
      .$type<KnowledgeVerificationStatus>()
      .notNull()
      .default('unverified'),
    /** Freshness lifecycle: retrieval demotes docs past expiry or unverified beyond STALE_DOC_DAYS. */
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantIdx: index('knowledge_docs_tenant_idx').on(table.tenantId, table.audience),
    checksumIdx: index('knowledge_docs_checksum_idx').on(table.tenantId, table.checksum),
    checksumUnique: uniqueIndex('knowledge_docs_tenant_audience_checksum_uidx')
      .on(table.tenantId, table.audience, table.checksum)
      .where(sql`${table.checksum} is not null`),
    deptIdx: index('knowledge_docs_dept_idx').on(table.tenantId, table.departmentAccess),
    domainIdx: index('knowledge_docs_domain_idx').on(table.tenantId, table.audience, table.domain),
  }),
);

export type KnowledgeDoc = typeof knowledgeDocs.$inferSelect;
export type NewKnowledgeDoc = typeof knowledgeDocs.$inferInsert;
