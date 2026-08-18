import { and, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiDailyMetricValues,
  kpiDailyRollups,
  kpiIngestionRuns,
  kpiMonthlyMetricValues,
  kpiMonthlySnapshots,
  kpiMetricDefinitions,
  type KpiDataStatus,
  type KpiIngestionRun,
  type KpiIngestionStatus,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

const EXTERNAL_KPI_CALCULATION_VERSION = 1;

export interface KpiMetricValueInput {
  metricKey: string;
  metricVersion?: number;
  numericValue: number | null;
  numerator?: number | null;
  denominator?: number | null;
  dataStatus: KpiDataStatus;
}

export interface ExternalMetricTotal {
  metricKey: string;
  value: number;
  dataStatus: KpiDataStatus;
}

const ACTIVITY_METRIC_KEYS: Record<string, string> = {
  'navigation.tab_open': 'tab_open_clicks',
  'navigation.view_open': 'view_open_clicks',
  'ui.record_open': 'record_open_clicks',
  'ui.search_completed': 'searches_completed',
  'report.export_completed': 'exports_completed',
  'crm.lead_open': 'lead_open_clicks',
  'crm.deal_open': 'deal_open_clicks',
  'crm.call_click': 'call_clicks',
  'crm.edit_open': 'edit_open_clicks',
  'crm.edit_save_success': 'edit_save_successes',
  'crm.edit_save_failed': 'edit_save_failures',
};

export const kpiRepo = {
  async startIngestion(
    ctx: TenantContext,
    input: {
      source: string;
      mode: string;
      windowStart?: Date | null;
      windowEnd?: Date | null;
      cursor?: string | null;
    },
  ): Promise<KpiIngestionRun> {
    const rows = await db
      .insert(kpiIngestionRuns)
      .values({
        tenantId: ctx.tenantId,
        source: input.source,
        mode: input.mode,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null,
        cursor: input.cursor ?? null,
      })
      .returning();
    return firstOrThrow(rows, 'Failed to start KPI ingestion run');
  },

  async finishIngestion(
    ctx: TenantContext,
    runId: string,
    input: {
      status: Exclude<KpiIngestionStatus, 'running'>;
      recordsSeen: number;
      recordsWritten: number;
      unresolvedMappings?: number;
      cursor?: string | null;
      error?: string | null;
    },
  ): Promise<void> {
    await db
      .update(kpiIngestionRuns)
      .set({
        status: input.status,
        recordsSeen: input.recordsSeen,
        recordsWritten: input.recordsWritten,
        unresolvedMappings: input.unresolvedMappings ?? 0,
        cursor: input.cursor ?? null,
        error: input.error ?? null,
        completedAt: new Date(),
      })
      .where(
        and(eq(kpiIngestionRuns.tenantId, ctx.tenantId), eq(kpiIngestionRuns.id, runId)),
      );
  },

  async listIngestionRuns(
    ctx: TenantContext,
    limit = 50,
  ): Promise<KpiIngestionRun[]> {
    return db
      .select()
      .from(kpiIngestionRuns)
      .where(eq(kpiIngestionRuns.tenantId, ctx.tenantId))
      .orderBy(desc(kpiIngestionRuns.startedAt))
      .limit(Math.min(Math.max(limit, 1), 200));
  },

  async ingestionWatermarks(ctx: TenantContext): Promise<Record<string, string>> {
    const rows = await db.execute(sql`
      select distinct on ("source")
        "source", "id", "completed_at"
      from "kpi_ingestion_runs"
      where "tenant_id" = ${ctx.tenantId}
        and "status" in ('completed', 'partial')
        and "completed_at" is not null
      order by "source", "completed_at" desc, "id" desc
    `);
    return Object.fromEntries(
      rows.map((row) => [
        String(row.source),
        `${String(row.id)}@${new Date(String(row.completed_at)).toISOString()}`,
      ]),
    );
  },

  async latestIngestionCursor(ctx: TenantContext, source: string): Promise<string | null> {
    const rows = await db
      .select({ cursor: kpiIngestionRuns.cursor })
      .from(kpiIngestionRuns)
      .where(
        and(
          eq(kpiIngestionRuns.tenantId, ctx.tenantId),
          eq(kpiIngestionRuns.source, source),
          sql`${kpiIngestionRuns.status} in ('completed', 'partial')`,
        ),
      )
      .orderBy(desc(kpiIngestionRuns.completedAt))
      .limit(1);
    return rows[0]?.cursor ?? null;
  },

  async listDaily(
    ctx: TenantContext,
    workerId: string,
    from: string,
    to: string,
  ) {
    const rollups = await db
      .select()
      .from(kpiDailyRollups)
      .where(
        and(
          eq(kpiDailyRollups.tenantId, ctx.tenantId),
          eq(kpiDailyRollups.workerId, workerId),
          eq(kpiDailyRollups.calculationVersion, EXTERNAL_KPI_CALCULATION_VERSION),
          gte(kpiDailyRollups.reportingDate, from),
          lte(kpiDailyRollups.reportingDate, to),
        ),
      )
      .orderBy(desc(kpiDailyRollups.reportingDate));
    if (rollups.length === 0) return [];
    const result = [];
    for (const rollup of rollups) {
      const values = await db
        .select()
        .from(kpiDailyMetricValues)
        .where(
          and(
            eq(kpiDailyMetricValues.tenantId, ctx.tenantId),
            eq(kpiDailyMetricValues.rollupId, rollup.id),
          ),
        );
      result.push({ ...rollup, values });
    }
    return result;
  },

  async listMonthly(ctx: TenantContext, workerId: string) {
    const snapshots = await db
      .select()
      .from(kpiMonthlySnapshots)
      .where(
        and(
          eq(kpiMonthlySnapshots.tenantId, ctx.tenantId),
          eq(kpiMonthlySnapshots.workerId, workerId),
        ),
      )
      .orderBy(desc(kpiMonthlySnapshots.periodStart), desc(kpiMonthlySnapshots.revision));
    const result = [];
    for (const snapshot of snapshots) {
      const values = await db
        .select()
        .from(kpiMonthlyMetricValues)
        .where(
          and(
            eq(kpiMonthlyMetricValues.tenantId, ctx.tenantId),
            eq(kpiMonthlyMetricValues.snapshotId, snapshot.id),
          ),
        );
      result.push({ ...snapshot, values });
    }
    return result;
  },

  async mytrionCallMetrics(
    ctx: TenantContext,
    zohoUserId: string,
    reportingDate: string,
    timezone: string,
  ): Promise<Record<string, number>> {
    const rows = await db.execute(sql`
      select
        count(*)::int as calls_mytrion,
        count(*) filter (where "call_status" = 'picked_up')::int as calls_answered,
        coalesce(sum("duration_seconds"), 0)::int as call_talk_seconds
      from "mytrion_calls"
      where "tenant_id" = ${ctx.tenantId}
        and "caller_zoho_user_id" = ${zohoUserId}
        and timezone(${timezone}, "call_time")::date = ${reportingDate}::date
    `);
    const row = rows[0] ?? {};
    return {
      calls_mytrion: Number(row.calls_mytrion ?? 0),
      calls_answered: Number(row.calls_answered ?? 0),
      call_talk_seconds: Number(row.call_talk_seconds ?? 0),
    };
  },

  async mytrionCallMetricsForWorkers(
    ctx: TenantContext,
    zohoUserIds: string[],
    reportingDate: string,
    timezone: string,
  ): Promise<Map<string, Record<string, number>>> {
    if (zohoUserIds.length === 0) return new Map();
    const rows = await db.execute(sql`
      with workers as (
        select jsonb_array_elements_text(${JSON.stringify(zohoUserIds)}::jsonb) as zoho_user_id
      )
      select
        c."caller_zoho_user_id",
        count(*)::int as calls_mytrion,
        count(*) filter (where c."call_status" = 'picked_up')::int as calls_answered,
        coalesce(sum(c."duration_seconds"), 0)::int as call_talk_seconds
      from "mytrion_calls" c
      join workers w on w.zoho_user_id = c."caller_zoho_user_id"
      where c."tenant_id" = ${ctx.tenantId}
        and timezone(${timezone}, c."call_time")::date = ${reportingDate}::date
      group by c."caller_zoho_user_id"
    `);
    return new Map(rows.map((row) => [
      String(row.caller_zoho_user_id),
      {
        calls_mytrion: Number(row.calls_mytrion ?? 0),
        calls_answered: Number(row.calls_answered ?? 0),
        call_talk_seconds: Number(row.call_talk_seconds ?? 0),
      },
    ]));
  },

  async externalMetricTotals(
    ctx: TenantContext,
    workerId: string,
    reportingDate: string,
  ): Promise<ExternalMetricTotal[]> {
    const rows = await db.execute(sql`
      with latest as (
        select distinct on ("source","source_key","metric_key")
          "worker_id", "reporting_date", "metric_key", "numeric_value", "data_status"
        from "kpi_external_facts"
        where "tenant_id" = ${ctx.tenantId}
        order by "source","source_key","metric_key","revision" desc
      )
      select
        "metric_key",
        coalesce(sum("numeric_value"), 0)::double precision as value,
        case
          when bool_and("data_status" = 'complete') then 'complete'
          when bool_or("data_status" <> 'unavailable') then 'partial'
          else 'unavailable'
        end as data_status
      from latest
      where "worker_id" = ${workerId}
        and "reporting_date" = ${reportingDate}::date
      group by "metric_key"
    `);
    return rows.map((row) => ({
      metricKey: String(row.metric_key),
      value: Number(row.value ?? 0),
      dataStatus: String(row.data_status) as KpiDataStatus,
    }));
  },

  async externalMetricTotalsForWorkers(
    ctx: TenantContext,
    workerIds: string[],
    reportingDate: string,
  ): Promise<Map<string, ExternalMetricTotal[]>> {
    const result = new Map<string, ExternalMetricTotal[]>();
    if (workerIds.length === 0) return result;
    const rows = await db.execute(sql`
      with workers as (
        select jsonb_array_elements_text(${JSON.stringify(workerIds)}::jsonb) as worker_id
      ),
      latest as (
        select distinct on ("source","source_key","metric_key")
          "worker_id", "reporting_date", "metric_key", "numeric_value", "data_status"
        from "kpi_external_facts"
        where "tenant_id" = ${ctx.tenantId}
        order by "source","source_key","metric_key","revision" desc
      )
      select
        latest."worker_id",
        latest."metric_key",
        coalesce(sum(latest."numeric_value"), 0)::double precision as value,
        case
          when bool_and(latest."data_status" = 'complete') then 'complete'
          when bool_or(latest."data_status" <> 'unavailable') then 'partial'
          else 'unavailable'
        end as data_status
      from latest
      join workers on workers.worker_id = latest."worker_id"
      where latest."reporting_date" = ${reportingDate}::date
      group by latest."worker_id", latest."metric_key"
    `);
    for (const row of rows) {
      const workerId = String(row.worker_id);
      const values = result.get(workerId) ?? [];
      values.push({
        metricKey: String(row.metric_key),
        value: Number(row.value ?? 0),
        dataStatus: String(row.data_status) as KpiDataStatus,
      });
      result.set(workerId, values);
    }
    return result;
  },

  async activityMetrics(
    ctx: TenantContext,
    workerId: string,
    reportingDate: string,
    timezone: string,
  ): Promise<Record<string, number>> {
    const rows = await db.execute(sql`
      select "event_name", count(*)::int as count
      from "kpi_activity_events"
      where "tenant_id" = ${ctx.tenantId}
        and "worker_id" = ${workerId}
        and timezone(${timezone}, "received_at")::date = ${reportingDate}::date
      group by "event_name"
    `);
    return Object.fromEntries(
      rows
        .map((row) => [ACTIVITY_METRIC_KEYS[String(row.event_name)], Number(row.count ?? 0)] as const)
        .filter((entry): entry is readonly [string, number] => Boolean(entry[0])),
    );
  },

  async activityMetricsForWorkers(
    ctx: TenantContext,
    workerIds: string[],
    reportingDate: string,
    timezone: string,
  ): Promise<Map<string, Record<string, number>>> {
    const result = new Map<string, Record<string, number>>();
    if (workerIds.length === 0) return result;
    const rows = await db.execute(sql`
      with workers as (
        select jsonb_array_elements_text(${JSON.stringify(workerIds)}::jsonb) as worker_id
      )
      select e."worker_id", e."event_name", count(*)::int as count
      from "kpi_activity_events" e
      join workers w on w.worker_id = e."worker_id"
      where e."tenant_id" = ${ctx.tenantId}
        and timezone(${timezone}, e."received_at")::date = ${reportingDate}::date
      group by e."worker_id", e."event_name"
    `);
    for (const row of rows) {
      const metricKey = ACTIVITY_METRIC_KEYS[String(row.event_name)];
      if (!metricKey) continue;
      const workerId = String(row.worker_id);
      const values = result.get(workerId) ?? {};
      values[metricKey] = Number(row.count ?? 0);
      result.set(workerId, values);
    }
    return result;
  },

  async upsertDailyRollup(
    ctx: TenantContext,
    workerId: string,
    reportingDate: string,
    timezone: string,
    values: KpiMetricValueInput[],
    sourceWatermarks: Record<string, string>,
  ): Promise<string> {
    return db.transaction(async (tx) => {
      const rollupRows = await tx
        .insert(kpiDailyRollups)
        .values({
          tenantId: ctx.tenantId,
          workerId,
          reportingDate,
          timezone,
          sourceWatermarks,
        })
        .onConflictDoUpdate({
          target: [
            kpiDailyRollups.tenantId,
            kpiDailyRollups.workerId,
            kpiDailyRollups.reportingDate,
            kpiDailyRollups.calculationVersion,
          ],
          set: { sourceWatermarks, computedAt: new Date() },
        })
        .returning({ id: kpiDailyRollups.id });
      const rollupId = firstOrThrow(rollupRows, 'Failed to upsert daily KPI rollup').id;
      if (values.length > 0) {
        await tx
          .insert(kpiDailyMetricValues)
          .values(values.map((value) => ({
            tenantId: ctx.tenantId,
            rollupId,
            metricKey: value.metricKey,
            metricVersion: value.metricVersion ?? 1,
            numericValue: value.numericValue,
            numerator: value.numerator ?? null,
            denominator: value.denominator ?? null,
            dataStatus: value.dataStatus,
          })))
          .onConflictDoUpdate({
            target: [
              kpiDailyMetricValues.tenantId,
              kpiDailyMetricValues.rollupId,
              kpiDailyMetricValues.metricKey,
              kpiDailyMetricValues.metricVersion,
            ],
            set: {
              numericValue: sql`excluded.numeric_value`,
              numerator: sql`excluded.numerator`,
              denominator: sql`excluded.denominator`,
              dataStatus: sql`excluded.data_status`,
            },
          });
      }
      return rollupId;
    });
  },

  async metricDefinitions(ctx: TenantContext) {
    const rows = await db
      .select()
      .from(kpiMetricDefinitions)
      .where(
        and(
          eq(kpiMetricDefinitions.tenantId, ctx.tenantId),
          eq(kpiMetricDefinitions.active, true),
        ),
      )
      .orderBy(desc(kpiMetricDefinitions.version));
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.metricKey)) latest.set(row.metricKey, row);
    return Array.from(latest.values());
  },

  async dailyValuesForMonth(ctx: TenantContext, workerId: string, periodStart: string) {
    const nextMonth = new Date(`${periodStart}T00:00:00Z`);
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
    const to = nextMonth.toISOString().slice(0, 10);
    return db
      .select({
        reportingDate: kpiDailyRollups.reportingDate,
        sourceWatermarks: kpiDailyRollups.sourceWatermarks,
        metricKey: kpiDailyMetricValues.metricKey,
        metricVersion: kpiDailyMetricValues.metricVersion,
        numericValue: kpiDailyMetricValues.numericValue,
        numerator: kpiDailyMetricValues.numerator,
        denominator: kpiDailyMetricValues.denominator,
        dataStatus: kpiDailyMetricValues.dataStatus,
      })
      .from(kpiDailyRollups)
      .innerJoin(
        kpiDailyMetricValues,
        and(
          eq(kpiDailyMetricValues.tenantId, kpiDailyRollups.tenantId),
          eq(kpiDailyMetricValues.rollupId, kpiDailyRollups.id),
        ),
      )
      .where(
        and(
          eq(kpiDailyRollups.tenantId, ctx.tenantId),
          eq(kpiDailyRollups.workerId, workerId),
          eq(kpiDailyRollups.calculationVersion, EXTERNAL_KPI_CALCULATION_VERSION),
          gte(kpiDailyRollups.reportingDate, periodStart),
          lt(kpiDailyRollups.reportingDate, to),
        ),
      );
  },

  async latestMonthlySnapshot(ctx: TenantContext, workerId: string, periodStart: string) {
    const rows = await db
      .select()
      .from(kpiMonthlySnapshots)
      .where(
        and(
          eq(kpiMonthlySnapshots.tenantId, ctx.tenantId),
          eq(kpiMonthlySnapshots.workerId, workerId),
          eq(kpiMonthlySnapshots.periodStart, periodStart),
        ),
      )
      .orderBy(desc(kpiMonthlySnapshots.revision))
      .limit(1);
    const snapshot = rows[0];
    if (!snapshot) return null;
    const values = await db
      .select()
      .from(kpiMonthlyMetricValues)
      .where(
        and(
          eq(kpiMonthlyMetricValues.tenantId, ctx.tenantId),
          eq(kpiMonthlyMetricValues.snapshotId, snapshot.id),
        ),
      );
    return { snapshot, values };
  },

  async insertMonthlySnapshot(
    ctx: TenantContext,
    input: {
      workerId: string;
      periodStart: string;
      revision: number;
      timezone: string;
      workerProfileName?: string | null;
      workerRoleName?: string | null;
      sourceWatermarks?: Record<string, string>;
      values: KpiMetricValueInput[];
    },
  ): Promise<string> {
    return db.transaction(async (tx) => {
      const rows = await tx
        .insert(kpiMonthlySnapshots)
        .values({
          tenantId: ctx.tenantId,
          workerId: input.workerId,
          periodStart: input.periodStart,
          revision: input.revision,
          timezone: input.timezone,
          workerProfileName: input.workerProfileName ?? null,
          workerRoleName: input.workerRoleName ?? null,
          sourceWatermarks: input.sourceWatermarks ?? {},
        })
        .returning({ id: kpiMonthlySnapshots.id });
      const snapshotId = firstOrThrow(rows, 'Failed to insert monthly KPI snapshot').id;
      if (input.values.length > 0) {
        await tx.insert(kpiMonthlyMetricValues).values(
          input.values.map((value) => ({
            tenantId: ctx.tenantId,
            snapshotId,
            metricKey: value.metricKey,
            metricVersion: value.metricVersion ?? 1,
            numericValue: value.numericValue,
            numerator: value.numerator ?? null,
            denominator: value.denominator ?? null,
            dataStatus: value.dataStatus,
          })),
        );
      }
      return snapshotId;
    });
  },
};
