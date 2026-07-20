import { bigserial, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * payment_carrier_memory — the sender/company → carrier learning store, replacing the Zoho
 * `Company_Carrier_Id_Memory` module. When a billing agent maps a payment, the payer's company
 * name is remembered against its carrier id so the next payment from that name auto-suggests the
 * carrier (fuzzy match). Junk bank-descriptor names are filtered app-side before insert.
 *
 * Not tenant-scoped (global operational table, money-code precedent). `company_name_lc` is the
 * lower-cased key so dedup is case-insensitive at the DB level without an expression index.
 */
export const paymentCarrierMemory = pgTable(
  'payment_carrier_memory',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    companyName: text('company_name').notNull(),
    companyNameLc: text('company_name_lc').notNull(), // lower(company_name) — dedup + lookup key
    carrierId: text('carrier_id').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCarrierUniq: uniqueIndex('payment_carrier_memory_company_carrier_uniq').on(
      table.companyNameLc,
      table.carrierId,
    ),
    companyIdx: index('payment_carrier_memory_company_idx').on(table.companyNameLc),
  }),
);

export type PaymentCarrierMemory = typeof paymentCarrierMemory.$inferSelect;
export type NewPaymentCarrierMemory = typeof paymentCarrierMemory.$inferInsert;
