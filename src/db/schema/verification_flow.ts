/**
 * New-era Verification underwriting schema — the 10-phase new-applicant flow from
 * `Octane_New_Applicant_Underwriting_Flow`, owned entirely by Mytrion Postgres.
 *
 * Design mirrors `retention_cases.ts`: evolving phases/statuses live in LOOKUP TABLES so a new
 * status is an INSERT, never an ALTER TYPE, and the case row carries `phase_code` + `status_code`
 * as the two axes both desks read. Fixed picklists use the house `text().$type<T>()` + `as const`
 * tuple idiom (not pgEnum) so routes can `z.enum(TUPLE)` off the same constant.
 *
 * The shared record itself is `verification_cases` (see verification_cases.ts) — Sales fills intake,
 * Verification works the phases, both read and write the SAME row. Nothing here is a per-department
 * copy.
 *
 * Money is numeric(14,2). `verification_cases.approved_limit` is legacy text and stays that way;
 * `approved_limit_amount` is the typed one.
 */
import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---- Fixed picklists -----------------------------------------------------------------------

/** Flow A vs Flow B. `company` = LLC/corporation WITHOUT MC/DOT → Manager Review at Phase 1. */
export const VERIFICATION_APPLICANT_TYPES = ['owner_operator', 'carrier', 'company'] as const;
export type VerificationApplicantType = (typeof VERIFICATION_APPLICANT_TYPES)[number];

/** Phase 1 merge point: 1–20 cards → Octane internal underwriting, 21+ → WEX. */
export const VERIFICATION_ROUTES = ['octane_internal', 'wex'] as const;
export type VerificationRoute = (typeof VERIFICATION_ROUTES)[number];

/** How the applicant supplied banking. Both satisfy "last three bank statements OR Plaid". */
export const VERIFICATION_BANKING_SOURCES = ['statements', 'plaid'] as const;
export type VerificationBankingSource = (typeof VERIFICATION_BANKING_SOURCES)[number];

/** Where a case originated. Zoho ingest is retired; kept so an older row still reads correctly. */
export const VERIFICATION_CASE_ORIGINS = ['sales_application', 'zoho_deal'] as const;
export type VerificationCaseOrigin = (typeof VERIFICATION_CASE_ORIGINS)[number];

/** Per-phase state. `skipped` is explicit (owner-operator skips Phase 4/8) — never silent. */
export const VERIFICATION_PHASE_STATUSES = [
  'not_started',
  'in_progress',
  'passed',
  'pending_docs',
  'manager_review',
  'failed',
  'skipped',
] as const;
export type VerificationPhaseStatus = (typeof VERIFICATION_PHASE_STATUSES)[number];

/** What a credit agent can record at the end of any phase pane. */
export const VERIFICATION_PHASE_OUTCOMES = [
  'pass',
  'pending_docs',
  'manager_review',
  'additional_verification',
  'decline',
  'decline_blacklist',
  'deposit_prepaid',
  'skip',
] as const;
export type VerificationPhaseOutcome = (typeof VERIFICATION_PHASE_OUTCOMES)[number];

/** Which phase a table row belongs to. Carrier-only phases are 4 (authority) and 8 (Highway). */
export const VERIFICATION_PHASE_APPLIES_TO = ['all', 'carrier'] as const;
export type VerificationPhaseAppliesTo = (typeof VERIFICATION_PHASE_APPLIES_TO)[number];

export const VERIFICATION_DOC_TYPES = [
  'drivers_license',
  'ssn_card',
  'bank_statement',
  'lease_agreement',
  'corporate_guarantee',
  'insurance',
  'authority',
  'other',
] as const;
export type VerificationDocType = (typeof VERIFICATION_DOC_TYPES)[number];

/** `requested` rows carry no bytes — they ARE the Pending Documents list. */
export const VERIFICATION_DOC_STATUSES = ['requested', 'received', 'rejected'] as const;
export type VerificationDocStatus = (typeof VERIFICATION_DOC_STATUSES)[number];

