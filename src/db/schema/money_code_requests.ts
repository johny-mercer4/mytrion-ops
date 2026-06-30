import { bigint, bigserial, date, numeric, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core';

/**
 * Money_Code_Requests — one issued money code per (carrier, invoice). The UNIQUE(carrier_id,
 * invoice_id) constraint is the dedup anchor: it makes "issue a code for this invoice" idempotent
 * and race-safe at the DB level (a concurrent double-submit collides on 23505, not a duplicate row).
 *
 * Not tenant-scoped: carrier_id / invoice_id live in the CMP domain (BIGINT ids), so this is a global
 * operational table (like a DWH-facing log), not a per-tenant one. `efs_money_code` is filled later by
 * the EFS step; `status` is ISSUED until VOIDED.
 *
 * NOTE: carrier_id / invoice_id use bigint mode:'number' — CMP ids are well within JS's safe-integer
 * range. Switch to mode:'bigint' if an id can exceed 2^53.
 */
export const moneyCodeRequests = pgTable(
  'money_code_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    carrierId: bigint('carrier_id', { mode: 'number' }).notNull(),
    invoiceId: bigint('invoice_id', { mode: 'number' }).notNull(),
    invoiceAmount: numeric('invoice_amount', { precision: 14, scale: 2 }),
    limitPct: numeric('limit_pct', { precision: 6, scale: 2 }),
    moneyCodeAmount: numeric('money_code_amount', { precision: 14, scale: 2 }),
    billingType: text('billing_type'),
    validUntil: date('valid_until'),
    status: text('status').notNull().default('ISSUED'), // ISSUED | VOIDED
    efsMoneyCode: text('efs_money_code'), // filled by the (future) EFS step
    requestedBy: text('requested_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    carrierInvoiceUnq: unique('money_code_requests_carrier_id_invoice_id_key').on(table.carrierId, table.invoiceId),
  }),
);

export type MoneyCodeRequest = typeof moneyCodeRequests.$inferSelect;
export type NewMoneyCodeRequest = typeof moneyCodeRequests.$inferInsert;
