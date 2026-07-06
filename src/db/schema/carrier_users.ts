import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

// NOTE: no DB foreign keys by design — isolation + integrity live in the repo layer
// (see CLAUDE.md), and keeping schema files free of value-level sibling imports lets
// drizzle-kit load each file individually.

/**
 * carrier_users — login/password accounts for CARRIER COMPANIES (audience 'customer'),
 * separate from the internal `users` table so external client accounts can never collide
 * with Octane workers. Created by admins in the Mytrion Admin ("Carrier User Management");
 * consumed by /v1/auth/client/login (future Telegram mini-app + the /client web page).
 * A session minted from one of these rows is locked down: audience 'customer', viewer
 * role, no scopes, departments = the company tags (carrierId/applicationId).
 */
export const carrierUsers = pgTable(
  'carrier_users',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `cu_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    /** The carrier company id (DWH/EFS) — becomes the session's isolation tag. */
    carrierId: text('carrier_id').notNull(),
    /** Optional application id (pre-carrier applicants have this instead). */
    applicationId: text('application_id'),
    /** Sign-in name (unique per tenant; case-insensitive — stored lowercased). */
    login: text('login').notNull(),
    passwordHash: text('password_hash').notNull(),
    /** The Octane sales agent (Zoho user) who owns this carrier — display/attribution. */
    agentName: text('agent_name'),
    agentZohoUserId: text('agent_zoho_user_id'),
    /** Free-form access profile label (e.g. 'Carrier Owner', 'Dispatcher'). */
    profile: text('profile'),
    status: text('status').$type<'active' | 'disabled'>().notNull().default('active'),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    loginTenantUnique: uniqueIndex('carrier_users_tenant_login_uk').on(table.tenantId, table.login),
    carrierIdx: index('carrier_users_tenant_carrier_idx').on(table.tenantId, table.carrierId),
  }),
);

export type CarrierUser = typeof carrierUsers.$inferSelect;
export type NewCarrierUser = typeof carrierUsers.$inferInsert;
