import { env } from '../../config/env.js';
import type { KpiDataStatus, KpiWorker } from '../../db/schema/index.js';
import {
  kpiRepo,
  type ExternalMetricTotal,
  type KpiMetricValueInput,
} from '../../repos/kpiRepo.js';
import { kpiDailyBatchRepo } from '../../repos/kpiDailyBatchRepo.js';
import { kpiTaskMetricsRepo } from '../../repos/kpiTaskMetricsRepo.js';
import { kpiTelemetryRepo } from '../../repos/kpiTelemetryRepo.js';
import { kpiWorkerRepo } from '../../repos/kpiWorkerRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { dayBounds, monthDays, reportingDate } from './time.js';

const BASE_KEYS = [
  'calls_mytrion',
  'calls_zoho',
  'calls_answered',
  'call_talk_seconds',
  'applications',
  'tasks_assigned',
  'tasks_due',
  'tasks_completed',
  'tasks_completed_on_time',
  'tasks_open_end',
  'tasks_overdue_end',
  'online_active_seconds',
  'lead_open_clicks',
  'deal_open_clicks',
  'call_clicks',
  'edit_open_clicks',
  'edit_save_successes',
  'tab_open_clicks',
  'card_swipes',
] as const;

function statusAcross(statuses: KpiDataStatus[]): KpiDataStatus {
  if (statuses.length === 0 || statuses.every((status) => status === 'unavailable')) {
    return 'unavailable';
  }
  return statuses.every((status) => status === 'complete') ? 'complete' : 'partial';
}

function latestWatermarks(
  rows: Array<{ sourceWatermarks: Record<string, string> }>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const row of rows) {
    for (const [source, watermark] of Object.entries(row.sourceWatermarks)) {
      const timestamp = watermark.split('@').at(-1) ?? '';
      const currentTimestamp = merged[source]?.split('@').at(-1) ?? '';
      if (timestamp > currentTimestamp) merged[source] = watermark;
    }
  }
  return merged;
}

interface WorkerDayInputs {
  calls: Record<string, number>;
  external: ExternalMetricTotal[];
  activity: Record<string, number>;
  tasks: Record<string, number>;
  onlineSeconds: number;
}

function workerDayValues(
  input: WorkerDayInputs,
  metricVersions: ReadonlyMap<string, number>,
): KpiMetricValueInput[] {
  const values = new Map<string, KpiMetricValueInput>(
    BASE_KEYS.map((metricKey) => [
      metricKey,
      {
        metricKey,
        numericValue: 0,
        dataStatus:
          metricKey === 'calls_zoho' ||
          metricKey === 'applications' ||
          metricKey === 'card_swipes'
            ? 'unavailable'
            : 'complete',
      },
    ]),
  );
  for (const [metricKey, numericValue] of Object.entries(input.calls)) {
    values.set(metricKey, { metricKey, numericValue, dataStatus: 'complete' });
  }
  for (const row of input.external) {
    const existing = values.get(row.metricKey);
    const additive =
      row.metricKey === 'calls_answered' || row.metricKey === 'call_talk_seconds';
    values.set(row.metricKey, {
      metricKey: row.metricKey,
      numericValue: (additive ? existing?.numericValue ?? 0 : 0) + row.value,
      dataStatus: additive
        ? statusAcross([existing?.dataStatus ?? 'unavailable', row.dataStatus])
        : row.dataStatus,
    });
  }
  for (const [metricKey, numericValue] of Object.entries(input.activity)) {
    values.set(metricKey, { metricKey, numericValue, dataStatus: 'complete' });
  }
  for (const [metricKey, numericValue] of Object.entries(input.tasks)) {
    values.set(metricKey, { metricKey, numericValue, dataStatus: 'complete' });
  }
  values.set('online_active_seconds', {
    metricKey: 'online_active_seconds',
    numericValue: input.onlineSeconds,
    dataStatus: 'complete',
  });
  const due = values.get('tasks_due')?.numericValue ?? 0;
  const completed = values.get('tasks_completed')?.numericValue ?? 0;
  const onTime = values.get('tasks_completed_on_time')?.numericValue ?? 0;
  values.set('task_completion_rate', {
    metricKey: 'task_completion_rate',
    numericValue: due > 0 ? completed / due : null,
    numerator: completed,
    denominator: due,
    dataStatus: 'complete',
  });
  values.set('task_on_time_rate', {
    metricKey: 'task_on_time_rate',
    numericValue: due > 0 ? onTime / due : null,
    numerator: onTime,
    denominator: due,
    dataStatus: 'complete',
  });
  return Array.from(values.values()).map((value) => ({
    ...value,
    metricVersion: metricVersions.get(value.metricKey) ?? 1,
  }));
}

