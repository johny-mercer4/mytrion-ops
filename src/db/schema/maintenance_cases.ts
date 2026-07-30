import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * maintenance_cases — Octane's maintenance case queue, replacing the Zoho CRM `Maintenance` module.
 *
 * Postgres is the SOURCE OF TRUTH. Zoho's 2,714 existing records were migrated once
 * (scripts/migrateMaintenanceFromZoho.ts) and Zoho is not read again: the CS Mytrion Maintenance
 * tab creates and edits cases here directly. There is deliberately no sync job, no Modified_Time
 * watermark, and no write-back.
 *
 * Two consequences of that, recorded here because they are invisible from this file:
 *   - servercrm's prepay ledger (services/prepayLedger.js) still sums `Total_Amount` from ZOHO for
 *     rows with Payment_Method = 'Prepay / EFS'. Cases created in Mytrion never reach Zoho, so that
 *     column undercounts until it is repointed at this table.
 *   - the carrier-facing self-service widget still creates cases through the `createmaintenance`
 *     Deluge, straight into Zoho. Those do not appear here; the migration script is idempotent and
 *     re-runnable if they ever need importing.
 *
 * Promoted display columns + `raw` (the full Zoho record for migrated rows) — the
 * payment_transactions pattern — so a field we did not promote is still recoverable without a
 * migration.
 *
 * NOT tenant-scoped: keyed on the `carrier_id` domain, a global operational table
 * (payment_transactions / money-code precedent). `carrier_id` and `unit_number` are TEXT — Zoho
 * stores the carrier id as text, and unit numbers arrive zero-padded ('012'), which an integer
 * column would destroy. NUMERIC round-trips as a string in Drizzle; writes go through the `money()`
 * helper in modules/customerService/maintenanceFields.ts.
 */
export const maintenanceCases = pgTable(
  'maintenance_cases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mtc_${createId()}`),

    // ── Provenance ───────────────────────────────────────────────────────────
    /** Zoho record id for migrated rows; NULL for cases created in Mytrion. */
    zohoRecordId: text('zoho_record_id'),
    source: text('source').$type<'zoho_migration' | 'mytrion'>().notNull().default('mytrion'),

    // ── Identity / the three search keys ─────────────────────────────────────
    /** Zoho `Name` — labelled "Company Name", the module's mandatory display field. */
    name: text('name'),
    /** The linked Accounts record (Zoho `Company` lookup); casing can differ from `name`. */
    companyZohoId: text('company_zoho_id'),
    companyName: text('company_name'),
    carrierId: text('carrier_id'),
    unitNumber: text('unit_number'),

    // ── Case ─────────────────────────────────────────────────────────────────
    status: text('status'), // In Process | Completed | Cancelled
    caseType: text('case_type'), // Mechanical | PMs | Tire Replacement | …
    /** Zoho `Date`. Renamed: `date` is a poor column name and `Date` is a COQL-touchy identifier. */
    caseDate: date('case_date'),
    /** Zoho `Case_Completion` ("Completion Date") — the sign-off that makes a case fully complete. */
    caseCompletion: date('case_completion'),

    driverName: text('driver_name'),
    phone: text('phone'),
    shopNumber: text('shop_number'), // e.g. 'Loves #388'
    parts: text('parts'),
    workOrderId: text('work_order_id'),
    /** Identifier, never arithmetic — TEXT even though Zoho types it as an integer. */
    referenceNumber: text('reference_number'),

    // ── Payment ──────────────────────────────────────────────────────────────
    paymentMethod: text('payment_method'), // LOC | Prepay / Card | Prepay / Zelle | Prepay / EFS | Selfpay
    paymentStatus: text('payment_status'), // Paid | Pending | Not Paid | Delay | N/A
    invoiced: boolean('invoiced'),
    /** TEXT to preserve leading zeros. */
    cardDigits: text('card_digits'),

    // ── Money ────────────────────────────────────────────────────────────────
    totalAmount: numeric('total_amount', { precision: 14, scale: 2 }),
    /** Set on nearly every Zoho row — does NOT discriminate whether a case completed. */
    completionCompensation: numeric('completion_compensation', { precision: 14, scale: 2 }),
    halfCompletionCompensation: numeric('half_completion_compensation', { precision: 14, scale: 2 }),
    leadCompensation: numeric('lead_compensation', { precision: 14, scale: 2 }),

    // ── Ownership ────────────────────────────────────────────────────────────
    ownerZohoUserId: text('owner_zoho_user_id'),
    /** FULL name. Zoho's COQL returns Owner.name as the LAST NAME ONLY; the migration resolved it
     *  through the user directory before writing. */
    ownerName: text('owner_name'),
    bonusCompletionUserId: text('bonus_completion_user_id'),
    bonusCompletionName: text('bonus_completion_name'),
    bonusLeadUserId: text('bonus_lead_user_id'),
    bonusLeadName: text('bonus_lead_name'),

    // ── Zoho stamps (migrated rows) ──────────────────────────────────────────
    createdTime: timestamp('created_time', { withTimezone: true }),
    modifiedTime: timestamp('modified_time', { withTimezone: true }),

    // ── Our bookkeeping ──────────────────────────────────────────────────────
    /** Full original Zoho record; null for cases created in Mytrion. */
    raw: jsonb('raw').$type<Record<string, unknown>>(),
    /** Session user who created / last edited the row in Mytrion. A re-run of the migration must
     *  never clobber these — they are absent from upsertMany's conflict `set`. */
    createdByUserId: text('created_by_user_id'),
    createdByName: text('created_by_name'),
    updatedByUserId: text('updated_by_user_id'),
    updatedByName: text('updated_by_name'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** Migration upsert key. PARTIAL — every Mytrion-created row has a null zoho_record_id, and a
     *  plain unique index would collide on the second one. */
    zohoUk: uniqueIndex('maintenance_cases_zoho_uk')
      .on(table.zohoRecordId)
      .where(sql`${table.zohoRecordId} IS NOT NULL`),
    /** Ascending order + the `case_date` RANGE predicates (analytics windows, prepay day buckets).
     *  Closed with `id` so the sort is total — an offset page cannot skip or duplicate a row when
     *  many cases share a date. */
    caseDateIdx: index('maintenance_cases_case_date_idx').on(table.caseDate, table.id),
    /** The DEFAULT list order, matched exactly. A backward scan of the ascending index above cannot
     *  serve it: DESC implies NULLS FIRST, so `DESC NULLS LAST` fell back to a seq scan + top-N sort
     *  on every page and every search (see 0080_maintenance_cases_sort_idx.sql). */
    caseDateDescIdx: index('maintenance_cases_case_date_desc_idx').on(
      sql`${table.caseDate} DESC NULLS LAST`,
      sql`${table.id} DESC`,
    ),
    statusIdx: index('maintenance_cases_status_idx').on(table.status, table.caseDate),
    caseTypeIdx: index('maintenance_cases_case_type_idx').on(table.caseType),
    carrierIdx: index('maintenance_cases_carrier_idx').on(table.carrierId),
    ownerIdx: index('maintenance_cases_owner_idx').on(table.ownerZohoUserId, table.caseDate),
    paymentIdx: index('maintenance_cases_payment_idx').on(table.paymentMethod, table.paymentStatus),
  }),
);

export type MaintenanceCase = typeof maintenanceCases.$inferSelect;
export type NewMaintenanceCase = typeof maintenanceCases.$inferInsert;
