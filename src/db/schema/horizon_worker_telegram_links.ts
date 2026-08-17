import { index, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

/**
 * Horizon worker CRM Mini App — Telegram identity bound to a Zoho session.
 *
 * Login stays Zoho OAuth. Telegram `initData` (HMAC-verified with HORIZON_BOT_TOKEN) only proves
 * "this Telegram user at this moment". This table is the durable map used later for sendDocument;
 * it is NOT a login table and it must not reuse sales_agent_mini_app_principals or carrier
 * registered_mini_app_companies.
 *
 * Canonical worker key is zoho_user_id. telegram_username is a cache (people change it).
 * zoho_username / zoho_email are session snapshots for ops, never auth keys.
 */
export const horizonWorkerTelegramLinks = pgTable(
  'horizon_worker_telegram_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    /** Private chat usually equals telegram_user_id; filled from initData and /start. */
    telegramChatId: text('telegram_chat_id'),
    telegramUsername: text('telegram_username'),
    zohoUsername: text('zoho_username'),
    zohoEmail: text('zoho_email'),
    linkedVia: text('linked_via').$type<'webapp_bind' | 'bot_start'>().notNull(),
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    linkedAt: timestamp('linked_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    zohoUnique: uniqueIndex('horizon_worker_tg_links_tenant_zoho_uk').on(
      table.tenantId,
      table.zohoUserId,
    ),
    telegramUnique: uniqueIndex('horizon_worker_tg_links_tenant_tg_uk').on(
      table.tenantId,
      table.telegramUserId,
    ),
    tenantIdx: index('horizon_worker_tg_links_tenant_idx').on(table.tenantId),
  }),
);

export type HorizonWorkerTelegramLink = typeof horizonWorkerTelegramLinks.$inferSelect;
export type NewHorizonWorkerTelegramLink = typeof horizonWorkerTelegramLinks.$inferInsert;
