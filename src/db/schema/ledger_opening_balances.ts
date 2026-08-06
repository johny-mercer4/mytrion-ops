import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * ledger_opening_balances — the inception anchor for every Billing Ledger sub-ledger.
 *
 * The ledger computes `Closing = Opening + Debit − Credit` cumulatively FROM `as_of_date`, so this
 * row is what makes any window other than "since inception" correct. It exists because launch means
 * migrating already-accumulated balances out of CMP by hand (TZ §5, §10.2).
 *
 * APPEND-ONLY WITH SUPERSEDE — never updated in place. Three reasons:
 *   • Mutating an opening retroactively rewrites every statement that section ever produced. An
 *     auditor asking "which opening produced last Tuesday's report" must be answerable.
 *   • The launch migration moves real money balances by hand; "who changed 12,400 to 12,000, when,
 *     from which spreadsheet" is the first question asked when a number looks wrong.
 *   • `import_batch_id` + `supersedes_id` IS the Excel-import revert journal, so the importer needs
 *     no `bulk_change_log` analogue (that table exists because its targets mutate in place).
 * `superseded_at is null` marks the one LIVE revision per (carrier, section).
 * Precedent: `kpi_external_facts` in ./sales_kpi.ts (append-only, revision, supersedes_id).
 *
 * SIGN CONVENTION — positive means:
 *   cb-loc / cb-prepay  → funds available on the EFS contract (compare to EFS balance as-is)
 *   unbilled            → incurred, not yet on a CMP invoice (should trend to 0)
 *   ar                  → the carrier owes us (compare to Σ greatest(total_amount − total_paid, 0))
 *   untopped            → received, not yet loaded to EFS (should trend to 0)
 * `amount` is SIGNED with no non-negative check: EFS can overdraw and over-invoicing can push
 * unbilled negative. The importer warns on a negative, it never rejects one.
 *
 * Not tenant-scoped: keyed on the CMP `carrier_id` domain — a global operational table, the same
 * call made for `payment_transactions` / `maintenance_cases` / `money_code_requests`. This is a
 * deliberate exception to CLAUDE.md hard rule 2; the isolation boundary here is the billing
 * department gate (`requireDepartment(request, 'billing', …)`), not tenancy. Adding `tenant_id`
 * would be a column with one value forever and would corrupt the natural unique key below.
 *
 * NUMERIC round-trips as a string in Drizzle — callers format through a fixed 2-scale helper.
 */
export type LedgerOpeningSource = 'excel' | 'manual' | 'migration';

export const ledgerOpeningBalances = pgTable(
  'ledger_opening_balances',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `lob_${createId()}`),

    carrierId: text('carrier_id').notNull(),
    /** One of LEDGER_SECTION_IDS — see src/modules/billing/ledger/sections.ts. */
    section: text('section').notNull(),
    /** Cumulative FROM this date, INCLUSIVE. */
    asOfDate: date('as_of_date').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull().default('USD'),

    source: text('source').$type<LedgerOpeningSource>().notNull(),
    /** Soft ref → ledger_import_batches.id. No FK: a batch may be swept while its rows stay. */
    importBatchId: text('import_batch_id'),
    note: text('note'),

    // ── Revision chain ──────────────────────────────────────────────────────
    revision: integer('revision').notNull().default(1),
    /** Previous revision's id (self soft-ref). Null on revision 1. */
    supersedesId: text('supersedes_id'),
    /** NULL = this is the LIVE row. */
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    supersededByName: text('superseded_by_name'),

    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Exactly one LIVE opening balance per carrier per section. Deliberately NOT keyed on
     * `as_of_date`: the TZ's opening balance is a single inception anchor per section, not a time
     * series. Allowing several live as-of dates would force a "which anchor wins" decision at read
     * time and give two competing since-inception baselines. Correcting the date is a new revision.
     */
    liveUk: uniqueIndex('ledger_opening_balances_live_uk')
      .on(table.carrierId, table.section)
      .where(sql`${table.supersededAt} is null`),
    // Read path (live lookup + revision history).
    carrierSectionIdx: index('ledger_opening_balances_carrier_section_idx').on(
      table.carrierId,
      table.section,
    ),
    // "Which carriers still lack an opening balance" — the launch-migration progress bar.
    sectionLiveIdx: index('ledger_opening_balances_section_live_idx').on(
      table.section,
      table.supersededAt,
    ),
    // Batch revert.
    batchIdx: index('ledger_opening_balances_batch_idx')
      .on(table.importBatchId)
      .where(sql`${table.importBatchId} is not null`),

    sectionCheck: check(
      'ledger_opening_balances_section_check',
      sql`${table.section} IN ('cb-loc', 'unbilled', 'ar', 'cb-prepay', 'untopped')`,
    ),
    sourceCheck: check(
      'ledger_opening_balances_source_check',
      sql`${table.source} IN ('excel', 'manual', 'migration')`,
    ),
    revisionCheck: check(
      'ledger_opening_balances_revision_check',
      sql`${table.revision} >= 1`,
    ),
  }),
);

export type LedgerOpeningBalance = typeof ledgerOpeningBalances.$inferSelect;
export type NewLedgerOpeningBalance = typeof ledgerOpeningBalances.$inferInsert;
