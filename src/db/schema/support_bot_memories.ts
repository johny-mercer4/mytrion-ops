import { createId } from '@paralleldrive/cuid2';
import {
  index,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';

/**
 * Telegram support-agent semantic history. Deliberately separate from `agent_memories` and
 * `knowledge_chunks`: every row is scoped to one tenant + carrier + Telegram chat + user.
 * Content is sanitized before insert and is always rendered back to the model as untrusted.
 */
export const supportBotMemories = pgTable(
  'support_bot_memories',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sbm_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    chatId: text('chat_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    kind: text('kind').$type<'turn_summary'>().notNull().default('turn_summary'),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    /** SHA-256 of the scoped sanitized turn; makes retrying commit idempotent. */
    sourceHash: text('source_hash').notNull(),
    importance: real('importance').notNull().default(0.5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeRecentIdx: index('support_bot_memories_scope_recent_idx').on(
      table.tenantId,
      table.carrierId,
      table.chatId,
      table.telegramUserId,
      table.createdAt,
    ),
    scopeHashUq: uniqueIndex('support_bot_memories_scope_hash_uq').on(
      table.tenantId,
      table.carrierId,
      table.chatId,
      table.telegramUserId,
      table.sourceHash,
    ),
    embeddingIdx: index('support_bot_memories_embedding_idx').using(
      'hnsw',
      table.embedding.op('vector_cosine_ops'),
    ),
  }),
);

export type SupportBotMemory = typeof supportBotMemories.$inferSelect;
export type NewSupportBotMemory = typeof supportBotMemories.$inferInsert;
