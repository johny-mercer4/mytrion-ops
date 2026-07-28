import { env } from '../../config/env.js';
import { kpiRepo } from '../../repos/kpiRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { addCalendarDays, reportingDate } from './time.js';

type Row = Record<string, unknown>;
export type KpiSyncMode = 'hourly' | 'reconcile' | 'backfill';

export interface KpiSourceWindow {
  now: Date;
  start: Date;
  end: Date;
  fromDate: string;
  toDate: string;
}

export function dateList(from: string, toInclusive: string): string[] {
  const dates: string[] = [];
  for (let cursor = from; cursor <= toInclusive; cursor = addCalendarDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

export function stableDayTimestamp(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function zohoDateTime(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export function latestModifiedCursor(rows: Row[], fallback: Date): string {
  let latest = fallback;
  for (const row of rows) {
    const parsed = new Date(row.Modified_Time == null ? '' : String(row.Modified_Time));
    if (!Number.isNaN(parsed.getTime()) && parsed > latest) latest = parsed;
  }
  return latest.toISOString();
}

export async function queryStartFor(
  ctx: TenantContext,
  source: string,
  mode: KpiSyncMode,
  fallback: Date,
): Promise<Date> {
  if (mode !== 'hourly') return fallback;
  const cursor = await kpiRepo.latestIngestionCursor(ctx, source);
  const parsed = cursor ? new Date(cursor) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Date(parsed.getTime() - 5 * 60_000)
    : fallback;
}

export function sourceWindow(options: {
  mode: KpiSyncMode;
  lookbackDays?: number;
  now?: Date;
}): KpiSourceWindow {
  const now = options.now ?? new Date();
  const days = Math.min(
    Math.max(options.lookbackDays ?? (options.mode === 'backfill' ? 90 : 7), 1),
    365,
  );
  const start =
    options.mode === 'hourly'
      ? new Date(now.getTime() - 2 * 60 * 60 * 1000)
      : new Date(now.getTime() - days * 86_400_000);
  return {
    now,
    start,
    end: now,
    fromDate: reportingDate(start, env.KPI_REPORTING_TZ),
    toDate: reportingDate(now, env.KPI_REPORTING_TZ),
  };
}