/**
 * Verification documents get their OWN Dropbox root (`/verification`), never the comms or
 * Maintenance folder — same reasoning as `dropbox_maintenance`. The value is what tells
 * `storageFor()` which root to resolve, so it must travel on the row.
 */
export const VERIFICATION_STORAGE_PROVIDERS = ['s3', 'dropbox_verification'] as const;
export type VerificationStorageProvider = (typeof VERIFICATION_STORAGE_PROVIDERS)[number];

/** Identifiers Phase 3 screens on (both Check A blacklist and Check B duplicate). */
export const VERIFICATION_IDENTIFIER_TYPES = [
  'name',
  'ein',
  'ssn',
  'phone',
  'email',
  'address',
  'ip',
  'mc',
  'usdot',
] as const;
export type VerificationIdentifierType = (typeof VERIFICATION_IDENTIFIER_TYPES)[number];

export const VERIFICATION_SCREENING_CHECKS = ['blacklist', 'duplicate'] as const;
export type VerificationScreeningCheck = (typeof VERIFICATION_SCREENING_CHECKS)[number];

/** A hit is never actioned until a credit agent rules on it (PDF: "Credit Agent verifies the match"). */
export const VERIFICATION_SCREENING_VERDICTS = ['unverified', 'confirmed', 'false_match'] as const;
export type VerificationScreeningVerdict = (typeof VERIFICATION_SCREENING_VERDICTS)[number];

export const VERIFICATION_CREDIT_OUTCOMES = ['pass', 'borderline', 'unacceptable'] as const;
export type VerificationCreditOutcome = (typeof VERIFICATION_CREDIT_OUTCOMES)[number];

export const VERIFICATION_TRENDS = ['improving', 'stable', 'deteriorating'] as const;
export type VerificationTrend = (typeof VERIFICATION_TRENDS)[number];

export const VERIFICATION_VOLATILITY = ['low', 'moderate', 'high'] as const;
export type VerificationVolatility = (typeof VERIFICATION_VOLATILITY)[number];

export const VERIFICATION_RISK_TIERS = ['strong', 'moderate', 'weak'] as const;
export type VerificationRiskTier = (typeof VERIFICATION_RISK_TIERS)[number];

// ---- Lookups -------------------------------------------------------------------------------

/** The 10 phases. Seeded in 0121; `applies_to='carrier'` marks 4 and 8. */
export const verificationPhases = pgTable('verification_phases', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull(),
  appliesTo: text('applies_to').$type<VerificationPhaseAppliesTo>().notNull().default('all'),
  description: text('description'),
});

/**
 * Case-level statuses. `board_column` is the SALES projection of a Verification-owned status —
 * NULL means the status is desk-only and Sales never sees it, exactly like
 * `retention_statuses.board_column`.
 */
export const verificationStatuses = pgTable('verification_statuses', {
  code: text('code').primaryKey(),
  phaseCode: text('phase_code').notNull(),
  label: text('label').notNull(),
  isTerminal: boolean('is_terminal').notNull().default(false),
  /** draft | submitted | in_review | needs_you | approved | declined — or NULL for desk-only. */
  boardColumn: text('board_column'),
  sortOrder: smallint('sort_order').notNull().default(100),
});

export type VerificationPhaseRow = typeof verificationPhases.$inferSelect;
export type VerificationStatusRow = typeof verificationStatuses.$inferSelect;

// ---- Phase state machine -------------------------------------------------------------------

/**
 * One row per (case, phase). The state machine the phase rail renders. Phases 3/4/8 keep their
 * findings in `findings` jsonb; 6 and 9 have typed tables below because their numbers feed the
 * hard stops and the capacity formula and must be queryable.
 */
