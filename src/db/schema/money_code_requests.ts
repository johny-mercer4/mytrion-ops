import { bigint, bigserial, date, integer, numeric, pgTable, text, timestamp, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Money_Code_Requests — one row per invoice allocation of a physical money-code draw.
 *
 * Draw model (ServerCRM / self-service parity): an invoice grants a LIMIT; agents may draw
 * against it multiple times. A 2-billing draw can waterfall across 2 invoices → 2 rows sharing
 * a `batch_id`, one physical EFS code = Σ money_code_amount. Primary display rows have
 * `batch_id IS NULL` (sibling rows point `batch_id` at the primary id).
 *
 * Not tenant-scoped: carrier_id / invoice_id live in the CMP domain. `efs_money_code` is set
 * once at issue and must never be returned to the Sales UI (CMP app delivery only).
 *
 * Status: ISSUED | VOIDED | USED.
 */
export const moneyCodeRequests = pgTable(
  'money_code_requests',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    carrierId: bigint('carrier_id', { mode: 'number' }).notNull(),
    invoiceId: bigint('invoice_id', { mode: 'number' }).notNull(),
    invoiceAmount: numeric('invoice_amount', { precision: 14, scale: 2 }),
    limitPct: numeric('limit_pct', { precision: 6, scale: 2 }),
    invoiceLimit: numeric('invoice_limit', { precision: 14, scale: 2 }),
    moneyCodeAmount: numeric('money_code_amount', { precision: 14, scale: 2 }),
    billingType: text('billing_type'),
    /** Issue + 72h instant (timestamptz). */
    validUntil: timestamp('valid_until', { withTimezone: true }),
    status: text('status').notNull().default('ISSUED'),
    efsMoneyCode: text('efs_money_code'),
    efsId: text('efs_id'),
    requestedBy: text('requested_by'),
    email: text('email'),
    companyName: text('company_name'),
    batchId: bigint('batch_id', { mode: 'number' }),
    requestedDow: text('requested_dow'),
    requestedNyDate: date('requested_ny_date'),
    moneycodeReason: text('moneycode_reason'),
    unitNumber: text('unit_number'),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    notifyError: text('notify_error'),
    usedAmount: numeric('used_amount', { precision: 14, scale: 2 }),
    usedAt: timestamp('used_at', { withTimezone: true }),
    usedCount: integer('used_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (table) => ({
    activeByInvoice: index('ix_money_code_active_by_invoice')
      .on(table.carrierId, table.invoiceId)
      .where(sql`${table.status} <> 'VOIDED'`),
    statusCreated: index('ix_money_code_status_created').on(table.status, table.createdAt),
    batch: index('ix_money_code_batch')
      .on(table.batchId)
      .where(sql`${table.batchId} IS NOT NULL`),
  }),
);

export type MoneyCodeRequest = typeof moneyCodeRequests.$inferSelect;
export type NewMoneyCodeRequest = typeof moneyCodeRequests.$inferInsert;
