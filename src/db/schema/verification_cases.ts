import { createId } from '@paralleldrive/cuid2';
import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const VERIFICATION_CASE_STATUSES = [
  'new',
  'in_progress',
  'awaiting_decision',
  'approved',
  'rejected',
  'failed',
] as const;
export type VerificationCaseStatus = (typeof VERIFICATION_CASE_STATUSES)[number];

export const VERIFICATION_DISTRIBUTE_TYPES = ['personal', 'shared'] as const;
export type VerificationDistributeType = (typeof VERIFICATION_DISTRIBUTE_TYPES)[number];

export const VERIFICATION_MATCH_VIA = ['phone', 'email', 'dot', 'company_name'] as const;
export type VerificationMatchVia = (typeof VERIFICATION_MATCH_VIA)[number];

export const VERIFICATION_STAGE_STATUSES = [
  'pending',
  'ready',
  'running',
  'ran',
  'approved',
  'skipped',
  'failed',
] as const;
export type VerificationStageStatus = (typeof VERIFICATION_STAGE_STATUSES)[number];

/** Mytrion-owned first-run inbox sequence (patch → pre-stop → blacklist → FMCSA). */
export const VERIFICATION_FIRST_RUN_STATUSES = ['idle', 'in_flight', 'completed', 'error'] as const;
export type VerificationFirstRunStatus = (typeof VERIFICATION_FIRST_RUN_STATUSES)[number];

export const VERIFICATION_FIRST_RUN_STEPS = [
  'patch',
  'stop_factor_pre',
  'blacklist',
  'fmcsa',
] as const;
export type VerificationFirstRunStep = (typeof VERIFICATION_FIRST_RUN_STEPS)[number];

/**
 * One Zoho Deal ingested as a Verification Mytrion case. Pipeline truth still lives in
 * credit_platform `requests`; this row is the Mytrion-owned intake + assignment + list model.
 */
export const verificationCases = pgTable(
  'verification_cases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vc_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoDealId: text('zoho_deal_id').notNull(),
    zohoApplicationId: text('zoho_application_id'),
    carrierId: text('carrier_id'),
    requestId: text('request_id'),
    companyName: text('company_name'),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    phone: text('phone'),
    cell: text('cell'),
    address: text('address'),
    city: text('city'),
    state: text('state'),
    zip: text('zip'),
    dateOfBirth: text('date_of_birth'),
    dot: text('dot'),
    mc: text('mc'),
    truckCount: text('truck_count'),
    businessType: text('business_type'),
    zohoStage: text('zoho_stage'),
    applicationStatus: text('application_status'),
    applicationDate: text('application_date'),
    creditScore: text('credit_score'),
    creditsafeGrade: text('creditsafe_grade'),
    zohoOwnerId: text('zoho_owner_id'),
    zohoOwnerName: text('zoho_owner_name'),
    zohoRaw: jsonb('zoho_raw').$type<Record<string, unknown>>().notNull().default({}),
    distributeType: text('distribute_type').$type<VerificationDistributeType>().notNull().default('shared'),
    ownerZohoUserId: text('owner_zoho_user_id').notNull(),
    ownerName: text('owner_name').notNull(),
    matchedSnapshotId: text('matched_snapshot_id'),
    matchedVia: text('matched_via').$type<VerificationMatchVia>(),
    carrierOperatingStatus: text('carrier_operating_status'),
    carrierUnits: text('carrier_units'),
    carrierAddress: text('carrier_address'),
    carrierDot: text('carrier_dot'),
    carrierPhone: text('carrier_phone'),
    carrierEmail: text('carrier_email'),
    status: text('status').$type<VerificationCaseStatus>().notNull().default('new'),
    currentStage: text('current_stage'),
    stagesDone: integer('stages_done').notNull().default(0),
    stagesTotal: integer('stages_total').notNull().default(10),
    lastDecision: text('last_decision'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    firstRunStatus: text('first_run_status')
      .$type<VerificationFirstRunStatus>()
      .notNull()
      .default('idle'),
    firstRunStep: text('first_run_step').$type<VerificationFirstRunStep>(),
    firstRunInboxId: integer('first_run_inbox_id'),
    firstRunError: text('first_run_error'),
    cpOwnerUsername: text('cp_owner_username'),
    approvedLimit: text('approved_limit'),
    paymentType: text('payment_type'),
    billingCycle: text('billing_cycle'),
    plaidStatus: text('plaid_status'),
    plaidLinkUrl: text('plaid_link_url'),
    plaidMode: text('plaid_mode'),
    cpClaimedAt: timestamp('cp_claimed_at', { withTimezone: true }),
    cpReviewUpdatedAt: timestamp('cp_review_updated_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantDealUq: uniqueIndex('verification_cases_tenant_deal_uq').on(table.tenantId, table.zohoDealId),
    tenantStatusIdx: index('verification_cases_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    tenantOwnerIdx: index('verification_cases_tenant_owner_idx').on(table.tenantId, table.ownerZohoUserId),
  }),
);

export const verificationCaseStages = pgTable(
  'verification_case_stages',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vcs_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    stageId: text('stage_id').notNull(),
    status: text('status').$type<VerificationStageStatus>().notNull().default('pending'),
    result: jsonb('result').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    ranAt: timestamp('ran_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: text('approved_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseStageUq: uniqueIndex('verification_case_stages_tenant_case_stage_uq').on(
      table.tenantId,
      table.caseId,
      table.stageId,
    ),
    tenantCaseIdx: index('verification_case_stages_tenant_case_idx').on(table.tenantId, table.caseId),
  }),
);

/** Singleton-per-tenant Created_Time cursor for the 30-minute Zoho Deals poll. */
export const verificationIngestState = pgTable(
  'verification_ingest_state',
  {
    tenantId: text('tenant_id').primaryKey(),
    pollDealDateWatermark: text('poll_deal_date_watermark').notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    lastCreated: integer('last_created').notNull().default(0),
    lastSkipped: integer('last_skipped').notNull().default(0),
    lastFailed: integer('last_failed').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    watermarkChk: index('verification_ingest_state_watermark_idx').on(table.pollDealDateWatermark),
  }),
);

export type VerificationCase = typeof verificationCases.$inferSelect;
export type NewVerificationCase = typeof verificationCases.$inferInsert;
export type VerificationCaseStage = typeof verificationCaseStages.$inferSelect;
export type NewVerificationCaseStage = typeof verificationCaseStages.$inferInsert;
export type VerificationIngestState = typeof verificationIngestState.$inferSelect;
