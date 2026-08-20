/**
 * Collection workspace — bad-debt cases, their unpaid CMP invoices, and Array tradeline snapshots.
 *
 * These three tables already live in the app Postgres (finder-written, seeded). They are keyed on
 * the carrier_id domain, the same global-operational pattern as `maintenance_cases` /
 * `payment_transactions`: there is no `tenant_id` column, UNIQUE is on the carrier (or
 * carrier+period), and the finder that upserts them does not know about Octane tenants. Isolation
 * is enforced in the repo layer — a non-`octane` tenant is served an empty page rather than the
 * Octane debtor book.
 *
 * `collection_cases` is one row per carrier (UNIQUE carrier_id). It NEVER loses a row: the Zoho
 * finder opens a case at `remaining >= 0.01` and, when the carrier settles or leaves CMP, zeroes
 * the money fields rather than deleting ("No case deletion (history preserved)"). There is no
 * $100 floor anywhere in the pipeline. Invoices hang off the case and cascade.
 *
 * `array_reports` is a Metro 2 snapshot per (carrier_id, report_period) — the live 6h cron writes
 * Zoho; this table is what the desk reads. `report_period` is a HUMAN-FORMATTED string
 * (`'Aug 2026'`), so it does not sort: order by `reportPeriodSortKey` from repos/arrayPeriod.ts,
 * never by the column itself.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const COLLECTION_CASE_STATUSES = ['open', 'closed'] as const;
export type CollectionCaseStatus = (typeof COLLECTION_CASE_STATUSES)[number];

/**
 * The stage vocabulary, one slug per stage of the Zoho Blueprint on `Collection_Cases`.
 *
 * This list used to hold eight of the sixteen. The eight it dropped were the whole no-contact
 * ladder (`nc_attempt_1..3` → `usps_letter`), the two recovery-from-failure stages
 * (`reconnect_attempt`, `failed_promise`) and the two legal stages above small claims
 * (`legal_action`, `civil_court`) — which is to say, most of the early-funnel work the Today
 * worklist exists to drive. Read `GET Collection_Cases/{id}/actions/blueprint` against Zoho to
 * see the transitions; the graph is documented in the collections atlas.
 *
 * The original eight keep their slugs, so no stored value changes.
 *
 * NOT here: Zoho also has seven records stranded on a `Debt Closed` value that is not in its own
 * picklist and has no blueprint transitions. Representing a broken state as a valid one would
 * just move the problem; those records need fixing at the source.
 */
export const COLLECTION_STAGES = [
  'intake',
  'nc_attempt_1',
  'nc_attempt_2',
  'nc_attempt_3',
  'usps_letter',
  'connected',
  'payment_plan',
  'reconnect_attempt',
  'failed_promise',
  'with_agency',
  'skip_tracing',
  'legal_action',
  'small_claims',
  'civil_court',
  'closed_successfully',
  'case_lost',
] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];

export const COLLECTION_CLOSED_REASONS = [
  'paid_in_full',
  'below_threshold',
  'left_cmp',
  'manual',
  'case_lost',
] as const;
export type CollectionClosedReason = (typeof COLLECTION_CLOSED_REASONS)[number];

export const collectionCases = pgTable(
  'collection_cases',
  {
    id: text('id').primaryKey(),
    zohoRecordId: text('zoho_record_id'),
    source: text('source').notNull(),
    carrierId: text('carrier_id').notNull(),
    status: text('status').$type<CollectionCaseStatus>().notNull(),
    collectionStage: text('collection_stage').$type<CollectionStage>().notNull(),
    caseCreatedDate: date('case_created_date').notNull(),
    placementDate: date('placement_date'),
    reopenCount: integer('reopen_count').notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: text('closed_reason').$type<CollectionClosedReason>(),
    totalDebtAmount: numeric('total_debt_amount').notNull(),
    totalInvoiceAmount: numeric('total_invoice_amount').notNull(),
    totalAmountPaid: numeric('total_amount_paid').notNull(),
    issueInvoiceCount: integer('issue_invoice_count').notNull(),
    firstDelinquentDate: date('first_delinquent_date'),
    daysPastDue: integer('days_past_due').notNull(),
    collectionTriggerRule: text('collection_trigger_rule'),
    currency: text('currency').notNull(),
    displayName: text('display_name'),
    debtorCompanyName: text('debtor_company_name'),
    debtorFullName: text('debtor_full_name'),
    debtorEmail: text('debtor_email'),
    debtorSecondaryEmail: text('debtor_secondary_email'),
    debtorPhone: text('debtor_phone'),
    debtorCellPhone: text('debtor_cell_phone'),
    debtorAddress: text('debtor_address'),
    debtorCity: text('debtor_city'),
    debtorState: text('debtor_state'),
    debtorZipCode: text('debtor_zip_code'),
    debtorMcDot: text('debtor_mc_dot'),
    debtorDateOfBirth: date('debtor_date_of_birth'),
    zohoDealId: text('zoho_deal_id'),
    agencyTransferDate: date('agency_transfer_date'),
    firstCollectionAgency: text('first_collection_agency'),
    assigneeUserId: text('assignee_user_id'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    carrierUk: uniqueIndex('collection_cases_carrier_uk').on(table.carrierId),
    zohoUk: uniqueIndex('collection_cases_zoho_uk')
      .on(table.zohoRecordId)
      .where(sql`${table.zohoRecordId} IS NOT NULL`),
    statusStageIdx: index('collection_cases_status_stage_idx').on(table.status, table.collectionStage),
    openDebtIdx: index('collection_cases_open_debt_idx')
      .on(table.status, table.totalDebtAmount)
      .where(sql`${table.status} = 'open'`),
    placementIdx: index('collection_cases_placement_idx')
      .on(table.placementDate)
      .where(sql`${table.placementDate} IS NOT NULL`),
    zohoDealIdx: index('collection_cases_zoho_deal_idx')
      .on(table.zohoDealId)
      .where(sql`${table.zohoDealId} IS NOT NULL`),
  }),
);

