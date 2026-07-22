import { bigserial, boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design; no sibling value imports (drizzle-kit loads standalone).

/**
 * support_bot_messages — the agent bot's full group-message history, hamroh-v1-style but in the
 * CENTRAL Postgres instead of a per-instance SQLite. Every inbound group message (pre-gate, so
 * ordinary chatter included — analysis raw material) and every outbound bot reply.
 *
 * Written by the gateway in BATCHES via POST /v1/support-bot/messages (internal key); the
 * gateway also keeps a local JSONL append as the never-fails fallback, so a mytrion outage
 * loses central copies only until the next flush retries.
 *
 * `engaged` = the message actually reached the model (passed both caveman gates) — the
 * "bot handled vs ignored" KPI reads straight off this column.
 */
export const supportBotMessages = pgTable(
  'support_bot_messages',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    carrierId: text('carrier_id').notNull(),
    /** Telegram group chat id (e.g. '-1003926878773'). */
    chatId: text('chat_id').notNull(),
    /** Telegram message id — null for outbound (send result ids are not tracked). */
    msgId: text('msg_id'),
    telegramUserId: text('telegram_user_id').notNull(),
    name: text('name').notNull(),
    direction: text('direction').$type<'in' | 'out'>().notNull(),
    text: text('text').notNull(),
    photo: boolean('photo').notNull().default(false),
    engaged: boolean('engaged').notNull().default(false),
    /** Client-side timestamp (gateway clock) — insert order is NOT arrival order across batches. */
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    byChatTime: index('ix_support_bot_messages_chat_time').on(table.chatId, table.sentAt),
    byCarrierTime: index('ix_support_bot_messages_carrier_time').on(table.carrierId, table.sentAt),
  }),
);
