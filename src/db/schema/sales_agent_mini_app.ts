import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** One-time link created from the authenticated Sales Mytrion for the agent themselves. */
export const salesAgentMiniAppInvitations = pgTable(
  'sales_agent_mini_app_invitations',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sai_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    agentName: text('agent_name').notNull(),
    /** Optional company the agent clicked before opening Telegram; still re-authorized on redeem. */
    requestedCarrierId: text('requested_carrier_id'),
    status: text('status').$type<'pending' | 'redeemed' | 'cancelled'>().notNull().default('pending'),
    redeemedTelegramUserId: text('redeemed_telegram_user_id'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentIdx: index('sales_agent_mini_app_invites_agent_idx').on(
      table.tenantId,
      table.zohoUserId,
      table.createdAt,
    ),
  }),
);

/**
 * Telegram ↔ verified Zoho worker binding for a Sales agent.
 *
 * This deliberately does not reuse registered_mini_app_companies: an agent owns a changing
 * portfolio, not one carrier. The selected carrier is request scope and is never stored as
 * authority on this row.
 */
export const salesAgentMiniAppPrincipals = pgTable(
  'sales_agent_mini_app_principals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `sap_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    agentName: text('agent_name').notNull(),
    telegramUserId: text('telegram_user_id').notNull(),
    telegramUsername: text('telegram_username'),
    languageCode: text('language_code'),
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    zohoUnique: uniqueIndex('sales_agent_mini_app_principals_tenant_zoho_uk').on(
      table.tenantId,
      table.zohoUserId,
    ),
    telegramUnique: uniqueIndex('sales_agent_mini_app_principals_tenant_tg_uk').on(
      table.tenantId,
      table.telegramUserId,
    ),
  }),
);

export type SalesAgentMiniAppInvitation = typeof salesAgentMiniAppInvitations.$inferSelect;
export type NewSalesAgentMiniAppInvitation = typeof salesAgentMiniAppInvitations.$inferInsert;
export type SalesAgentMiniAppPrincipal = typeof salesAgentMiniAppPrincipals.$inferSelect;
export type NewSalesAgentMiniAppPrincipal = typeof salesAgentMiniAppPrincipals.$inferInsert;
