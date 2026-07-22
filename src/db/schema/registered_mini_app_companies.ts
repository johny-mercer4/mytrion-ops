import { createId } from '@paralleldrive/cuid2';
import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import type { CarrierCompanyType } from './carrier_invitations.js';

/**
 * registered_mini_app_companies — recorded once an owner-operator finishes sign-in inside the
 * Telegram mini-app (after opening a carrier_invitations link). Separate from `carrier_users`:
 * this table is the mini-app's own registration record (Telegram identity + which carrier it's
 * for), not a login — the mini-app authenticates via Telegram itself, not a password.
 */
export const registeredMiniAppCompanies = pgTable(
  'registered_mini_app_companies',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `rma_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** The carrier_invitations.id that was redeemed to reach this registration. */
    invitationId: text('invitation_id').notNull(),
    profile: text('profile').$type<'owner' | 'driver'>().notNull().default('owner'),
    telegramUserId: text('telegram_user_id').notNull(),
    telegramChatId: text('telegram_chat_id'),
    telegramUsername: text('telegram_username'),
    carrierId: text('carrier_id'),
    applicationId: text('application_id'),
    companyName: text('company_name'),
    /** The Octane sales agent carried over from the invite — used for support copy later. */
    agentName: text('agent_name'),
    agentZohoUserId: text('agent_zoho_user_id'),
    /** Driver only. */
    cardId: text('card_id'),
    /** Driver only: the driver's name captured on the invite. */
    driverName: text('driver_name'),
    /** Carried over from the invite — tells the mini-app which experience to render: just this
     * one card (owner-operator) or the full fleet (trucks/drivers/cards, fleet-manager). */
    companyType: text('company_type').$type<CarrierCompanyType>(),
    cardCount: integer('card_count'),
    /** Soft-disable: an admin can revoke access without losing the registration's audit history.
     * A revoked driver's card frees up for reassignment (see listDriversByCarrier). */
    status: text('status').$type<'active' | 'revoked'>().notNull().default('active'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // One registration per Telegram user per tenant — re-opening a link just confirms, not duplicates.
    telegramUserUnique: uniqueIndex('registered_mini_app_companies_tenant_tg_user_uk').on(
      table.tenantId,
      table.telegramUserId,
    ),
    invitationIdx: index('registered_mini_app_companies_invitation_idx').on(table.invitationId),
    carrierIdx: index('registered_mini_app_companies_tenant_carrier_idx').on(
      table.tenantId,
      table.carrierId,
    ),
  }),
);

export type RegisteredMiniAppCompany = typeof registeredMiniAppCompanies.$inferSelect;
export type NewRegisteredMiniAppCompany = typeof registeredMiniAppCompanies.$inferInsert;
