import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import { normalizeKpiProfile, kpiWorkerRepo } from './kpiWorkerRepo.js';
import type { TenantContext } from '../types/tenantContext.js';
import type {
  ActivityUsageDayFact,
  PresenceStatusFact,
  PresenceUsageDayFact,
  UsageRollupMetricFact,
  UsageRosterAgent,
  UsageSourceSpan,
  UsageTelemetryDayProof,
} from '../modules/analytics/mytrionUsageData.js';
import type { MytrionUsageWindow } from '../modules/analytics/mytrionUsageDates.js';
import {
  MYTRION_USAGE_CALCULATION_VERSION,
  MYTRION_USAGE_METRIC_KEYS,
} from '../modules/kpi/usageMetrics.js';

function count(value: unknown): number {
  return Number(value ?? 0) || 0;
}

function iso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value ? new Date(value).toISOString() : null;
}

export const mytrionUsageTelemetryRepo = {
  /** Current active exact-profile roster. Usage is left-joined to these rows by the service. */
  async listEligibleSalesAgents(ctx: TenantContext): Promise<UsageRosterAgent[]> {
    const workers = await kpiWorkerRepo.list(ctx, true);
    return workers
      .filter((worker) => normalizeKpiProfile(worker.currentProfileName ?? '') === 'sales agent')
      .map((worker) => ({
        workerId: worker.id,
        zohoUserId: worker.zohoUserId.replace(/^zoho:/i, ''),
        displayName: worker.displayName?.trim() || 'Unnamed Sales Agent',
      }));
  },

  /** Successful daily Zoho directory runs are the freshness proof for the current roster. */
  async directorySpan(ctx: TenantContext): Promise<UsageSourceSpan | undefined> {
    const rows = await db.execute(sql`
      select min(completed_at) as available_from, max(completed_at) as available_through
      from kpi_ingestion_runs
      where tenant_id = ${ctx.tenantId}
        and source = 'zoho_users'
        and mode = 'directory'
        and status = 'completed'
        and completed_at is not null
    `);
    const availableFrom = iso(rows[0]?.available_from);
    const availableThrough = iso(rows[0]?.available_through);
    return availableFrom && availableThrough
      ? { source: 'directory', availableFrom, availableThrough, coveredThrough: availableThrough }
      : undefined;
  },

  /** Version-2 daily values are authoritative for completed days and survive raw retention. */
  async listRollupMetrics(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<UsageRollupMetricFact[]> {
    const rows = await db.execute(sql`
      select
        rollup.worker_id,
        rollup.reporting_date::text as reporting_date,
        value.metric_key,
        value.numeric_value::double precision as numeric_value,
        value.data_status
      from kpi_daily_rollups rollup
      join kpi_daily_metric_values value
        on value.tenant_id = rollup.tenant_id
       and value.rollup_id = rollup.id
      where rollup.tenant_id = ${ctx.tenantId}
        and rollup.calculation_version = ${MYTRION_USAGE_CALCULATION_VERSION}
        and rollup.reporting_date >= ${window.from}::date
        and rollup.reporting_date <= ${window.to}::date
        and value.metric_key in (${sql.join(MYTRION_USAGE_METRIC_KEYS.map((key) => sql`${key}`), sql`, `)})
    `);
    return rows.map((row) => ({
      workerId: String(row.worker_id),
      date: String(row.reporting_date),
      metricKey: String(row.metric_key),
      value: row.numeric_value == null ? null : count(row.numeric_value),
      status:
        row.data_status === 'complete' || row.data_status === 'partial'
          ? row.data_status
          : 'unavailable',
    }));
  },

  /** Explicit tenant/day proof; missing days are intentionally not inferred from adjacent spans. */
  async listRollupCoverageDays(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<UsageTelemetryDayProof[]> {
    const rows = await db.execute(sql`
      select
        reporting_date::text as reporting_date,
        case when bool_and(source_watermarks->>'usage.presence' like 'complete@%')
          then 'complete' else 'unavailable' end as presence_status,
        case when bool_and(source_watermarks->>'usage.activity' like 'complete@%')
          then 'complete' else 'unavailable' end as activity_status
      from kpi_daily_rollups
      where tenant_id = ${ctx.tenantId}
        and calculation_version = ${MYTRION_USAGE_CALCULATION_VERSION}
        and reporting_date >= ${window.from}::date
        and reporting_date <= ${window.to}::date
      group by reporting_date
      order by reporting_date
    `);
    return rows.map((row) => ({
      date: String(row.reporting_date),
      presence: row.presence_status === 'complete' ? 'complete' : 'unavailable',
      activity: row.activity_status === 'complete' ? 'complete' : 'unavailable',
    }));
  },

  /** Raw fallback/current-day overlay. Intervals are unioned across tabs and devices. */
  async listRawPresence(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<PresenceUsageDayFact[]> {
    const rows = await db.execute(sql`
      with ordered as (
        select
          e.worker_id,
          e.state,
          e.received_at,
          lead(e.received_at) over (
            partition by e.worker_id, e.session_id order by e.received_at, e.id
          ) as next_at
        from kpi_presence_events e
        where e.tenant_id = ${ctx.tenantId}
          and e.received_at >= ${new Date(window.start.getTime() - 90_000).toISOString()}::timestamptz
          and e.received_at < ${new Date(window.endExclusive.getTime() + 90_000).toISOString()}::timestamptz
      ), base_intervals as (
        select
          worker_id,
          state,
          greatest(received_at, ${window.start.toISOString()}::timestamptz) as start_at,
          least(next_at, received_at + interval '60 seconds', ${window.endExclusive.toISOString()}::timestamptz) as end_at
        from ordered
        where state in ('active', 'idle')
          and next_at is not null
          and next_at - received_at <= interval '90 seconds'
          and received_at < ${window.endExclusive.toISOString()}::timestamptz
          and next_at > ${window.start.toISOString()}::timestamptz
      ), typed_intervals as (
        select worker_id, 'online'::text as metric, start_at, end_at from base_intervals
        union all
        select worker_id, 'active'::text as metric, start_at, end_at
        from base_intervals where state = 'active'
      ), day_intervals as (
        select
          i.worker_id,
          i.metric,
          day::date as reporting_date,
          greatest(i.start_at, day::timestamp at time zone 'America/New_York') as start_at,
          least(i.end_at, (day + interval '1 day')::timestamp at time zone 'America/New_York') as end_at
        from typed_intervals i
        join generate_series(${window.from}::date, ${window.to}::date, interval '1 day') day
          on i.end_at > day::timestamp at time zone 'America/New_York'
         and i.start_at < (day + interval '1 day')::timestamp at time zone 'America/New_York'
      ), edges as (
        select worker_id, metric, reporting_date, start_at as point, 1 as delta from day_intervals
        union all
        select worker_id, metric, reporting_date, end_at as point, -1 as delta from day_intervals
      ), collapsed as (
        select worker_id, metric, reporting_date, point, sum(delta)::int as delta
        from edges group by worker_id, metric, reporting_date, point
      ), spans as (
        select
          worker_id,
          metric,
          reporting_date,
          point,
          lead(point) over (partition by worker_id, metric, reporting_date order by point) as next_point,
          sum(delta) over (partition by worker_id, metric, reporting_date order by point) as depth
        from collapsed
      )
      , duration as (
      select
        worker_id,
        reporting_date::text as reporting_date,
        coalesce(sum(extract(epoch from (next_point - point))) filter (where metric = 'online' and depth > 0), 0)::int as online_seconds,
        coalesce(sum(extract(epoch from (next_point - point))) filter (where metric = 'active' and depth > 0), 0)::int as active_seconds
      from spans
      where next_point is not null
      group by worker_id, reporting_date
      ), day_last as (
        select
          worker_id,
          (received_at at time zone 'America/New_York')::date::text as reporting_date,
          max(received_at) as last_at
        from ordered
        where received_at >= ${window.start.toISOString()}::timestamptz
          and received_at < ${window.endExclusive.toISOString()}::timestamptz
        group by worker_id, reporting_date
      )
      select
        coalesce(duration.worker_id, day_last.worker_id) as worker_id,
        coalesce(duration.reporting_date, day_last.reporting_date) as reporting_date,
        coalesce(duration.online_seconds, 0)::int as online_seconds,
        coalesce(duration.active_seconds, 0)::int as active_seconds,
        day_last.last_at
      from duration
      full join day_last
        on day_last.worker_id = duration.worker_id
       and day_last.reporting_date = duration.reporting_date
    `);
    return rows.map((row) => ({
      workerId: String(row.worker_id),
      date: String(row.reporting_date),
      onlineSeconds: count(row.online_seconds),
      activeSeconds: count(row.active_seconds),
      lastAt: iso(row.last_at),
    }));
  },

  async listRawActivity(
    ctx: TenantContext,
    window: MytrionUsageWindow,
  ): Promise<ActivityUsageDayFact[]> {
    const rows = await db.execute(sql`
      select
        worker_id,
        (received_at at time zone 'America/New_York')::date::text as reporting_date,
        event_name,
        count(*)::int as event_count,
        max(received_at) as last_at
      from kpi_activity_events
      where tenant_id = ${ctx.tenantId}
        and received_at >= ${window.start.toISOString()}::timestamptz
        and received_at < ${window.endExclusive.toISOString()}::timestamptz
      group by worker_id, reporting_date, event_name
    `);
    return rows.map((row) => ({
      workerId: String(row.worker_id),
      date: String(row.reporting_date),
      eventName: String(row.event_name),
      count: count(row.event_count),
      lastAt: iso(row.last_at),
    }));
  },

  async listCurrentStatus(ctx: TenantContext): Promise<PresenceStatusFact[]> {
    const rows = await db.execute(sql`
      with latest_session as (
        select distinct on (session_id)
          session_id, worker_id, state
        from kpi_presence_events
        where tenant_id = ${ctx.tenantId}
          and received_at >= now() - interval '90 seconds'
        order by session_id, received_at desc, id desc
      )
      select
        worker_id,
        case
          when bool_or(state = 'active') then 'active'
          when bool_or(state = 'idle') then 'idle'
          else 'offline'
        end as status
      from latest_session
      group by worker_id
    `);
    return rows.map((row) => ({
      workerId: String(row.worker_id),
      status: row.status === 'active' || row.status === 'idle' ? row.status : 'offline',
    }));
  },
};
