/**
 * Retention workflow schema (v2).
 *
 * Design: evolving phases/statuses live in lookup tables (attach metadata without ALTER TYPE);
 * only tiny fixed picklists use native Postgres enums (channel, dissatisfaction reason,
 * transaction frequency, agent outcome). There is no local `deals` / `agents` table — Zoho
 * ids and DWH carrier ids are stored as text. Isolation is tenant-scoped in the repo layer.
 *
 * Replaces the flat 0020/0023 `retention_cases` shape. Episode history regenerates from the
 * DWH frequency-breach sync after migrate.
 */
import {
  bigint,
  bigserial,
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ---- Fixed picklists (native enums) --------------------------------------------------------

export const communicationChannelEnum = pgEnum('communication_channel', [
  'telegram',
  'whatsapp',
  'sms',
  'ringcentral',
  'instagram',
  'facebook',
  'email',
]);

export const dissatisfactionReasonEnum = pgEnum('dissatisfaction_reason', [
  'low_discounts',
  'payment_cycle',
  'cs_service',
  'trust_issues',
  'switched_other',
]);

/** high = every ~2d · medium = every ~5d · low = every ~7d */
export const transactionFrequencyEnum = pgEnum('transaction_frequency', [
  'high',
  'medium',
  'low',
]);

export const agentOutcomeEnum = pgEnum('agent_outcome', [
  'out_of_reach',
  'reached',
  'returned',
  'dissatisfied',
  'vacation',
  'no_action_2bd',
]);

export type CommunicationChannel = (typeof communicationChannelEnum.enumValues)[number];
export type DissatisfactionReason = (typeof dissatisfactionReasonEnum.enumValues)[number];
export type TransactionFrequency = (typeof transactionFrequencyEnum.enumValues)[number];
/** Alias kept for DWH helpers that historically used FrequencyClass. */
export type FrequencyClass = TransactionFrequency;
export type AgentOutcome = (typeof agentOutcomeEnum.enumValues)[number];

// ---- Lookups -------------------------------------------------------------------------------

export const retentionPhases = pgTable('retention_phases', {
  code: text('code').primaryKey(),
  label: text('label').notNull(),
  sortOrder: smallint('sort_order').notNull(),
});

export const retentionStatuses = pgTable('retention_statuses', {
  code: text('code').primaryKey(),
  phaseCode: text('phase_code')
    .notNull()
    .references(() => retentionPhases.code),
  label: text('label').notNull(),
  isTerminal: boolean('is_terminal').notNull().default(false),
  /**
   * Sales Agent Kanban column:
   * new | reached | out_of_reach | vacation | dissatisfied | closed
   * Null = not shown on the Sales board (Retention-desk-only statuses).
   */
  boardColumn: text('board_column'),
  sortOrder: smallint('sort_order').notNull().default(100),
});

export type RetentionPhaseRow = typeof retentionPhases.$inferSelect;
export type RetentionStatusRow = typeof retentionStatuses.$inferSelect;

// ---- Core case -----------------------------------------------------------------------------

/**
 * One row per at-risk carrier episode. `closed_at IS NULL` = open (partial unique on
 * tenant+carrier). Terminal statuses stamp `closed_at`; Citi (`phase_3_citi`) is final and
 * never auto-closed by the DWH sync.
 */
export const retentionCases = pgTable(
  'retention_cases',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),

    /** DWH/EFS carrier company id — natural key of a case (sync join). */
    carrierId: text('carrier_id').notNull(),
    /** Zoho CRM Deal id when known (no local deals table). */
    zohoDealId: text('zoho_deal_id'),
    companyName: text('company_name'),
    applicationId: text('application_id'),
    /** Denormalized deal-owner display name (sync). */
    agentName: text('agent_name'),

    phaseCode: text('phase_code')
      .notNull()
      .references(() => retentionPhases.code)
      .default('phase_1_agent'),
    statusCode: text('status_code')
      .notNull()
      .references(() => retentionStatuses.code)
      .default('p1_in_progress'),
    phaseChangedAt: timestamp('phase_changed_at', { withTimezone: true }).notNull().defaultNow(),

    transactionFrequency: transactionFrequencyEnum('transaction_frequency'),
    agentOutcome: agentOutcomeEnum('agent_outcome'),
    dissatisfactionReason: dissatisfactionReasonEnum('dissatisfaction_reason'),
    reasonNote: text('reason_note'),

    assignedAgentZohoUserId: text('assigned_agent_zoho_user_id'),
    /**
     * Last deal owner when the case entered Open Pool — approves claim requests
     * (Sales agent-to-agent transfer). Cleared when a claim is finalized.
     */
    poolOwnerZohoUserId: text('pool_owner_zoho_user_id'),
    /** Claimant waiting on pool-owner approve / 1 BD auto-approve. */
    pendingClaimantZohoUserId: text('pending_claimant_zoho_user_id'),
    /** Caps at 3 (Open Pool rule). */
    assignmentCount: smallint('assignment_count').notNull().default(1),
    openPoolAttemptCount: smallint('open_pool_attempt_count').notNull().default(0),
    /** Caps at 5. */
    outOfReachAttempts: smallint('out_of_reach_attempts').notNull().default(0),
    dealOwnerChanged: boolean('deal_owner_changed').notNull().default(false),

    currentDeadlineAt: timestamp('current_deadline_at', { withTimezone: true }),
    /** e.g. '2BD_agent_action' | '5BD_comms_attempt' | '5BD_post_contact' | '10BD_retention' */
    currentDeadlineType: text('current_deadline_type'),
    vacationCountdownEnd: timestamp('vacation_countdown_end', { withTimezone: true }),
    citiFolderEnteredAt: timestamp('citi_folder_entered_at', { withTimezone: true }),
    citiFolderHoldUntil: timestamp('citi_folder_hold_until', { withTimezone: true }),
    lastReviewCycleAt: timestamp('last_review_cycle_at', { withTimezone: true }),
    salesManagerZohoUserId: text('sales_manager_zoho_user_id'),

    // ---- DWH frequency-breach metrics (refreshed every sync) ----
    thresholdDays: integer('threshold_days'),
    lastTransactionAt: timestamp('last_transaction_at', { withTimezone: true }),
    daysInactive: integer('days_inactive'),
    txCount90d: integer('tx_count_90d'),
    gallons90d: doublePrecision('gallons_90d'),
    activeCards: integer('active_cards'),

    source: text('source').$type<'auto' | 'manual'>().notNull().default('auto'),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    openCarrierUnique: uniqueIndex('retention_cases_tenant_carrier_open_uk')
      .on(table.tenantId, table.carrierId)
      .where(sql`${table.closedAt} IS NULL`),
    phaseStatusIdx: index('retention_cases_tenant_phase_status_idx').on(
      table.tenantId,
      table.phaseCode,
      table.statusCode,
    ),
    deadlineIdx: index('retention_cases_deadline_idx').on(table.currentDeadlineAt),
    carrierIdx: index('retention_cases_tenant_carrier_idx').on(table.tenantId, table.carrierId),
    agentIdx: index('retention_cases_tenant_agent_idx').on(
      table.tenantId,
      table.assignedAgentZohoUserId,
    ),
  }),
);

