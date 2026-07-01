import { sql } from 'drizzle-orm';
import { bigint, bigserial, date, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Money_Code_Requests — one ACTIVE (non-voided) money code per (carrier, invoice).
 *
 * Dedup anchor: a PARTIAL unique index on (carrier_id, invoice_id) WHERE status <> 'VOIDED'. This
 * makes "issue a code for this invoice" idempotent + race-safe at the DB level, while letting a
 * VOIDED row be superseded by a fresh issue (voided rows are excluded from the index, so re-issue
 * after an auto-void doesn't collide). At most one ISSUED row per invoice; any number of VOIDED ones.
 *
 * Not tenant-scoped: carrier_id / invoice_id live in the CMP domain (BIGINT ids), so this is a global
 * operational table (like a DWH-facing log). `efs_money_code` is filled later by the EFS step;
 * `status` is ISSUED until VOIDED (then voided_at / void_reason are set).
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
    email: text('email'), // company email (from DWH dim_company); nullable. Zapier sends from this.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp('voided_at', { withTimezone: true }), // set when status flips to VOIDED
    voidReason: text('void_reason'),
  },
  (table) => ({
    // Unique only among ACTIVE rows — a voided invoice can be issued again.
    activeCarrierInvoiceUnq: uniqueIndex('money_code_requests_active_carrier_invoice_uniq')
      .on(table.carrierId, table.invoiceId)
      .where(sql`${table.status} <> 'VOIDED'`),
  }),
);

export type MoneyCodeRequest = typeof moneyCodeRequests.$inferSelect;
export type NewMoneyCodeRequest = typeof moneyCodeRequests.$inferInsert;
