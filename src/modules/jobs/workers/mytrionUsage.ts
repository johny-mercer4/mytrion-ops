import type { z } from 'zod';
import { env } from '../../../config/env.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { syncKpiWorkerDirectory } from '../../kpi/directoryCollector.js';
import { addCalendarDays, dayBounds, reportingDate } from '../../kpi/time.js';
import { computeUsageDailyRollups } from '../../kpi/usageRollup.js';
import { kpiUsageRetentionRepo } from '../../../repos/kpiUsageRetentionRepo.js';
import {
  mytrionUsageDailyJob,
  mytrionUsageRetentionJob,
} from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

const RETENTION_MAX_BATCHES = 20;
const RETENTION_MAX_RUNTIME_MS = 10 * 60_000;

function subtractCalendarMonths(day: string, months: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const date = Number(day.slice(8, 10));
  const target = new Date(Date.UTC(year, month - 1 - months, 1));
  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  target.setUTCDate(Math.min(date, lastDay));
  return target.toISOString().slice(0, 10);
}

function yesterday(now = new Date()): string {
  return addCalendarDays(reportingDate(now, env.KPI_REPORTING_TZ), -1);
}

export function usageRetentionCutoffs(now = new Date()): {
  rawBefore: Date;
  dailyBefore: string;
} {
  const today = reportingDate(now, env.KPI_REPORTING_TZ);
  const rawBeforeDay = addCalendarDays(today, -90);
  return {
    rawBefore: dayBounds(rawBeforeDay, env.KPI_REPORTING_TZ).start,
    dailyBefore: subtractCalendarMonths(today, 13),
  };
}

export async function runMytrionUsageDaily(
  payload: z.infer<typeof mytrionUsageDailyJob.schema>,
) {
  if (!env.FF_MYTRION_USAGE_COLLECTION_ENABLED && payload.trigger !== 'manual') {
    return { enabled: false };
  }
  const ctx = buildSystemContext(['sales']);
  const days = payload.days?.length ? payload.days : [yesterday()];
  const earliestManualDay = payload.trigger === 'manual' && payload.days?.length
    ? payload.days.reduce((earliest, day) => (day < earliest ? day : earliest))
    : undefined;
  const bootstrapFrom = earliestManualDay
    ? dayBounds(earliestManualDay, env.KPI_REPORTING_TZ).start
    : undefined;
  const workers = await syncKpiWorkerDirectory(ctx, bootstrapFrom);
  const rollups = await computeUsageDailyRollups(ctx, days);
  const output = {
    enabled: env.FF_MYTRION_USAGE_COLLECTION_ENABLED,
    manual: payload.trigger === 'manual',
    directoryWorkers: workers.length,
    ...rollups,
  };
  await auditFromContext(ctx, {
    action: 'mytrion.usage.daily_rollup',
    status: 'ok',
    resourceType: 'kpi_daily_rollup',
    detail: { ...output, trigger: payload.trigger ?? 'cron' },
  });
  return output;
}

export async function runMytrionUsageRetention(
  payload: z.infer<typeof mytrionUsageRetentionJob.schema>,
) {
  const ctx = buildSystemContext(['sales']);
  const { rawBefore, dailyBefore } = usageRetentionCutoffs();
  const batchSize = payload.batchSize ?? 10_000;
  const startedAt = Date.now();
  let retentionBatches = 0;
  let rawDrained = false;
  const raw = { activityEvents: 0, presenceEvents: 0, presenceSessions: 0 };
  // Raw first: an old daily parent remains as the proof that permits raw deletion. Daily cleanup
  // also refuses any worker/day that still has raw rows after this bounded drain.
  while (
    retentionBatches < RETENTION_MAX_BATCHES &&
    Date.now() - startedAt < RETENTION_MAX_RUNTIME_MS
  ) {
    const batch = await kpiUsageRetentionRepo.deleteRolledUpRaw(
      ctx,
      rawBefore,
      env.KPI_REPORTING_TZ,
      batchSize,
    );
    retentionBatches += 1;
    raw.activityEvents += batch.activityEvents;
    raw.presenceEvents += batch.presenceEvents;
    raw.presenceSessions += batch.presenceSessions;
    if (
      batch.activityEvents < batchSize &&
      batch.presenceEvents < batchSize &&
      batch.presenceSessions < batchSize
    ) {
      rawDrained = true;
      break;
    }
  }
  const dailyRollups = await kpiUsageRetentionRepo.deleteDailyRollups(
    ctx,
    dailyBefore,
    env.KPI_REPORTING_TZ,
    batchSize,
  );
  const output = {
    enabled: true,
    collectionEnabled: env.FF_MYTRION_USAGE_COLLECTION_ENABLED,
    rawBefore: rawBefore.toISOString(),
    dailyBefore,
    batchSize,
    maxBatches: RETENTION_MAX_BATCHES,
    maxRuntimeMs: RETENTION_MAX_RUNTIME_MS,
    retentionBatches,
    rawDrained,
    ...raw,
    dailyRollups,
  };
  await auditFromContext(ctx, {
    action: 'mytrion.usage.retention',
    status: 'ok',
    resourceType: 'kpi_usage_retention',
    detail: { ...output, trigger: payload.trigger ?? 'cron' },
  });
  return output;
}