export const verificationCasePhases = pgTable(
  'verification_case_phases',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vcp_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    phaseCode: text('phase_code').notNull(),
    status: text('status').$type<VerificationPhaseStatus>().notNull().default('not_started'),
    outcome: text('outcome').$type<VerificationPhaseOutcome>(),
    findings: jsonb('findings').$type<Record<string, unknown>>().notNull().default({}),
    note: text('note'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: text('decided_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCasePhaseUq: uniqueIndex('verification_case_phases_tenant_case_phase_uq').on(
      table.tenantId,
      table.caseId,
      table.phaseCode,
    ),
    tenantCaseIdx: index('verification_case_phases_tenant_case_idx').on(table.tenantId, table.caseId),
  }),
);

/**
 * Append-only audit trail. Written INSIDE the repo call that changes phase/status so a transition
 * can never land without its event — the `retention_case_events` contract.
 */
export const verificationCaseEvents = pgTable(
  'verification_case_events',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vce_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    fromPhase: text('from_phase'),
    toPhase: text('to_phase'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    /** 'created' | 'intake_saved' | 'submitted' | 'phase_decision' | 'status_change' | 'docs_requested' | 'docs_received' | 'decision' | 'blacklisted' */
    eventType: text('event_type').notNull(),
    actorZohoUserId: text('actor_zoho_user_id'),
    actorName: text('actor_name'),
    notes: text('notes'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseTimeIdx: index('verification_case_events_case_occurred_idx').on(
      table.tenantId,
      table.caseId,
      table.occurredAt,
    ),
  }),
);

/**
 * WHO THE DESK GAVE EACH CASE TO, and when. Append-only.
 *
 * `verification_cases.verification_owner_zoho_user_id` is the CURRENT credit agent — one column, read
 * on every queue row. This is the history behind it, and it exists for two jobs that a single column
 * cannot do:
 *
 *  1. **Fairness.** Stage-0 routing picks the credit agent who was assigned LEAST RECENTLY, so it
 *     needs `max(assigned_at)` per agent. Deriving that from the case row would break the moment a
 *     case is reassigned — the previous agent's turn would vanish with it.
 *  2. **Answering "why me".** An agent who inherits a case, or loses one, can be shown when it moved
 *     and what moved it. No cursor is stored anywhere: the rotation is a consequence of these rows,
 *     which is the same argument `mytrion_comms_routing` makes for its own least-recently-assigned
 *     claim rather than a counter that can drift out of step with reality.
 *
 * `reason` is the mechanism, not prose — `stage0_round_robin` today, and whatever a manual reassign or
 * an escalation calls itself later.
 */
export const verificationCaseAssignments = pgTable(
  'verification_case_assignments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vca_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    /** The credit agent this case went to. */
    zohoUserId: text('zoho_user_id').notNull(),
    /** Directory name AT assignment time — a later rename must not rewrite history. */
    assigneeName: text('assignee_name'),
    /** Who it moved from, when it is a reassignment rather than the first assignment. */
    previousZohoUserId: text('previous_zoho_user_id'),
    /** 'stage0_round_robin' | 'manual' | … */
    reason: text('reason').notNull().default('stage0_round_robin'),
    /** The actor, when a human did it. NULL for the poller. */
    assignedByZohoUserId: text('assigned_by_zoho_user_id'),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /** The fairness probe: latest assignment per agent within a tenant. */
    tenantAgentTimeIdx: index('verification_case_assignments_tenant_agent_idx').on(
      table.tenantId,
      table.zohoUserId,
      table.assignedAt,
    ),
    /** One case's history, newest first. */
    tenantCaseIdx: index('verification_case_assignments_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
      table.assignedAt,
    ),
  }),
);

export type VerificationCaseAssignment = typeof verificationCaseAssignments.$inferSelect;

// ---- Intake satellites ---------------------------------------------------------------------

