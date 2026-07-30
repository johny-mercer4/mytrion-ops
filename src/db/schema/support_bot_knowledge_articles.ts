import { createId } from '@paralleldrive/cuid2';
import { sql, type SQL } from 'drizzle-orm';
import {
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const SUPPORT_BOT_GLOBAL_CARRIER = '*';

/**
 * Published, client-safe support knowledge. This table is intentionally separate from generic
 * Mytrion knowledge and per-user memory so carrier overlays can never enter another retrieval
 * path accidentally.
 */
export const supportBotKnowledgeArticles = pgTable(
  'support_bot_knowledge_articles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    /** `*` = tenant-global; otherwise this article is visible to exactly one carrier. */
    carrierId: text('carrier_id').notNull().default(SUPPORT_BOT_GLOBAL_CARRIER),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    content: text('content').notNull(),
    /** Open locale map (BCP-47 keys); English canonical content is not a language allow-list. */
    translations: jsonb('translations')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    /** Search synonyms/Telegram vocabulary, never authorization instructions. */
    keywords: text('keywords').notNull().default(''),
    /** Null = always available; otherwise hidden when the deployment service is disabled. */
    serviceId: text('service_id'),
    knowledgeType: text('knowledge_type')
      .$type<'static' | 'workflow' | 'tool_pointer'>()
      .notNull()
      .default('static'),
    riskClass: text('risk_class')
      .$type<'read' | 'write' | 'sensitive'>()
      .notNull()
      .default('read'),
    status: text('status')
      .$type<'draft' | 'published' | 'archived'>()
      .notNull()
      .default('draft'),
    source: text('source'),
    sourceEvidence: jsonb('source_evidence')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    version: integer('version').notNull().default(1),
    effectiveAt: timestamp('effective_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    embedding: vector('embedding', { dimensions: 1536 }),
    contentTsv: tsvector('content_tsv').generatedAlwaysAs(
      (): SQL =>
        sql`to_tsvector('simple', coalesce(${supportBotKnowledgeArticles.title}, '') || ' ' || coalesce(${supportBotKnowledgeArticles.content}, '') || ' ' || coalesce(${supportBotKnowledgeArticles.keywords}, ''))`,
    ),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeSlugUq: uniqueIndex('support_bot_knowledge_scope_slug_uq').on(
      table.tenantId,
      table.carrierId,
      table.slug,
    ),
    scopeStatusIdx: index('support_bot_knowledge_scope_status_idx').on(
      table.tenantId,
      table.carrierId,
      table.status,
    ),
    serviceIdx: index('support_bot_knowledge_service_idx').on(
      table.tenantId,
      table.serviceId,
    ),
    embeddingIdx: index('support_bot_knowledge_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
    tsvIdx: index('support_bot_knowledge_tsv_idx').using('gin', table.contentTsv),
  }),
);

export type SupportBotKnowledgeArticle =
  typeof supportBotKnowledgeArticles.$inferSelect;
export type NewSupportBotKnowledgeArticle =
  typeof supportBotKnowledgeArticles.$inferInsert;
