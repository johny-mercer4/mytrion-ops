import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiExternalFacts,
  kpiWorkers,
  type KpiDataStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export interface KpiAdminTableDefinition {
  name: string;
  group: 'identity' | 'collection' | 'tasks' | 'telemetry' | 'reporting';
  purpose: string;
  createdForKpi: boolean;
}

export const KPI_ADMIN_TABLES: KpiAdminTableDefinition[] = [
  { name: 'kpi_population_profiles', group: 'identity', purpose: 'Configurable Zoho profiles eligible for KPI collection.', createdForKpi: true },
  { name: 'kpi_workers', group: 'identity', purpose: 'Stable Zoho-user identities and current directory attributes.', createdForKpi: true },
  { name: 'kpi_worker_memberships', group: 'identity', purpose: 'Effective-dated KPI eligibility and profile history.', createdForKpi: true },
  { name: 'kpi_metric_definitions', group: 'reporting', purpose: 'Versioned metric catalog and aggregation rules.', createdForKpi: true },
  { name: 'kpi_ingestion_runs', group: 'collection', purpose: 'Audit trail for sync, reconciliation and backfill executions.', createdForKpi: true },
  { name: 'kpi_unresolved_worker_mappings', group: 'collection', purpose: 'Actionable source identities that cannot be mapped safely.', createdForKpi: true },
  { name: 'kpi_external_facts', group: 'collection', purpose: 'Append-only, revisioned Zoho and DWH observations.', createdForKpi: true },
  { name: 'mytrion_task_types', group: 'tasks', purpose: 'Tenant-configurable worker task type codes.', createdForKpi: true },
  { name: 'mytrion_worker_tasks', group: 'tasks', purpose: 'Current task assignment and lifecycle state.', createdForKpi: true },
  { name: 'mytrion_worker_task_events', group: 'tasks', purpose: 'Append-only task history used for historical metrics.', createdForKpi: true },
  { name: 'kpi_presence_sessions', group: 'telemetry', purpose: 'Browser/device presence session parents.', createdForKpi: true },
  { name: 'kpi_presence_events', group: 'telemetry', purpose: 'Active, idle, hidden and ended presence heartbeats.', createdForKpi: true },
  { name: 'kpi_activity_events', group: 'telemetry', purpose: 'Privacy-allowlisted semantic Mytrion UI events.', createdForKpi: true },
  { name: 'kpi_daily_rollups', group: 'reporting', purpose: 'Worker/reporting-day calculation versions and watermarks.', createdForKpi: true },
  { name: 'kpi_daily_metric_values', group: 'reporting', purpose: 'Daily numeric values, ratios and data-status flags.', createdForKpi: true },
  { name: 'kpi_monthly_snapshots', group: 'reporting', purpose: 'Immutable worker/month snapshot revision parents.', createdForKpi: true },
  { name: 'kpi_monthly_metric_values', group: 'reporting', purpose: 'Final monthly values and ratio numerators/denominators.', createdForKpi: true },
  { name: 'mytrion_calls', group: 'collection', purpose: 'Existing local call table, strengthened with RingCentral session idempotency and actor attribution.', createdForKpi: false },
];

export interface KpiAdminMetricTotal {
  metricKey: string;
  label: string;
  unit: string;
  aggregation: string;
  version: number;
  numericValue: number | null;
  numerator: number | null;
  denominator: number | null;
  dataStatus: KpiDataStatus;
}

