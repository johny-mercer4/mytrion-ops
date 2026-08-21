import { createId } from '@paralleldrive/cuid2';
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Persisted spend ledger for metered verification vendors (iSoftPull today; Plaid /get later).
 *
 * The in-process WeakSet on SpendAuthorisation is only a forge-proof token. A process restart
 * would lose an in-memory attempt list, so a live metered pull is not allowed to succeed until
 * this row exists. `case_id` is attribution, not an FK — Data Center uses `data-center`.
 */
export const VERIFICATION_SPEND_STATUSES = ['pending', 'ok', 'error'] as const;
export type VerificationSpendStatus = (typeof VERIFICATION_SPEND_STATUSES)[number];

export const verificationVendorSpendAttempts = pgTable(
  'verification_vendor_spend_attempts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => createId()),
    tenantId: text('tenant_id').notNull(),
    vendorId: text('vendor_id').notNull(),
    caseId: text('case_id').notNull(),
    status: text('status').$type<VerificationSpendStatus>().notNull(),
    requestedBy: text('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    tenantVendorTimeIdx: index('verification_vendor_spend_attempts_tenant_vendor_idx').on(
      table.tenantId,
      table.vendorId,
      table.createdAt,
    ),
  }),
);

export type VerificationVendorSpendAttempt = typeof verificationVendorSpendAttempts.$inferSelect;
export type NewVerificationVendorSpendAttempt = typeof verificationVendorSpendAttempts.$inferInsert;