export async function computeWorkerDay(
  ctx: TenantContext,
  worker: KpiWorker,
  day: string,
  metricVersions: ReadonlyMap<string, number> = new Map(),
): Promise<KpiMetricValueInput[]> {
  const calls = await kpiRepo.mytrionCallMetrics(
    ctx,
    worker.zohoUserId,
    day,
    env.KPI_REPORTING_TZ,
  );
  const external = await kpiRepo.externalMetricTotals(ctx, worker.id, day);
  const activity = await kpiRepo.activityMetrics(ctx, worker.id, day, env.KPI_REPORTING_TZ);
  const tasks = await kpiTaskMetricsRepo.forWorkerDay(
    ctx,
    worker.zohoUserId,
    day,
    env.KPI_REPORTING_TZ,
  );
  const bounds = dayBounds(day, env.KPI_REPORTING_TZ);
  const onlineSeconds = await kpiTelemetryRepo.activeSecondsForDay(
    ctx,
    worker.id,
    bounds.start,
    bounds.end,
  );
  return workerDayValues(
    { calls, external, activity, tasks, onlineSeconds },
    metricVersions,
  );
}

export async function computeDailyRollups(
  ctx: TenantContext,
  days: string[],
): Promise<{ workers: number; days: number; rollups: number }> {
  const workerIds = new Set<string>();
  let rollups = 0;
  const definitions = await kpiRepo.metricDefinitions(ctx);
  const metricVersions = new Map(definitions.map((definition) => [
    definition.metricKey,
    definition.version,
  ]));
  for (const day of days) {
    const bounds = dayBounds(day, env.KPI_REPORTING_TZ);
    const workers = await kpiWorkerRepo.listEligibleAt(ctx, bounds.start, bounds.end);
    const sourceWatermarks = await kpiRepo.ingestionWatermarks(ctx);
    const eligibleWorkerIds = workers.map((worker) => worker.id);
    const zohoUserIds = workers.map((worker) => worker.zohoUserId);
    const calls = await kpiRepo.mytrionCallMetricsForWorkers(
      ctx,
      zohoUserIds,
      day,
      env.KPI_REPORTING_TZ,
    );
    const external = await kpiRepo.externalMetricTotalsForWorkers(
      ctx,
      eligibleWorkerIds,
      day,
    );
    const activity = await kpiRepo.activityMetricsForWorkers(
      ctx,
      eligibleWorkerIds,
      day,
      env.KPI_REPORTING_TZ,
    );
    const tasks = await kpiTaskMetricsRepo.forWorkersDay(
      ctx,
      zohoUserIds,
      day,
      env.KPI_REPORTING_TZ,
    );
    const presence = await kpiTelemetryRepo.activeSecondsForWorkersDay(
      ctx,
      eligibleWorkerIds,
      bounds.start,
      bounds.end,
    );
    const workerValues = [];
    for (const worker of workers) {
      workerIds.add(worker.id);
      const values = workerDayValues(
        {
          calls: calls.get(worker.zohoUserId) ?? {},
          external: external.get(worker.id) ?? [],
          activity: activity.get(worker.id) ?? {},
          tasks: tasks.get(worker.zohoUserId) ?? {},
          onlineSeconds: presence.get(worker.id) ?? 0,
        },
        metricVersions,
      );
      workerValues.push({ workerId: worker.id, values });
    }
    rollups += await kpiDailyBatchRepo.upsertDay(
      ctx,
      day,
      env.KPI_REPORTING_TZ,
      workerValues,
      sourceWatermarks,
    );
  }
  return { workers: workerIds.size, days: days.length, rollups };
}

