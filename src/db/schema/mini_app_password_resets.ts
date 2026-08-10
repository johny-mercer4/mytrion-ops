import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export type MiniAppPasswordResetStatus = 'pending' | 'resolved' | 'cancelled';

/**
 * Forget-password queue for the Telegram mini-app. The client cannot reset their own password —
 * they raise a note; the Sales agent (or admin) sets a new one from Manage / Admin.
 */
export const miniAppPasswordResets = pgTable(
  'mini_app_password_resets',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mpr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    carrierUserId: text('carrier_user_id').notNull(),
    registrationId: text('registration_id'),
    carrierId: text('carrier_id'),
    companyName: text('company_name'),
    login: text('login').notNull(),
    profile: text('profile').$type<'owner' | 'manager' | 'driver'>().notNull(),
    /** Sales agent stamped on the registration — primary resolver. */
    agentZohoUserId: text('agent_zoho_user_id'),
    agentName: text('agent_name'),
    status: text('status').$type<MiniAppPasswordResetStatus>().notNull().default('pending'),
    note: text('note'),
    resolvedByZohoUserId: text('resolved_by_zoho_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantStatusIdx: index('mini_app_password_resets_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    agentIdx: index('mini_app_password_resets_agent_idx').on(
      table.tenantId,
      table.agentZohoUserId,
      table.status,
    ),
    carrierIdx: index('mini_app_password_resets_carrier_idx').on(table.tenantId, table.carrierId),
  }),
);

export type MiniAppPasswordReset = typeof miniAppPasswordResets.$inferSelect;
export type NewMiniAppPasswordReset = typeof miniAppPasswordResets.$inferInsert;
