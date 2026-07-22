import { createId } from '@paralleldrive/cuid2';
import { boolean, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design; no sibling value imports (drizzle-kit loads standalone).

/**
 * support_bot_chats — which Telegram GROUP belongs to which carrier, for the agent bot's
 * multi-session mode (see apps/agent-telegram-bot/MULTISESSION_ARCH.md). One gateway serves
 * every client group; each tool call resolves the chat's carrier HERE (never from the model)
 * and then still requires the asking user's registration to match that carrier — two
 * independent bindings that must agree, or the call dies.
 */
export const supportBotChats = pgTable(
  'support_bot_chats',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sbc_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Telegram group chat id (e.g. '-1003926878773'). */
    chatId: text('chat_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    chatUq: uniqueIndex('support_bot_chats_chat_uq').on(table.chatId),
    carrierIdx: index('support_bot_chats_carrier_idx').on(table.tenantId, table.carrierId),
  }),
);

export type SupportBotChat = typeof supportBotChats.$inferSelect;
