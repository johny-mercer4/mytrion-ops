import { env } from '../../config/env.js';
import { kpiDailyBatchRepo } from '../../repos/kpiDailyBatchRepo.js';
import { kpiRepo, type KpiMetricValueInput } from '../../repos/kpiRepo.js';
import {
  kpiTelemetryRepo,
  type TelemetrySourceAvailability,
} from '../../repos/kpiTelemetryRepo.js';
import { kpiWorkerRepo } from '../../repos/kpiWorkerRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { dayBounds } from './time.js';
import {
  MYTRION_USAGE_CALCULATION_VERSION,
  MYTRION_USAGE_METRIC_KEYS,
  type MytrionUsageMetricKey,
} from './usageMetrics.js';

function usageValues(
  activity: Record<string, number>,
  activeSeconds: number,
  visibleSeconds: number,
  lastTelemetryAt: Date | null,
  availability: TelemetrySourceAvailability,
  metricVersions: ReadonlyMap<string, number>,
): KpiMetricValueInput[] {
  const values: Record<MytrionUsageMetricKey, number | null> = {
    online_visible_seconds: availability.presenceAvailable ? visibleSeconds : null,
    online_active_seconds: availability.presenceAvailable ? activeSeconds : null,
    tab_open_clicks: activity['tab_open_clicks'] ?? 0,
    lead_open_clicks: activity['lead_open_clicks'] ?? 0,
    deal_open_clicks: activity['deal_open_clicks'] ?? 0,
    call_clicks: activity['call_clicks'] ?? 0,
    edit_open_clicks: activity['edit_open_clicks'] ?? 0,
    edit_save_successes: activity['edit_save_successes'] ?? 0,
    edit_save_failures: activity['edit_save_failures'] ?? 0,
    view_open_clicks: activity['view_open_clicks'] ?? 0,
    record_open_clicks: activity['record_open_clicks'] ?? 0,
    searches_completed: activity['searches_completed'] ?? 0,
    exports_completed: activity['exports_completed'] ?? 0,
    last_telemetry_at_epoch_seconds: lastTelemetryAt
      ? Math.floor(lastTelemetryAt.getTime() / 1000)
      : null,
  };
  return MYTRION_USAGE_METRIC_KEYS.map((metricKey) => {
    const presenceMetric =
      metricKey === 'online_visible_seconds' || metricKey === 'online_active_seconds';
    const lastTelemetryMetric = metricKey === 'last_telemetry_at_epoch_seconds';
    const dataStatus = presenceMetric
      ? availability.presenceAvailable ? 'complete' : 'unavailable'
      : lastTelemetryMetric
        ? availability.presenceAvailable && availability.activityAvailable
          ? 'complete'
          : availability.presenceAvailable || availability.activityAvailable
            ? 'partial'
            : 'unavailable'
        : availability.activityAvailable ? 'complete' : 'unavailable';
    return {
      metricKey,
      metricVersion: metricVersions.get(metricKey) ?? 1,
      numericValue: dataStatus === 'unavailable' ? null : values[metricKey],
      dataStatus,
    };
  });
}

function sourceWatermark(available: boolean, through: Date | null): string {
  return available && through ? `complete@${through.toISOString()}` : 'unavailable';
}

/** Local-only presence/activity rollup. External Zoho/DWH KPI collectors are not invoked. */
export async function computeUsageDailyRollups(
  ctx: TenantContext,
  days: string[],
): Promise<{ workers: number; days: number; rollups: number }> {
  const definitions = await kpiRepo.metricDefinitions(ctx);
  const metricVersions = new Map(
    definitions.map((definition) => [definition.metricKey, definition.version]),
  );
  const seenWorkers = new Set<string>();
  let rollups = 0;
  for (const day of days) {
    const bounds = dayBounds(day, env.KPI_REPORTING_TZ);
    const workers = await kpiWorkerRepo.listEligibleAt(
      ctx,
      bounds.start,
      bounds.end,
      'Sales Agent',
    );
    const workerIds = workers.map((worker) => worker.id);
    const [availability, activity, active, visible, lastTelemetry] = await Promise.all([
      kpiTelemetryRepo.sourceAvailabilityForDay(ctx, bounds.start, bounds.end),
      kpiRepo.activityMetricsForWorkers(ctx, workerIds, day, env.KPI_REPORTING_TZ),
      kpiTelemetryRepo.activeSecondsForWorkersDay(ctx, workerIds, bounds.start, bounds.end),
      kpiTelemetryRepo.visibleSecondsForWorkersDay(ctx, workerIds, bounds.start, bounds.end),
      kpiTelemetryRepo.lastTelemetryAtForWorkersDay(ctx, workerIds, bounds.start, bounds.end),
    ]);
    const values = workers.map((worker) => {
      seenWorkers.add(worker.id);
      return {
        workerId: worker.id,
        values: usageValues(
          activity.get(worker.id) ?? {},
          active.get(worker.id) ?? 0,
          visible.get(worker.id) ?? 0,
          lastTelemetry.get(worker.id) ?? null,
          availability,
          metricVersions,
        ),
      };
    });
    rollups += await kpiDailyBatchRepo.upsertDay(
      ctx,
      day,
      env.KPI_REPORTING_TZ,
      values,
      {
        'usage.activity': sourceWatermark(
          availability.activityAvailable,
          availability.activityThrough,
        ),
        'usage.presence': sourceWatermark(
          availability.presenceAvailable,
          availability.presenceThrough,
        ),
      },
      MYTRION_USAGE_CALCULATION_VERSION,
    );
  }
  return { workers: seenWorkers.size, days: days.length, rollups };
}
