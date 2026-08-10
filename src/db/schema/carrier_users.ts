import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), and keeping schema files free of value-level sibling imports lets
// drizzle-kit load each file individually.

/** Carrier access profiles. Owner/manager see ALL the carrier's cards; driver is tied to one card. */
export type CarrierProfile = 'owner' | 'manager' | 'driver';

/**
 * carrier_users — login/password accounts for CARRIER COMPANIES (audience 'customer'),
 * separate from the internal `users` table so external client accounts can never collide
 * with Octane workers. Minted when a Telegram invite is accepted and a password is set;
 * consumed by mini-app password login (Bearer, 1-day TTL).
 *
 * RBAC ties by profile:
 *   owner / manager → carrierId OR applicationId (manager is owner-equivalent).
 *   driver → parentUserId (optional) + cardId (the single card it may see).
 * A session minted from one of these rows is locked down: audience 'customer', viewer
 * role, no scopes, departments = the effective company tags.
 */
export const carrierUsers = pgTable(
  'carrier_users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cu_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** Access profile: 'owner' / 'manager' (fleet) or 'driver' (one card). */
    profile: text('profile').$type<CarrierProfile>().notNull().default('owner'),
    /** The carrier company id (DWH/EFS). Nullable — application-only accounts get it later. */
    carrierId: text('carrier_id'),
    /** Application id — the unique key for pre-carrier provisioning. */
    applicationId: text('application_id'),
    /** Driver only: the owner account this driver belongs to. */
    parentUserId: text('parent_user_id'),
    /** Driver only: the card this account is tied to (the card carries the limits). */
    cardId: text('card_id'),
    /** Company display name (from the DWH client directory) — search/display only. */
    companyName: text('company_name'),
    /** Sign-in name (unique per tenant; case-insensitive — stored lowercased). */
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** Linked Telegram mini-app registration (registered_mini_app_companies.id). */
    registrationId: text('registration_id'),
    /** Telegram user bound at password setup — required while the shell is Telegram-only. */
    telegramUserId: text('telegram_user_id'),
    /** The Octane sales agent (Zoho user) who owns this carrier — display/attribution. */
    agentName: text('agent_name'),
    agentZohoUserId: text('agent_zoho_user_id'),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    loginTenantUnique: uniqueIndex('carrier_users_tenant_login_uk').on(table.tenantId, table.login),
    carrierIdx: index('carrier_users_tenant_carrier_idx').on(table.tenantId, table.carrierId),
    applicationIdx: index('carrier_users_tenant_application_idx').on(
      table.tenantId,
      table.applicationId,
    ),
    parentIdx: index('carrier_users_tenant_parent_idx').on(table.tenantId, table.parentUserId),
    registrationIdx: index('carrier_users_tenant_registration_idx').on(
      table.tenantId,
      table.registrationId,
    ),
    telegramIdx: uniqueIndex('carrier_users_tenant_telegram_uk').on(
      table.tenantId,
      table.telegramUserId,
    ),
  }),
);

export type CarrierUser = typeof carrierUsers.$inferSelect;
export type NewCarrierUser = typeof carrierUsers.$inferInsert;
