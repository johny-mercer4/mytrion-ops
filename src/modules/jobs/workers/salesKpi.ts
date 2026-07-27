import type { z } from 'zod';
import { env } from '../../../config/env.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { runSalesKpiSync } from '../../kpi/collector.js';
import {
  computeDailyRollups,
  finalizeMonth,
  yesterdayInReportingZone,
} from '../../kpi/rollup.js';
import {
  addCalendarDays,
  previousMonthStart,
  reportingDate,
} from '../../kpi/time.js';
import {
  kpiSalesDailyRollupJob,
  kpiSalesHourlySyncJob,
  kpiSalesMonthCloseJob,
  kpiSalesReconcileJob,
} from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

async function finalizeChangedClosedMonths(
  ctx: ReturnType<typeof buildSystemContext>,
  days: string[],
  today: string,
) {
  const currentMonth = `${today.slice(0, 7)}-01`;
  const previousMonth = previousMonthStart(new Date(), env.KPI_REPORTING_TZ);
  const dayOfMonth = Number(today.slice(8, 10));
  const closedMonths = [...new Set(days.map((day) => `${day.slice(0, 7)}-01`))]
    .filter((month) => month !== currentMonth)
    .filter((month) => month !== previousMonth || dayOfMonth >= 3);
  const revisions = [];
  for (const month of closedMonths) revisions.push(await finalizeMonth(ctx, month));
  return revisions;
}

export async function runKpiHourlySync(
  payload: z.infer<typeof kpiSalesHourlySyncJob.schema>,
) {
  const ctx = buildSystemContext(['sales']);
  const summary = await runSalesKpiSync(ctx, { mode: 'hourly' });
  const rollups = summary.affectedDates.length
    ? await computeDailyRollups(ctx, summary.affectedDates)
    : { workers: 0, days: 0, rollups: 0 };
  const today = reportingDate(new Date(), env.KPI_REPORTING_TZ);
  const monthRevisions = await finalizeChangedClosedMonths(
    ctx,
    summary.affectedDates,
    today,
  );
  const output = { summary, rollups, monthRevisions };
  await auditFromContext(ctx, {
    action: 'kpi.sales.hourly_sync',
    status: summary.partialSources.length > 0 ? 'error' : 'ok',
    resourceType: 'kpi_ingestion',
    detail: { ...output, trigger: payload.trigger ?? 'cron' },
  });
  return output;
}

export async function runKpiReconcile(
  payload: z.infer<typeof kpiSalesReconcileJob.schema>,
) {
  const ctx = buildSystemContext(['sales']);
  const lookbackDays = payload.lookbackDays ?? 7;
  const mode = payload.mode ?? (lookbackDays > 7 ? 'backfill' : 'reconcile');
  const summary = await runSalesKpiSync(ctx, { mode, lookbackDays });
  const today = reportingDate(new Date(), env.KPI_REPORTING_TZ);
  const days: string[] = [];
  for (
    let cursor = addCalendarDays(today, -(lookbackDays - 1));
    cursor <= today;
    cursor = addCalendarDays(cursor, 1)
  ) {
    days.push(cursor);
  }
  const rollups = await computeDailyRollups(ctx, days);
  const monthRevisions = await finalizeChangedClosedMonths(ctx, days, today);
  const output = { summary, rollups, monthRevisions };
  await auditFromContext(ctx, {
    action: 'kpi.sales.reconcile',
    status: summary.partialSources.length > 0 ? 'error' : 'ok',
    resourceType: 'kpi_ingestion',
    detail: { ...output, trigger: payload.trigger ?? 'cron' },
  });
  return output;
}

export async function runKpiDailyRollup(
  payload: z.infer<typeof kpiSalesDailyRollupJob.schema>,
) {
  const ctx = buildSystemContext(['sales']);
  const days = payload.days?.length ? payload.days : [yesterdayInReportingZone()];
  const summary = await computeDailyRollups(ctx, days);
  await auditFromContext(ctx, {
    action: 'kpi.sales.daily_rollup',
    status: 'ok',
    resourceType: 'kpi_daily_rollup',
    detail: { ...summary, trigger: payload.trigger ?? 'cron' },
  });
  return summary;
}

export async function runKpiMonthClose(
  payload: z.infer<typeof kpiSalesMonthCloseJob.schema>,
) {
  const ctx = buildSystemContext(['sales']);
  const periodStart =
    payload.periodStart ?? previousMonthStart(new Date(), env.KPI_REPORTING_TZ);
  const summary = await finalizeMonth(ctx, periodStart);
  await auditFromContext(ctx, {
    action: 'kpi.sales.month_close',
    status: 'ok',
    resourceType: 'kpi_monthly_snapshot',
    resourceId: periodStart,
    detail: { ...summary, trigger: payload.trigger ?? 'cron' },
  });
  return summary;
}