/** Flow B "Owner(s) / principal(s)". Full SSN is never stored — last 4 only. */
export const verificationCasePrincipals = pgTable(
  'verification_case_principals',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vpr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    fullName: text('full_name').notNull(),
    role: text('role'),
    ownershipPct: numeric('ownership_pct', { precision: 5, scale: 2 }),
    dateOfBirth: text('date_of_birth'),
    ssnLast4: text('ssn_last4'),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseIdx: index('verification_case_principals_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
    ),
  }),
);

/**
 * Deliberately NOT `file_assets` — that table's `storage_provider` is typed `CommsStorageProvider`
 * and has no verification folder, and its RBAC is shaped for agent-gateway tool files. Mirrors
 * `maintenance_case_attachments`: this row is metadata + key, the bytes live behind `storageFor()`.
 *
 * A row with `status='requested'` and no `s3_key` is a Pending-Documents ask. `requested_in_phase`
 * is what lets Phase 10 return the case to "the exact phase that generated the request".
 */
export const verificationCaseDocuments = pgTable(
  'verification_case_documents',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vdoc_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    docType: text('doc_type').$type<VerificationDocType>().notNull().default('other'),
    label: text('label'),
    status: text('status').$type<VerificationDocStatus>().notNull().default('received'),
    /** Phase that asked for this document — the return target when it arrives. */
    requestedInPhase: text('requested_in_phase'),
    fileName: text('file_name'),
    mime: text('mime'),
    sizeBytes: integer('size_bytes'),
    s3Key: text('s3_key'),
    storageProvider: text('storage_provider')
      .$type<VerificationStorageProvider>()
      .notNull()
      .default('dropbox_verification'),
    uploadedByUserId: text('uploaded_by_user_id'),
    uploadedByName: text('uploaded_by_name'),
    requestedBy: text('requested_by'),
    requestedAt: timestamp('requested_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseIdx: index('verification_case_documents_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
      table.createdAt,
    ),
    tenantStatusIdx: index('verification_case_documents_tenant_status_idx').on(
      table.tenantId,
      table.status,
    ),
  }),
);

// ---- Phase 3: screening (entirely local — no external API) ---------------------------------

/**
 * The Octane blacklist. Written by a Decline + Blacklist decision, read by Phase 3 Check A.
 * `value_hash` is a normalized SHA-256 so an SSN or EIN can be matched without being stored;
 * `value_display` is a masked, human-readable echo for the desk.
 */
export const verificationBlacklistEntries = pgTable(
  'verification_blacklist_entries',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vbl_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    entryType: text('entry_type').$type<VerificationIdentifierType>().notNull(),
    valueHash: text('value_hash').notNull(),
    valueLast4: text('value_last4'),
    valueDisplay: text('value_display'),
    reason: text('reason'),
    sourceCaseId: text('source_case_id'),
    addedBy: text('added_by'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    lookupIdx: index('verification_blacklist_entries_lookup_idx').on(
      table.tenantId,
      table.entryType,
      table.valueHash,
    ),
    tenantActiveUq: uniqueIndex('verification_blacklist_entries_tenant_type_hash_uq').on(
      table.tenantId,
      table.entryType,
      table.valueHash,
    ),
  }),
);

/** One row per identifier that matched, per check. Nothing acts on a hit until it is ruled on. */
export const verificationScreeningHits = pgTable(
  'verification_screening_hits',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vsh_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    checkType: text('check_type').$type<VerificationScreeningCheck>().notNull(),
    entryType: text('entry_type').$type<VerificationIdentifierType>().notNull(),
    matchedValueDisplay: text('matched_value_display'),
    /** Check A → the blacklist row. */
    matchedEntryId: text('matched_entry_id'),
    /** Check B → the other verification case this duplicates. */
    matchedCaseId: text('matched_case_id'),
    matchedCaseLabel: text('matched_case_label'),
    verdict: text('verdict').$type<VerificationScreeningVerdict>().notNull().default('unverified'),
    verifiedBy: text('verified_by'),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseIdx: index('verification_screening_hits_tenant_case_idx').on(
      table.tenantId,
      table.caseId,
      table.checkType,
    ),
  }),
);