function equalSnapshot(
  current: Awaited<ReturnType<typeof kpiRepo.latestMonthlySnapshot>>,
  values: KpiMetricValueInput[],
): boolean {
  if (!current || current.values.length !== values.length) return false;
  const old = new Map(current.values.map((value) => [value.metricKey, value]));
  return values.every((value) => {
    const prior = old.get(value.metricKey);
    return (
      prior?.numericValue === value.numericValue &&
      prior.metricVersion === (value.metricVersion ?? 1) &&
      prior.numerator === (value.numerator ?? null) &&
      prior.denominator === (value.denominator ?? null) &&
      prior.dataStatus === value.dataStatus
    );
  });
}

export async function finalizeMonth(
  ctx: TenantContext,
  periodStart: string,
): Promise<{ workers: number; created: number; unchanged: number }> {
  const definitions = await kpiRepo.metricDefinitions(ctx);
  const workers = await kpiWorkerRepo.list(ctx);
  const expectedDays = monthDays(periodStart);
  const periodBounds = dayBounds(periodStart, env.KPI_REPORTING_TZ);
  const periodEnd = dayBounds(
    expectedDays[expectedDays.length - 1] ?? periodStart,
    env.KPI_REPORTING_TZ,
  ).end;
  let created = 0;
  let unchanged = 0;
  for (const worker of workers) {
    const daily = await kpiRepo.dailyValuesForMonth(ctx, worker.id, periodStart);
    if (daily.length === 0) continue;
    const byMetric = new Map<string, typeof daily>();
    for (const row of daily) {
      const list = byMetric.get(row.metricKey) ?? [];
      list.push(row);
      byMetric.set(row.metricKey, list);
    }
    const values: KpiMetricValueInput[] = [];
    const sums = new Map<string, number>();
    const statuses = new Map<string, KpiDataStatus>();
    for (const definition of definitions.filter((item) => item.aggregation !== 'ratio')) {
      const rows = byMetric.get(definition.metricKey) ?? [];
      const completeDays = new Set(rows.map((row) => row.reportingDate)).size;
      const dataStatus =
        completeDays < expectedDays.length
          ? rows.length === 0
            ? 'unavailable'
            : 'partial'
          : statusAcross(rows.map((row) => row.dataStatus));
      const numericValue =
        definition.aggregation === 'last'
          ? [...rows].sort((a, b) => b.reportingDate.localeCompare(a.reportingDate))[0]
              ?.numericValue ?? null
          : rows.reduce((total, row) => total + (row.numericValue ?? 0), 0);
      sums.set(definition.metricKey, numericValue ?? 0);
      statuses.set(definition.metricKey, dataStatus);
      values.push({
        metricKey: definition.metricKey,
        metricVersion: definition.version,
        numericValue,
        dataStatus,
      });
    }
    for (const definition of definitions.filter((item) => item.aggregation === 'ratio')) {
      const numerator = sums.get(definition.numeratorMetricKey ?? '') ?? 0;
      const denominator = sums.get(definition.denominatorMetricKey ?? '') ?? 0;
      const dataStatus = statusAcross([
        statuses.get(definition.numeratorMetricKey ?? '') ?? 'unavailable',
        statuses.get(definition.denominatorMetricKey ?? '') ?? 'unavailable',
      ]);
      values.push({
        metricKey: definition.metricKey,
        metricVersion: definition.version,
        numericValue: denominator > 0 ? numerator / denominator : null,
        numerator,
        denominator,
        dataStatus,
      });
    }
    const current = await kpiRepo.latestMonthlySnapshot(ctx, worker.id, periodStart);
    if (equalSnapshot(current, values)) {
      unchanged += 1;
      continue;
    }
    await kpiRepo.insertMonthlySnapshot(ctx, {
      workerId: worker.id,
      periodStart,
      revision: (current?.snapshot.revision ?? 0) + 1,
      timezone: env.KPI_REPORTING_TZ,
      workerProfileName: await kpiWorkerRepo.profileForPeriod(
        ctx,
        worker.id,
        periodBounds.start,
        periodEnd,
      ),
      workerRoleName: worker.currentRoleName,
      sourceWatermarks: latestWatermarks(daily),
      values,
    });
    created += 1;
  }
  return { workers: workers.length, created, unchanged };
}

export function yesterdayInReportingZone(now = new Date()): string {
  const today = reportingDate(now, env.KPI_REPORTING_TZ);
  const midnight = new Date(`${today}T00:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() - 1);
  return midnight.toISOString().slice(0, 10);
}
