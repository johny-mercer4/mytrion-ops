import { createId } from '@paralleldrive/cuid2';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export type KpiAggregation = 'sum' | 'last' | 'ratio';
export type KpiDataStatus = 'complete' | 'partial' | 'unavailable';
export type KpiIngestionStatus = 'running' | 'completed' | 'partial' | 'failed';
export type KpiPresenceState = 'active' | 'idle' | 'hidden' | 'ended';

/** Data-driven eligibility rules. Exact profile matching is deliberate and auditable. */
export const kpiPopulationProfiles = pgTable(
  'kpi_population_profiles',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kpp_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    profileName: text('profile_name').notNull(),
    normalizedProfileName: text('normalized_profile_name').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantProfileUk: uniqueIndex('kpi_population_profiles_tenant_profile_uk').on(
      table.tenantId,
      table.normalizedProfileName,
    ),
  }),
);

/** Stable KPI identity. Zoho user id is authoritative; names are display snapshots only. */
export const kpiWorkers = pgTable(
  'kpi_workers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kpw_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    zohoUserId: text('zoho_user_id').notNull(),
    displayName: text('display_name'),
    email: text('email'),
    currentProfileName: text('current_profile_name'),
    currentRoleName: text('current_role_name'),
    sourceActive: boolean('source_active').notNull().default(true),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantZohoUk: uniqueIndex('kpi_workers_tenant_zoho_uk').on(
      table.tenantId,
      table.zohoUserId,
    ),
    tenantActiveIdx: index('kpi_workers_tenant_active_idx').on(
      table.tenantId,
      table.sourceActive,
    ),
  }),
);

/** Effective-dated population history; at most one open membership per worker. */
export const kpiWorkerMemberships = pgTable(
  'kpi_worker_memberships',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kwm_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    profileName: text('profile_name').notNull(),
    eligibleFrom: timestamp('eligible_from', { withTimezone: true }).notNull().defaultNow(),
    eligibleTo: timestamp('eligible_to', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    openMembershipUk: uniqueIndex('kpi_worker_memberships_open_uk')
      .on(table.tenantId, table.workerId)
      .where(sql`${table.eligibleTo} is null`),
    workerTimeIdx: index('kpi_worker_memberships_worker_time_idx').on(
      table.tenantId,
      table.workerId,
      table.eligibleFrom,
    ),
  }),
);

/** Versioned metric data dictionary; rows referenced by a snapshot are never edited. */
export const kpiMetricDefinitions = pgTable(
  'kpi_metric_definitions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kmd_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    metricKey: text('metric_key').notNull(),
    version: integer('version').notNull().default(1),
    label: text('label').notNull(),
    unit: text('unit').notNull(),
    aggregation: text('aggregation').$type<KpiAggregation>().notNull(),
    numeratorMetricKey: text('numerator_metric_key'),
    denominatorMetricKey: text('denominator_metric_key'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantMetricVersionUk: uniqueIndex('kpi_metric_definitions_tenant_key_version_uk').on(
      table.tenantId,
      table.metricKey,
      table.version,
    ),
  }),
);

/** One observable execution of a source collector/backfill. */
export const kpiIngestionRuns = pgTable(
  'kpi_ingestion_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kir_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    source: text('source').notNull(),
    mode: text('mode').notNull(),
    status: text('status').$type<KpiIngestionStatus>().notNull().default('running'),
    windowStart: timestamp('window_start', { withTimezone: true }),
    windowEnd: timestamp('window_end', { withTimezone: true }),
    cursor: text('cursor'),
    recordsSeen: integer('records_seen').notNull().default(0),
    recordsWritten: integer('records_written').notNull().default(0),
    unresolvedMappings: integer('unresolved_mappings').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantSourceIdx: index('kpi_ingestion_runs_tenant_source_idx').on(
      table.tenantId,
      table.source,
      table.startedAt,
    ),
  }),
);

/** Actionable source identities that could not be mapped without guessing. */
export const kpiUnresolvedWorkerMappings = pgTable(
  'kpi_unresolved_worker_mappings',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kum_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    observedLabel: text('observed_label'),
    reason: text('reason').notNull(),
    ingestionRunId: text('ingestion_run_id')
      .notNull()
      .references(() => kpiIngestionRuns.id),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedWorkerId: text('resolved_worker_id').references(() => kpiWorkers.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (table) => ({
    activeMappingUk: uniqueIndex('kpi_unresolved_worker_mappings_active_uk')
      .on(table.tenantId, table.source, table.sourceKey)
      .where(sql`${table.resolvedAt} is null`),
    tenantStatusIdx: index('kpi_unresolved_worker_mappings_tenant_status_idx').on(
      table.tenantId,
      table.resolvedAt,
      table.lastSeenAt,
    ),
  }),
);

/**
 * Append-only external observations. A changed source value creates the next revision;
 * aggregators select max(revision) per source key.
 */
export const kpiExternalFacts = pgTable(
  'kpi_external_facts',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    ingestionRunId: text('ingestion_run_id').notNull().references(() => kpiIngestionRuns.id),
    source: text('source').notNull(),
    sourceKey: text('source_key').notNull(),
    metricKey: text('metric_key').notNull(),
    metricVersion: integer('metric_version').notNull().default(1),
    revision: integer('revision').notNull().default(1),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    reportingDate: date('reporting_date').notNull(),
    numericValue: doublePrecision('numeric_value').notNull(),
    dataStatus: text('data_status').$type<KpiDataStatus>().notNull().default('complete'),
    dimensions: jsonb('dimensions').$type<Record<string, string | number | boolean | null>>(),
    supersedesId: bigint('supersedes_id', { mode: 'number' }),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    sourceRevisionUk: uniqueIndex('kpi_external_facts_source_revision_uk').on(
      table.tenantId,
      table.source,
      table.sourceKey,
      table.metricKey,
      table.revision,
    ),
    workerDateIdx: index('kpi_external_facts_worker_date_idx').on(
      table.tenantId,
      table.workerId,
      table.reportingDate,
    ),
  }),
);