// ---- Phase 6: credit + banking (typed — these numbers drive Phase 7 and 9) ------------------

export const verificationCreditReviews = pgTable(
  'verification_credit_reviews',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vcr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    creditScore: integer('credit_score'),
    latePayments: integer('late_payments'),
    collections: integer('collections'),
    utilizationPct: numeric('utilization_pct', { precision: 5, scale: 2 }),
    inquiries12m: integer('inquiries_12m'),
    historyMonths: integer('history_months'),
    openAccounts: integer('open_accounts'),
    totalDebt: numeric('total_debt', { precision: 14, scale: 2 }),
    revolvingAccounts: integer('revolving_accounts'),
    autoLoans: integer('auto_loans'),
    mortgages: integer('mortgages'),
    repaymentBehavior: text('repayment_behavior'),
    recentTrend: text('recent_trend').$type<VerificationTrend>(),
    /** Phase 7 hard stop: "No information found in the credit bureau". */
    bureauNoHit: boolean('bureau_no_hit').notNull().default(false),
    outcome: text('outcome').$type<VerificationCreditOutcome>(),
    note: text('note'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseUq: uniqueIndex('verification_credit_reviews_tenant_case_uq').on(
      table.tenantId,
      table.caseId,
    ),
  }),
);

/**
 * Last 3 months of banking. `avg_weekly_net_cash_flow` is stored AND derived — the two recurring
 * inputs are kept so the number that gates the unsecured LOC is auditable rather than asserted.
 */
export const verificationBankingReviews = pgTable(
  'verification_banking_reviews',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vbr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    periodStart: text('period_start'),
    periodEnd: text('period_end'),
    accountOwnershipVerified: boolean('account_ownership_verified').notNull().default(false),
    monthlyRevenue: numeric('monthly_revenue', { precision: 14, scale: 2 }),
    weeklyRevenue: numeric('weekly_revenue', { precision: 14, scale: 2 }),
    revenueTrend: text('revenue_trend').$type<VerificationTrend>(),
    recurringWeeklyIncome: numeric('recurring_weekly_income', { precision: 14, scale: 2 }),
    recurringWeeklyExpenses: numeric('recurring_weekly_expenses', { precision: 14, scale: 2 }),
    avgWeeklyNetCashFlow: numeric('avg_weekly_net_cash_flow', { precision: 14, scale: 2 }),
    avgMonthlyNetCashFlow: numeric('avg_monthly_net_cash_flow', { precision: 14, scale: 2 }),
    avgDailyBalance: numeric('avg_daily_balance', { precision: 14, scale: 2 }),
    endingBalance: numeric('ending_balance', { precision: 14, scale: 2 }),
    minimumBalance: numeric('minimum_balance', { precision: 14, scale: 2 }),
    negativeBalanceDays: integer('negative_balance_days'),
    nsfCount: integer('nsf_count'),
    achReturnCount: integer('ach_return_count'),
    overdraftCount: integer('overdraft_count'),
    /** Added back in Adjusted Weekly Capacity — must already be inside recurringWeeklyExpenses. */
    avgWeeklyFuelExpense: numeric('avg_weekly_fuel_expense', { precision: 14, scale: 2 }),
    existingDebtPayments: numeric('existing_debt_payments', { precision: 14, scale: 2 }),
    depositSources: jsonb('deposit_sources').$type<Record<string, unknown>>().notNull().default({}),
    majorExpenses: jsonb('major_expenses').$type<Record<string, unknown>>().notNull().default({}),
    oneTimeDeposits: numeric('one_time_deposits', { precision: 14, scale: 2 }),
    unusualTransactions: text('unusual_transactions'),
    cashFlowVolatility: text('cash_flow_volatility').$type<VerificationVolatility>(),
    /**
     * The SOP's "banking inconsistent with reported operations" manager-review indicator. A
     * judgement, not a number — an owner-operator whose statements show fleet-scale fuel spend is
     * the case this catches, and no stored figure expresses it.
     */
    bankingInconsistentWithOperations: boolean('banking_inconsistent_with_operations')
      .notNull()
      .default(false),
    note: text('note'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseUq: uniqueIndex('verification_banking_reviews_tenant_case_uq').on(
      table.tenantId,
      table.caseId,
    ),
  }),
);

