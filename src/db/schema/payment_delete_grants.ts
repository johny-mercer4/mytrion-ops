import { bigserial, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * payment_delete_grants — explicit per-user permission to hard-delete a manually-entered
 * payment_transactions row, beyond the base admin/allDepartmentAccess bypass.
 *
 * Deliberately its own table rather than a column on worker_mytrion_access: that table is the
 * Mytrion/department-access resolver (profile defaults -> role defaults -> per-user override ->
 * permission sets), already large and carefully tuned, and explicitly documented as a workspace-
 * level boundary, not an individual-action one. Folding an unrelated "can delete a Chase row"
 * permission into it would blur what that table means for anyone reading it later.
 *
 * `source` (not just Chase-specific) so a future rail needing the same allowance is a new row, not
 * a new table — matches payment_transactions.source's own vocabulary ('mx' | 'zelle' | 'chase' |
 * 'stripe' | ...). Not tenant-scoped: same "global operational table" precedent as the payment
 * tables themselves (money-code / payment_carrier_memory).
 */
export const paymentDeleteGrants = pgTable(
  'payment_delete_grants',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    zohoUserId: text('zoho_user_id').notNull(),
    source: text('source').notNull(),
    grantedBy: text('granted_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userSourceUniq: uniqueIndex('payment_delete_grants_user_source_uniq').on(
      table.zohoUserId,
      table.source,
    ),
    sourceIdx: index('payment_delete_grants_source_idx').on(table.source),
  }),
);

export type PaymentDeleteGrant = typeof paymentDeleteGrants.$inferSelect;
export type NewPaymentDeleteGrant = typeof paymentDeleteGrants.$inferInsert;