export const collectionCaseInvoices = pgTable(
  'collection_case_invoices',
  {
    id: text('id').primaryKey(),
    caseId: text('case_id')
      .notNull()
      .references(() => collectionCases.id, { onDelete: 'cascade' }),
    cmpInvoiceId: bigint('cmp_invoice_id', { mode: 'number' }).notNull(),
    invoiceNumber: text('invoice_number'),
    cmpStage: text('cmp_stage'),
    status: text('status'),
    periodFrom: date('period_from'),
    periodTo: date('period_to'),
    periodLabel: text('period_label'),
    totalAmount: numeric('total_amount').notNull(),
    totalPaid: numeric('total_paid').notNull(),
    remainingAmount: numeric('remaining_amount').notNull(),
    totalMerchantFee: numeric('total_merchant_fee').notNull(),
    dueDate: date('due_date'),
    cmpCreateDate: date('cmp_create_date'),
    paymentDay: text('payment_day'),
    invoiceNotes: text('invoice_notes'),
    zohoDealId: text('zoho_deal_id'),
    cmpUpdateDate: timestamp('cmp_update_date', { withTimezone: true }),
    dataSource: text('data_source').notNull(),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    caseCmpUk: uniqueIndex('collection_case_invoices_case_cmp_uk').on(table.caseId, table.cmpInvoiceId),
    caseIdx: index('collection_case_invoices_case_idx').on(table.caseId),
    cmpIdx: index('collection_case_invoices_cmp_idx').on(table.cmpInvoiceId),
  }),
);

export const arrayReports = pgTable(
  'array_reports',
  {
    id: text('id').primaryKey(),
    zohoRecordId: text('zoho_record_id'),
    carrierId: text('carrier_id').notNull(),
    reportPeriod: text('report_period').notNull(),
    displayName: text('display_name'),
    companyName: text('company_name'),
    customerAccountNumber: text('customer_account_number'),
    associationCode: text('association_code'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    firstLineOfAddress: text('first_line_of_address'),
    secondLineOfAddress: text('second_line_of_address'),
    city: text('city'),
    state: text('state'),
    zipCode: text('zip_code'),
    telephoneNumber: text('telephone_number'),
    email: text('email'),
    secondaryEmail: text('secondary_email'),
    dateOfBirth: date('date_of_birth'),
    dateOpen: date('date_open'),
    carrierType: text('carrier_type'),
    accountStatus: text('account_status'),
    accountType: text('account_type'),
    portfolioType: text('portfolio_type'),
    paymentRating: text('payment_rating'),
    paymentHistoryProfile: text('payment_history_profile'),
    terms: text('terms'),
    termsFrequency: text('terms_frequency'),
    creditLimit: numeric('credit_limit'),
    highestCredit: numeric('highest_credit'),
    currentBalance: numeric('current_balance'),
    amountPastDue: numeric('amount_past_due'),
    dateOfFirstDelinquency: date('date_of_first_delinquency'),
    dateOfLastPayment: date('date_of_last_payment'),
    dateClosed: date('date_closed'),
    placementDate: date('placement_date'),
    agencyTransferDate: date('agency_transfer_date'),
    hasAgency: boolean('has_agency'),
    agencyName: text('agency_name'),
    monthsDelinquent: integer('months_delinquent'),
    excludedReason: text('excluded_reason'),
    validationErrors: text('validation_errors'),
    needsDobLookup: boolean('needs_dob_lookup'),
    currency: text('currency').notNull(),
    zohoOwnerId: text('zoho_owner_id'),
    zohoCreatedTime: timestamp('zoho_created_time', { withTimezone: true }),
    zohoModifiedTime: timestamp('zoho_modified_time', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    carrierPeriodUk: uniqueIndex('array_reports_carrier_period_uk').on(table.carrierId, table.reportPeriod),
    zohoUk: uniqueIndex('array_reports_zoho_uk')
      .on(table.zohoRecordId)
      .where(sql`${table.zohoRecordId} IS NOT NULL`),
    carrierIdx: index('array_reports_carrier_idx').on(table.carrierId),
    periodIdx: index('array_reports_period_idx').on(table.reportPeriod),
    statusTypeIdx: index('array_reports_status_type_idx').on(table.accountStatus, table.carrierType),
  }),
);

export type CollectionCase = typeof collectionCases.$inferSelect;
export type NewCollectionCase = typeof collectionCases.$inferInsert;
export type CollectionCaseInvoice = typeof collectionCaseInvoices.$inferSelect;
export type NewCollectionCaseInvoice = typeof collectionCaseInvoices.$inferInsert;
export type ArrayReport = typeof arrayReports.$inferSelect;
export type NewArrayReport = typeof arrayReports.$inferInsert;