export const kpiPresenceSessions = pgTable(
  'kpi_presence_sessions',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workerOpenIdx: index('kpi_presence_sessions_worker_open_idx').on(
      table.tenantId,
      table.workerId,
      table.endedAt,
    ),
  }),
);

export const kpiPresenceEvents = pgTable(
  'kpi_presence_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    sessionId: text('session_id').notNull().references(() => kpiPresenceSessions.id),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    clientEventId: text('client_event_id').notNull(),
    state: text('state').$type<KpiPresenceState>().notNull(),
    clientOccurredAt: timestamp('client_occurred_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientEventUk: uniqueIndex('kpi_presence_events_client_event_uk').on(
      table.tenantId,
      table.clientEventId,
    ),
    sessionTimeIdx: index('kpi_presence_events_session_time_idx').on(
      table.tenantId,
      table.sessionId,
      table.receivedAt,
    ),
    tenantTimeIdx: index('kpi_presence_events_tenant_time_idx').on(
      table.tenantId,
      table.receivedAt,
      table.workerId,
      table.sessionId,
      table.id,
    ),
  }),
);

export const kpiActivityEvents = pgTable(
  'kpi_activity_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    sessionId: text('session_id'),
    clientEventId: text('client_event_id').notNull(),
    eventName: text('event_name').notNull(),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    outcome: text('outcome'),
    metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>(),
    clientOccurredAt: timestamp('client_occurred_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    clientEventUk: uniqueIndex('kpi_activity_events_client_event_uk').on(
      table.tenantId,
      table.clientEventId,
    ),
    workerTimeIdx: index('kpi_activity_events_worker_time_idx').on(
      table.tenantId,
      table.workerId,
      table.receivedAt,
    ),
  }),
);

export const kpiDailyRollups = pgTable(
  'kpi_daily_rollups',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kdr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    reportingDate: date('reporting_date').notNull(),
    timezone: text('timezone').notNull().default('America/New_York'),
    calculationVersion: integer('calculation_version').notNull().default(1),
    sourceWatermarks: jsonb('source_watermarks').$type<Record<string, string>>().notNull().default({}),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workerDateVersionUk: uniqueIndex('kpi_daily_rollups_worker_date_version_uk').on(
      table.tenantId,
      table.workerId,
      table.reportingDate,
      table.calculationVersion,
    ),
  }),
);

export const kpiDailyMetricValues = pgTable(
  'kpi_daily_metric_values',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    rollupId: text('rollup_id').notNull().references(() => kpiDailyRollups.id),
    metricKey: text('metric_key').notNull(),
    metricVersion: integer('metric_version').notNull().default(1),
    numericValue: doublePrecision('numeric_value'),
    numerator: doublePrecision('numerator'),
    denominator: doublePrecision('denominator'),
    dataStatus: text('data_status').$type<KpiDataStatus>().notNull(),
  },
  (table) => ({
    rollupMetricUk: uniqueIndex('kpi_daily_metric_values_rollup_metric_uk').on(
      table.tenantId,
      table.rollupId,
      table.metricKey,
      table.metricVersion,
    ),
  }),
);

export const kpiMonthlySnapshots = pgTable(
  'kpi_monthly_snapshots',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `kms_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    workerId: text('worker_id').notNull().references(() => kpiWorkers.id),
    periodStart: date('period_start').notNull(),
    revision: integer('revision').notNull(),
    timezone: text('timezone').notNull().default('America/New_York'),
    workerProfileName: text('worker_profile_name'),
    workerRoleName: text('worker_role_name'),
    sourceWatermarks: jsonb('source_watermarks').$type<Record<string, string>>().notNull().default({}),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    workerPeriodRevisionUk: uniqueIndex('kpi_monthly_snapshots_worker_period_revision_uk').on(
      table.tenantId,
      table.workerId,
      table.periodStart,
      table.revision,
    ),
  }),
);

export const kpiMonthlyMetricValues = pgTable(
  'kpi_monthly_metric_values',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: text('tenant_id').notNull(),
    snapshotId: text('snapshot_id').notNull().references(() => kpiMonthlySnapshots.id),
    metricKey: text('metric_key').notNull(),
    metricVersion: integer('metric_version').notNull().default(1),
    numericValue: doublePrecision('numeric_value'),
    numerator: doublePrecision('numerator'),
    denominator: doublePrecision('denominator'),
    dataStatus: text('data_status').$type<KpiDataStatus>().notNull(),
  },
  (table) => ({
    snapshotMetricUk: uniqueIndex('kpi_monthly_metric_values_snapshot_metric_uk').on(
      table.tenantId,
      table.snapshotId,
      table.metricKey,
      table.metricVersion,
    ),
  }),
);

export type KpiWorker = typeof kpiWorkers.$inferSelect;
export type KpiMetricDefinition = typeof kpiMetricDefinitions.$inferSelect;
export type KpiIngestionRun = typeof kpiIngestionRuns.$inferSelect;
export type KpiUnresolvedWorkerMapping =
  typeof kpiUnresolvedWorkerMappings.$inferSelect;
export type KpiExternalFact = typeof kpiExternalFacts.$inferSelect;
export type KpiDailyRollup = typeof kpiDailyRollups.$inferSelect;
export type KpiDailyMetricValue = typeof kpiDailyMetricValues.$inferSelect;
export type KpiMonthlySnapshot = typeof kpiMonthlySnapshots.$inferSelect;