export interface KpiAdminFactQuery {
  source?: string;
  metricKey?: string;
  workerId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

function numericOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const kpiAdminRepo = {
  async ingestionRuns(ctx: TenantContext, limit = 200) {
    return db.execute(sql`
      select
        r.id,
        r.source,
        r.mode,
        r.status,
        r.window_start as "windowStart",
        r.window_end as "windowEnd",
        r.cursor,
        r.records_seen as "recordsSeen",
        r.records_written as "recordsWritten",
        coalesce(f.linked_facts, 0)::int as "linkedFacts",
        r.unresolved_mappings as "unresolvedMappings",
        r.error,
        r.started_at as "startedAt",
        r.completed_at as "completedAt"
      from kpi_ingestion_runs r
      left join (
        select ingestion_run_id, count(*)::int as linked_facts
        from kpi_external_facts
        where tenant_id = ${ctx.tenantId}
        group by ingestion_run_id
      ) f on f.ingestion_run_id = r.id
      where r.tenant_id = ${ctx.tenantId}
      order by r.started_at desc
      limit ${Math.min(Math.max(limit, 1), 500)}
    `);
  },

  async tableCounts(ctx: TenantContext): Promise<Record<string, number>> {
    const rows = await db.execute(sql`
      select
        (select count(*) from kpi_population_profiles where tenant_id = ${ctx.tenantId})::int as kpi_population_profiles,
        (select count(*) from kpi_workers where tenant_id = ${ctx.tenantId})::int as kpi_workers,
        (select count(*) from kpi_worker_memberships where tenant_id = ${ctx.tenantId})::int as kpi_worker_memberships,
        (select count(*) from kpi_metric_definitions where tenant_id = ${ctx.tenantId})::int as kpi_metric_definitions,
        (select count(*) from kpi_ingestion_runs where tenant_id = ${ctx.tenantId})::int as kpi_ingestion_runs,
        (select count(*) from kpi_unresolved_worker_mappings where tenant_id = ${ctx.tenantId})::int as kpi_unresolved_worker_mappings,
        (select count(*) from kpi_external_facts where tenant_id = ${ctx.tenantId})::int as kpi_external_facts,
        (select count(*) from mytrion_task_types where tenant_id = ${ctx.tenantId})::int as mytrion_task_types,
        (select count(*) from mytrion_worker_tasks where tenant_id = ${ctx.tenantId})::int as mytrion_worker_tasks,
        (select count(*) from mytrion_worker_task_events where tenant_id = ${ctx.tenantId})::int as mytrion_worker_task_events,
        (select count(*) from kpi_presence_sessions where tenant_id = ${ctx.tenantId})::int as kpi_presence_sessions,
        (select count(*) from kpi_presence_events where tenant_id = ${ctx.tenantId})::int as kpi_presence_events,
        (select count(*) from kpi_activity_events where tenant_id = ${ctx.tenantId})::int as kpi_activity_events,
        (select count(*) from kpi_daily_rollups where tenant_id = ${ctx.tenantId})::int as kpi_daily_rollups,
        (select count(*) from kpi_daily_metric_values where tenant_id = ${ctx.tenantId})::int as kpi_daily_metric_values,
        (select count(*) from kpi_monthly_snapshots where tenant_id = ${ctx.tenantId})::int as kpi_monthly_snapshots,
        (select count(*) from kpi_monthly_metric_values where tenant_id = ${ctx.tenantId})::int as kpi_monthly_metric_values,
        (select count(*) from mytrion_calls where tenant_id = ${ctx.tenantId})::int as mytrion_calls
    `);
    const row = rows[0] ?? {};
    return Object.fromEntries(
      KPI_ADMIN_TABLES.map((table) => [table.name, Number(row[table.name] ?? 0)]),
    );
  },

  async dateBounds(ctx: TenantContext): Promise<{ from: string | null; to: string | null }> {
    const rows = await db.execute(sql`
      select
        min(reporting_date)::text as "from",
        max(reporting_date)::text as "to"
      from kpi_daily_rollups
      where tenant_id = ${ctx.tenantId}
        and calculation_version = 1
    `);
    return {
      from: rows[0]?.from ? String(rows[0].from) : null,
      to: rows[0]?.to ? String(rows[0].to) : null,
    };
  },

  async aggregateMetrics(
    ctx: TenantContext,
    from: string,
    to: string,
  ): Promise<KpiAdminMetricTotal[]> {
    const rows = await db.execute(sql`
      with definitions as (
        select distinct on (metric_key)
          metric_key, label, unit, aggregation, version
        from kpi_metric_definitions
        where tenant_id = ${ctx.tenantId} and active = true
        order by metric_key, version desc
      ),
      filtered as (
        select
          r.worker_id, r.reporting_date, v.metric_key, v.numeric_value,
          v.numerator, v.denominator, v.data_status
        from kpi_daily_rollups r
        join kpi_daily_metric_values v
          on v.tenant_id = r.tenant_id and v.rollup_id = r.id
        where r.tenant_id = ${ctx.tenantId}
          and r.calculation_version = 1
          and r.reporting_date >= ${from}::date
          and r.reporting_date <= ${to}::date
      ),
      latest_worker_values as (
        select distinct on (worker_id, metric_key)
          worker_id, metric_key, numeric_value
        from filtered
        order by worker_id, metric_key, reporting_date desc
      ),
      latest_totals as (
        select metric_key, sum(numeric_value)::double precision as value
        from latest_worker_values
        group by metric_key
      )
      select
        d.metric_key,
        d.label,
        d.unit,
        d.aggregation,
        d.version,
        case
          when count(f.metric_key) = 0 then null
          when d.aggregation = 'last' then max(l.value)
          when d.aggregation = 'ratio' then
            case when sum(f.denominator) > 0
              then sum(f.numerator) / sum(f.denominator)
              else null
            end
          else sum(f.numeric_value)
        end::double precision as numeric_value,
        case when d.aggregation = 'ratio'
          then sum(f.numerator)::double precision else null end as numerator,
        case when d.aggregation = 'ratio'
          then sum(f.denominator)::double precision else null end as denominator,
        case
          when count(f.metric_key) = 0 then 'unavailable'
          when bool_and(f.data_status = 'complete') then 'complete'
          when bool_or(f.data_status <> 'unavailable') then 'partial'
          else 'unavailable'
        end as data_status
      from definitions d
      left join filtered f on f.metric_key = d.metric_key
      left join latest_totals l on l.metric_key = d.metric_key
      group by d.metric_key, d.label, d.unit, d.aggregation, d.version
      order by d.metric_key
    `);
    return rows.map((row) => ({
      metricKey: String(row.metric_key),
      label: String(row.label),
      unit: String(row.unit),
      aggregation: String(row.aggregation),
      version: Number(row.version),
      numericValue: numericOrNull(row.numeric_value),
      numerator: numericOrNull(row.numerator),
      denominator: numericOrNull(row.denominator),
      dataStatus: String(row.data_status) as KpiDataStatus,
    }));
  },

  async workers(ctx: TenantContext) {
    const rows = await db.execute(sql`
      select
        w.id,
        w.zoho_user_id as "zohoUserId",
        w.display_name as "displayName",
        w.email,
        w.current_profile_name as "currentProfileName",
        w.current_role_name as "currentRoleName",
        w.source_active as "sourceActive",
        w.first_seen_at as "firstSeenAt",
        w.last_seen_at as "lastSeenAt",
        exists (
          select 1 from kpi_worker_memberships m
          where m.tenant_id = w.tenant_id
            and m.worker_id = w.id
            and m.eligible_to is null
        ) as eligible
      from kpi_workers w
      where w.tenant_id = ${ctx.tenantId}
      order by w.display_name nulls last, w.zoho_user_id
    `);
    return rows;
  },

  async facts(ctx: TenantContext, query: KpiAdminFactQuery) {
    const conditions = [eq(kpiExternalFacts.tenantId, ctx.tenantId)];
    if (query.source) conditions.push(eq(kpiExternalFacts.source, query.source));
    if (query.metricKey) conditions.push(eq(kpiExternalFacts.metricKey, query.metricKey));
    if (query.workerId) conditions.push(eq(kpiExternalFacts.workerId, query.workerId));
    if (query.from) conditions.push(gte(kpiExternalFacts.reportingDate, query.from));
    if (query.to) conditions.push(lte(kpiExternalFacts.reportingDate, query.to));
    return db
      .select({
        id: kpiExternalFacts.id,
        workerId: kpiExternalFacts.workerId,
        workerName: kpiWorkers.displayName,
        source: kpiExternalFacts.source,
        sourceKey: kpiExternalFacts.sourceKey,
        metricKey: kpiExternalFacts.metricKey,
        metricVersion: kpiExternalFacts.metricVersion,
        revision: kpiExternalFacts.revision,
        occurredAt: kpiExternalFacts.occurredAt,
        reportingDate: kpiExternalFacts.reportingDate,
        numericValue: kpiExternalFacts.numericValue,
        dataStatus: kpiExternalFacts.dataStatus,
        dimensions: kpiExternalFacts.dimensions,
        supersedesId: kpiExternalFacts.supersedesId,
        observedAt: kpiExternalFacts.observedAt,
      })
      .from(kpiExternalFacts)
      .innerJoin(
        kpiWorkers,
        and(
          eq(kpiWorkers.tenantId, kpiExternalFacts.tenantId),
          eq(kpiWorkers.id, kpiExternalFacts.workerId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(kpiExternalFacts.observedAt), desc(kpiExternalFacts.id))
      .limit(Math.min(Math.max(query.limit ?? 100, 1), 500))
      .offset(Math.max(query.offset ?? 0, 0));
  },
};
