import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import { check, date, index, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * ledger_client_type_overrides — effective-dated corrections to a carrier's ledger client type.
 *
 * The ledger's base truth is DWH `octane.dim_company.payment_terms` ('LOC' | 'Prepay' | 'Deposit',
 * with `Deposit` normalized to Prepay at write time, and `is_wex_funded` carriers excluded from the
 * module entirely per TZ §5.3). That column is unset for ~62% of the book (measured 2026-08-06:
 * 5,030 of 8,145 carriers), and three other systems carry a disagreeing value (a CMP SYSTEM tag,
 * Zoho `Payment_Type_Billing`, and the `is_wex_funded` / `Credit_Setup` pair). This table is the
 * single escape hatch: a billing agent records the correct type, with a reason, and the ledger's
 * resolver prefers it over the DWH.
 *
 * TZ §8 requires the type to be an effective-dated attribute rather than a static one, so the shape
 * is `effective_from` / `effective_to` from day one. PHASE 1 READS ONLY THE OPEN ROW
 * (`effective_to is null`) — the per-period interpretation, the LOC→Prepay block on AR>0, the
 * Prepay→LOC opening-credit carry and the Reclassification-exception queue are all deferred, and
 * none of them need a migration to enable.
 *
 * `dwh_value_at_write` records what `dim_company` said when the override was created, so drift
 * between the override and its source is detectable later without a second history table.
 *
 * Not tenant-scoped — see the header of ./ledger_opening_balances.ts for the reasoning.
 */
export type LedgerClientType = 'LOC' | 'Prepay';

export const ledgerClientTypeOverrides = pgTable(
  'ledger_client_type_overrides',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `lct_${createId()}`),

    carrierId: text('carrier_id').notNull(),
    clientType: text('client_type').$type<LedgerClientType>().notNull(),

    /** Date the type takes effect, INCLUSIVE. */
    effectiveFrom: date('effective_from').notNull(),
    /** NULL = still open / current. Closed to `newEffectiveFrom − 1 day` when superseded. */
    effectiveTo: date('effective_to'),

    reason: text('reason').notNull(),
    /** What dim_company.payment_terms said at write time — for drift detection. */
    dwhValueAtWrite: text('dwh_value_at_write'),

    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedByName: text('closed_by_name'),
  },
  (table) => ({
    /** At most one OPEN override per carrier — the kpi_worker_memberships_open_uk pattern. */
    openUk: uniqueIndex('ledger_client_type_overrides_open_uk')
      .on(table.carrierId)
      .where(sql`${table.effectiveTo} is null`),
    carrierFromIdx: index('ledger_client_type_overrides_carrier_from_idx').on(
      table.carrierId,
      table.effectiveFrom,
    ),

    typeCheck: check(
      'ledger_client_type_overrides_type_check',
      sql`${table.clientType} IN ('LOC', 'Prepay')`,
    ),
  }),
);

export type LedgerClientTypeOverride = typeof ledgerClientTypeOverrides.$inferSelect;
export type NewLedgerClientTypeOverride = typeof ledgerClientTypeOverrides.$inferInsert;