// ---- Audit trail ---------------------------------------------------------------------------

export const retentionCaseEvents = pgTable(
  'retention_case_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    caseId: bigint('case_id', { mode: 'number' })
      .notNull()
      .references(() => retentionCases.id),
    fromStatus: text('from_status').references(() => retentionStatuses.code),
    toStatus: text('to_status')
      .notNull()
      .references(() => retentionStatuses.code),
    /** 'outcome_recorded' | 'comms_attempt' | 'timer_expired' | 'reassigned' | 'signoff' | 'status_change' | 'created' */
    eventType: text('event_type').notNull(),
    actorZohoUserId: text('actor_zoho_user_id'),
    channel: communicationChannelEnum('channel'),
    notes: text('notes'),
    /**
     * Screenshot / proof for non-RC channel attempts (data URL or https).
     * Required for TG / WA / SMS / IG / FB / email logs.
     */
    evidenceUrl: text('evidence_url'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    caseTimeIdx: index('retention_case_events_case_occurred_idx').on(table.caseId, table.occurredAt),
  }),
);

export type RetentionCase = typeof retentionCases.$inferSelect;
export type NewRetentionCase = typeof retentionCases.$inferInsert;
export type RetentionCaseEvent = typeof retentionCaseEvents.$inferSelect;
export type NewRetentionCaseEvent = typeof retentionCaseEvents.$inferInsert;

/** Seed / sync constants — statuses grow via INSERT into retention_statuses, not ALTER TYPE. */
export const RETENTION_PHASE = {
  agent: 'phase_1_agent',
  retention: 'phase_2_retention',
  citi: 'phase_3_citi',
} as const;

export const RETENTION_STATUS = {
  p1New: 'p1_new',
  /** Default for newly created breach cases — New (call within 2 BD). */
  p1InProgress: 'p1_in_progress',
  p1Reached: 'p1_reached',
  p1OutOfReach: 'p1_out_of_reach',
  p1Vacation: 'p1_vacation',
  p1Dissatisfied: 'p1_dissatisfied',
  p1Returned: 'p1_returned',
  p3Closed: 'p3_closed',
} as const;

/** Sales Agent Kanban board columns (matches retention_statuses.board_column). */
export const RETENTION_BOARD_COLUMN = {
  new: 'new',
  reached: 'reached',
  outOfReach: 'out_of_reach',
  vacation: 'vacation',
  dissatisfied: 'dissatisfied',
  closed: 'closed',
} as const;

/** Terminal status codes (must match the seed in migration 0027). */
export const RETENTION_TERMINAL_STATUSES = new Set([
  'p1_returned',
  'p2_saved',
  'p2_refused',
  'p2_lost',
  'p2_out_of_business',
  'p2_no_response',
  'p3_closed',
]);
