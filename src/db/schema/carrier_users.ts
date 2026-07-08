import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), and keeping schema files free of value-level sibling imports lets
// drizzle-kit load each file individually.

/** The two carrier access profiles. Owner (fleet) sees ALL the carrier's cards; Driver is a
 * CHILD of an owner and is tied to a single card (with that card's limits). */
export type CarrierProfile = 'owner' | 'driver';

/**
 * carrier_users — login/password accounts for CARRIER COMPANIES (audience 'customer'),
 * separate from the internal `users` table so external client accounts can never collide
 * with Octane workers. Created by admins in the Mytrion Admin ("Carrier User Management");
 * consumed by /v1/auth/client/login (future Telegram mini-app + the /client web page).
 *
 * RBAC ties by profile:
 *   owner  → carrierId OR applicationId (an account can be provisioned on the application id
 *            alone, before the carrier exists; carrier_id is back-filled later).
 *   driver → parentUserId (the owning fleet account) + cardId (the single card it may see).
 *            Company scope is INHERITED from the parent at login, never stored twice.
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
    /** Access profile: 'owner' (fleet — all cards) or 'driver' (one card, child of an owner). */
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
  }),
);

export type CarrierUser = typeof carrierUsers.$inferSelect;
export type NewCarrierUser = typeof carrierUsers.$inferInsert;
