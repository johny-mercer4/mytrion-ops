import {
  bigint,
  bigserial,
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * payment_returns — ACH returns + card disputes, replacing the Zoho `MX_Merchant_Returns` module.
 * Originate at the MX Merchant API (external) and are ingested into PG. A return is manually (or
 * automatically) matched to the original payment_transactions row; matching reverses the payment in
 * CMP (external) and flags the transaction `is_returned` — it does NOT unmap the original payment.
 *
 * Not tenant-scoped (global operational table). `original_transaction_id` is a soft reference to
 * payment_transactions.id (no hard FK — a return can be logged before its payment is known).
 */
export const paymentReturns = pgTable(
  'payment_returns',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    source: text('source').notNull(), // 'mx-ach' | 'mx-dispute'
    sourceRecordId: text('source_record_id').notNull(), // rail-native id (idempotency key)
    returnType: text('return_type'), // 'ACH' | 'Wire' | 'Card-Chargeback' (display label)
    carrierId: text('carrier_id'),
    customerName: text('customer_name'),
    referenceNumber: text('reference_number'),
    last4: text('last4'),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    returnDate: timestamp('return_date', { withTimezone: true }),
    reason: text('reason'),
    matched: boolean('matched').notNull().default(false),
    originalTransactionId: bigint('original_transaction_id', { mode: 'number' }), // soft ref
    matchNote: text('match_note'),
    matchedBy: text('matched_by'),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    isReversed: boolean('is_reversed').notNull().default(false), // CMP reversal confirmed
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceRecordUniq: uniqueIndex('payment_returns_source_record_uniq').on(
      table.source,
      table.sourceRecordId,
    ),
    matchedIdx: index('payment_returns_matched_idx').on(table.matched),
    carrierIdx: index('payment_returns_carrier_idx').on(table.carrierId),
  }),
);

export type PaymentReturn = typeof paymentReturns.$inferSelect;
export type NewPaymentReturn = typeof paymentReturns.$inferInsert;
