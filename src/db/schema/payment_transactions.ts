import { sql } from 'drizzle-orm';
import {
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
 * payment_transactions — unified store for every inbound Octane payment, replacing the four Zoho
 * CRM payment modules (Mx_Merchant / Zelle / Chase / Stripe). One row = one payment; `source` is
 * the discriminator ("type"). Source-specific long-tail fields live in `raw` (jsonb) so a new rail
 * needs no migration. Mapping/reconciliation columns are PG-owned — the billing app writes them
 * (the actual payment is still applied/reversed in CMP, external).
 *
 * Not tenant-scoped: keyed on the CMP `carrier_id` domain — a global operational table (money-code
 * precedent). Ingest upserts on the natural key (source, source_record_id) and must NEVER overwrite
 * the PG-owned mapping columns.
 *
 * carrier_id is TEXT (Zoho stored it as text; the frontend normalizer reads it as a string).
 * NUMERIC round-trips as a string in Drizzle — callers format with a fixed 2-scale helper.
 */
export const paymentTransactions = pgTable(
  'payment_transactions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    // ── Identity / provenance ──────────────────────────────────────────────
    source: text('source').notNull(), // 'mx' | 'zelle' | 'chase' | 'stripe' | …
    sourceModule: text('source_module'), // optional origin tag (e.g. legacy Zoho module name)
    sourceRecordId: text('source_record_id').notNull(), // rail-native id (idempotency key)

    // ── Core payment fields (common to every source) ───────────────────────
    carrierId: text('carrier_id'),
    amount: numeric('amount', { precision: 14, scale: 2 }),
    currency: text('currency').default('USD'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }), // rail "best" timestamp
    name: text('name'),
    status: text('status'), // MX/Stripe status; null for Zelle/Chase
    txnType: text('txn_type'), // MX Transaction_Type / Chase Type
    externalTxnId: text('external_txn_id'), // rail's own txn id / reference

    // ── Party / instrument detail (promoted for display) ───────────────────
    senderName: text('sender_name'),
    memo: text('memo'),
    description: text('description'),
    email: text('email'),
    cardBrand: text('card_brand'),
    cardLast4: text('card_last4'),
    customerRef: text('customer_ref'),
    receiptUrl: text('receipt_url'),

    // ── Mapping / reconciliation (PG-owned; written by the app) ─────────────
    isInvoiceMapped: boolean('is_invoice_mapped').notNull().default(false),
    mappingType: text('mapping_type'), // Invoice | Prepay Top-Up | CRM-Sync (…) | Split | Auto-Mapped
    mappedBy: text('mapped_by'),
    mappedAt: timestamp('mapped_at', { withTimezone: true }),
    cmpRef: jsonb('cmp_ref').$type<Record<string, unknown>>(), // pointer(s) into CMP for reversal
    splitAllocations: jsonb('split_allocations').$type<Record<string, unknown>[]>(),
    proposedCarrierIds: text('proposed_carrier_ids'), // auto-match candidates

    // ── Returns / reversals ────────────────────────────────────────────────
    isReturned: boolean('is_returned').notNull().default(false),
    returnedAt: timestamp('returned_at', { withTimezone: true }),

    // ── Sync bookkeeping ────────────────────────────────────────────────────
    raw: jsonb('raw').$type<Record<string, unknown>>(), // full original source record
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // Ingest upsert key.
    sourceRecordUniq: uniqueIndex('payment_transactions_source_record_uniq').on(
      table.source,
      table.sourceRecordId,
    ),
    // Cross-source dashboard (newest first — PG scans this index backwards for ORDER BY DESC).
    occurredIdx: index('payment_transactions_occurred_idx').on(table.occurredAt),
    // Carrier drilldown.
    carrierIdx: index('payment_transactions_carrier_idx').on(table.carrierId),
    // Mapped/unmapped queue filter + sort.
    mappedIdx: index('payment_transactions_mapped_idx').on(table.isInvoiceMapped, table.occurredAt),
    // Per-source filter/counts.
    sourceIdx: index('payment_transactions_source_idx').on(table.source),
    // Unmapped-returns sweep.
    returnedIdx: index('payment_transactions_returned_idx')
      .on(table.isReturned)
      .where(sql`${table.isReturned}`),
  }),
);

export type PaymentTransaction = typeof paymentTransactions.$inferSelect;
export type NewPaymentTransaction = typeof paymentTransactions.$inferInsert;
