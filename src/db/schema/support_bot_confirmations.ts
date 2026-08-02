import { createId } from '@paralleldrive/cuid2';
import { index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

export type SupportBotConfirmationStatus = 'pending' | 'consumed' | 'cancelled' | 'expired';

/** One server-bound Telegram confirmation; raw callback tokens are never persisted. */
export const supportBotConfirmations = pgTable(
  'support_bot_confirmations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sbcf_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    tokenHash: text('token_hash').notNull(),
    carrierId: text('carrier_id').notNull(),
    chatId: text('chat_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    messageId: text('message_id').notNull(),
    toolName: text('tool_name').notNull(),
    arguments: jsonb('arguments').$type<Record<string, unknown>>().notNull(),
    argumentsHash: text('arguments_hash').notNull(),
    status: text('status')
      .$type<SupportBotConfirmationStatus>()
      .notNull()
      .default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedUpdateId: text('resolved_update_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantTokenUq: uniqueIndex('support_bot_confirmations_tenant_token_uq').on(
      table.tenantId,
      table.tokenHash,
    ),
    pendingExpiryIdx: index('support_bot_confirmations_pending_expiry_idx').on(
      table.status,
      table.expiresAt,
    ),
    actorMessageIdx: index('support_bot_confirmations_actor_message_idx').on(
      table.tenantId,
      table.chatId,
      table.telegramUserId,
      table.messageId,
    ),
  }),
);

export type SupportBotConfirmation = typeof supportBotConfirmations.$inferSelect;