// ---- Phase 9: risk tier + capacity ---------------------------------------------------------

export const verificationRiskAssessments = pgTable(
  'verification_risk_assessments',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `vra_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    caseId: text('case_id').notNull(),
    riskTier: text('risk_tier').$type<VerificationRiskTier>(),
    businessAgeMonths: integer('business_age_months'),
    authorityAgeMonths: integer('authority_age_months'),
    avgWeeklyNetCashFlow: numeric('avg_weekly_net_cash_flow', { precision: 14, scale: 2 }),
    avgWeeklyFuelExpense: numeric('avg_weekly_fuel_expense', { precision: 14, scale: 2 }),
    adjustedWeeklyCapacity: numeric('adjusted_weekly_capacity', { precision: 14, scale: 2 }),
    riskFactor: numeric('risk_factor', { precision: 4, scale: 3 }),
    recommendedLimit: numeric('recommended_limit', { precision: 14, scale: 2 }),
    requestedLimit: numeric('requested_limit', { precision: 14, scale: 2 }),
    analystRecommendation: text('analyst_recommendation'),
    keyRisks: jsonb('key_risks').$type<string[]>().notNull().default([]),
    /** The "Underwriting summary in Mytrion" payload the SOP enumerates. */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true }),
    assessedBy: text('assessed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantCaseUq: uniqueIndex('verification_risk_assessments_tenant_case_uq').on(
      table.tenantId,
      table.caseId,
    ),
  }),
);

// ---- Policy --------------------------------------------------------------------------------

/**
 * Tenant underwriting policy. Moderate and Weak factors are NULL on purpose — the SOP marks them
 * as unset placeholders, so `computeRecommendedLimit` REFUSES rather than inventing a number.
 * A wildcard default here would silently approve limits nobody signed off on.
 */
export const verificationPolicy = pgTable('verification_policy', {
  tenantId: text('tenant_id').primaryKey(),
  strongFactor: numeric('strong_factor', { precision: 4, scale: 3 }).default('0.800'),
  moderateFactor: numeric('moderate_factor', { precision: 4, scale: 3 }),
  weakFactor: numeric('weak_factor', { precision: 4, scale: 3 }),
  /** "very low average daily balance (approx. below $500)" → manager-review indicator. */
  adbReviewThreshold: numeric('adb_review_threshold', { precision: 14, scale: 2 })
    .notNull()
    .default('500'),
  /** "2+ NSF/returned ACH events" → manager-review indicator. */
  nsfReviewThreshold: integer('nsf_review_threshold').notNull().default(2),
  /** Carrier with 10+ trucks reviews Banking first. */
  bankFirstTruckMin: integer('bank_first_truck_min').notNull().default(10),
  /** 1–20 cards → Octane internal; 21+ → WEX. */
  wexCardCutoff: integer('wex_card_cutoff').notNull().default(20),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---- Inferred types ------------------------------------------------------------------------

export type VerificationCasePhase = typeof verificationCasePhases.$inferSelect;
export type NewVerificationCasePhase = typeof verificationCasePhases.$inferInsert;
export type VerificationCaseEvent = typeof verificationCaseEvents.$inferSelect;
export type NewVerificationCaseEvent = typeof verificationCaseEvents.$inferInsert;
export type VerificationCasePrincipal = typeof verificationCasePrincipals.$inferSelect;
export type NewVerificationCasePrincipal = typeof verificationCasePrincipals.$inferInsert;
export type VerificationCaseDocument = typeof verificationCaseDocuments.$inferSelect;
export type NewVerificationCaseDocument = typeof verificationCaseDocuments.$inferInsert;
export type VerificationBlacklistEntry = typeof verificationBlacklistEntries.$inferSelect;
export type NewVerificationBlacklistEntry = typeof verificationBlacklistEntries.$inferInsert;
export type VerificationScreeningHit = typeof verificationScreeningHits.$inferSelect;
export type NewVerificationScreeningHit = typeof verificationScreeningHits.$inferInsert;
export type VerificationCreditReview = typeof verificationCreditReviews.$inferSelect;
export type NewVerificationCreditReview = typeof verificationCreditReviews.$inferInsert;
export type VerificationBankingReview = typeof verificationBankingReviews.$inferSelect;
export type NewVerificationBankingReview = typeof verificationBankingReviews.$inferInsert;
export type VerificationRiskAssessment = typeof verificationRiskAssessments.$inferSelect;
export type NewVerificationRiskAssessment = typeof verificationRiskAssessments.$inferInsert;
export type VerificationPolicyRow = typeof verificationPolicy.$inferSelect;

// ---- Seed constants (must match the 0121 seed) ---------------------------------------------

export const VERIFICATION_PHASE = {
  intake: 'p1_intake',
  identity: 'p2_identity',
  screening: 'p3_screening',
  authority: 'p4_authority',
  routing: 'p5_routing',
  creditBanking: 'p6_credit_banking',
  hardStops: 'p7_hard_stops',
  highway: 'p8_highway',
  riskCapacity: 'p9_risk_capacity',
  decision: 'p10_decision',
} as const;
export type VerificationPhaseCode = (typeof VERIFICATION_PHASE)[keyof typeof VERIFICATION_PHASE];

export const VERIFICATION_PHASE_ORDER: readonly VerificationPhaseCode[] = [
  VERIFICATION_PHASE.intake,
  VERIFICATION_PHASE.identity,
  VERIFICATION_PHASE.screening,
  VERIFICATION_PHASE.authority,
  VERIFICATION_PHASE.routing,
  VERIFICATION_PHASE.creditBanking,
  VERIFICATION_PHASE.hardStops,
  VERIFICATION_PHASE.highway,
  VERIFICATION_PHASE.riskCapacity,
  VERIFICATION_PHASE.decision,
] as const;

export const VERIFICATION_STATUS = {
  intakeIncomplete: 'intake_incomplete',
  intakeSubmitted: 'intake_submitted',
  inReview: 'in_review',
  pendingDocs: 'pending_docs',
  managerReview: 'manager_review',
  additionalVerification: 'additional_verification',
  approved: 'approved',
  depositPrepaid: 'deposit_prepaid',
  routedWex: 'routed_wex',
  declined: 'declined',
  declinedCustomer: 'declined_customer',
  declinedBlacklist: 'declined_blacklist',
} as const;
export type VerificationStatusCode = (typeof VERIFICATION_STATUS)[keyof typeof VERIFICATION_STATUS];

/** Sales Kanban columns — matches `verification_statuses.board_column`. */
export const VERIFICATION_BOARD_COLUMN = {
  draft: 'draft',
  submitted: 'submitted',
  inReview: 'in_review',
  needsYou: 'needs_you',
  approved: 'approved',
  declined: 'declined',
} as const;

/** Terminal status codes — must match the `is_terminal` seed in 0121. */
export const VERIFICATION_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  VERIFICATION_STATUS.approved,
  VERIFICATION_STATUS.depositPrepaid,
  VERIFICATION_STATUS.routedWex,
  VERIFICATION_STATUS.declined,
  VERIFICATION_STATUS.declinedCustomer,
  VERIFICATION_STATUS.declinedBlacklist,
]);
