import { env } from '../../config/env.js';
import { fetchAgentSalesDashboard, fetchHomeSnapshot } from '../../integrations/salesDashboards.js';
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { errorMessage } from '../../lib/errors.js';
import { kpiRepo } from '../../repos/kpiRepo.js';
import {
  kpiExternalFactRepo,
  type ExternalFactInput,
} from '../../repos/kpiExternalFactRepo.js';
import { kpiMappingRepo } from '../../repos/kpiMappingRepo.js';
import type { KpiWorker } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { reportingDate } from './time.js';
import { syncKpiWorkerDirectory } from './directoryCollector.js';
import {
  dateList,
  latestModifiedCursor,
  queryStartFor,
  sourceWindow,
  stableDayTimestamp,
  zohoDateTime,
  type KpiSourceWindow,
  type KpiSyncMode,
} from './collectorWindow.js';

type Row = Record<string, unknown>;
export interface KpiSyncOptions {
  mode: KpiSyncMode;
  lookbackDays?: number;
  now?: Date;
}
export interface KpiSyncSummary {
  workers: number;
  calls: number;
  applications: number;
  swipeDays: number;
  unresolvedOwners: number;
  partialSources: string[];
  affectedDates: string[];
}
function recordId(value: unknown): string {
  return value == null ? '' : String(value);
}
function lookupId(value: unknown): string {
  if (value && typeof value === 'object') {
    return recordId((value as { id?: unknown }).id);
  }
  return '';
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) ? number : fallback;
}

function callSeconds(row: Row): number {
  const seconds = finiteNumber(row.Call_Duration_in_seconds, -1);
  if (seconds >= 0) return seconds;
  const duration = typeof row.Call_Duration === 'string' ? row.Call_Duration : '';
  if (!/^\d+(:\d{1,2})+$/.test(duration)) return 0;
  return duration.split(':').reduce((total, part) => total * 60 + Number(part), 0);
}

function answeredCall(row: Row): boolean {
  return /answer|connect|completed/i.test(
    String(row.Outgoing_Call_Status ?? row.Call_Result ?? row.Call_Type ?? ''),
  );
}

async function pagedCoql(base: string): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  const pageSize = 2000;
  let truncated = false;
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const result = await zohoCrm.runCoql(`${base} limit ${offset}, ${pageSize}`);
    rows.push(...result.rows);
    if (!result.moreRecords || result.rows.length < pageSize) break;
    if (offset + pageSize >= 100_000) truncated = true;
  }
  return { rows, truncated };
}

async function collectZohoCalls(
  ctx: TenantContext,
  workers: KpiWorker[],
  window: KpiSourceWindow,
  mode: KpiSyncOptions['mode'],
): Promise<{ written: number; unresolved: number; dates: string[]; partial: boolean }> {
  const queryStart = await queryStartFor(ctx, 'zoho_calls', mode, window.start);
  const run = await kpiRepo.startIngestion(ctx, {
    source: 'zoho_calls',
    mode,
    windowStart: queryStart,
    windowEnd: window.end,
    cursor: queryStart.toISOString(),
  });
  let seen = 0;
  let written = 0;
  let unresolved = 0;
  let invalid = 0;
  const dates = new Set<string>();
  const pending: ExternalFactInput[] = [];
  try {
    const condition =
      mode === 'hourly'
        ? `Modified_Time >= '${zohoDateTime(queryStart)}' and Modified_Time <= '${zohoDateTime(window.end)}'`
        : `Call_Start_Time >= '${zohoDateTime(window.start)}' and Call_Start_Time <= '${zohoDateTime(window.end)}'`;
    const page = await pagedCoql(
      `select id, Owner, Call_Type, Call_Start_Time, Call_Duration, ` +
        `Call_Duration_in_seconds, Outgoing_Call_Status, Call_Result, Modified_Time ` +
        `from Calls where ${condition} order by Modified_Time asc`,
    );
    const rows = page.rows;
    seen = rows.length;
    const byZoho = new Map(workers.map((worker) => [worker.zohoUserId, worker]));
    const priorFacts = await kpiExternalFactRepo.latestForKeys(
      ctx,
      'zoho_calls',
      rows
        .filter((row) => !byZoho.has(lookupId(row.Owner)))
        .map((row) => `Calls:${recordId(row.id)}`)
        .filter((key) => key !== 'Calls:'),
      ['calls_zoho', 'calls_answered', 'call_talk_seconds'],
    );
    for (const row of rows) {
      const ownerId = lookupId(row.Owner);
      const worker = byZoho.get(ownerId);
      const id = recordId(row.id);
      const occurredAt = new Date(recordId(row.Call_Start_Time));
      if (!id || Number.isNaN(occurredAt.getTime())) {
        invalid += 1;
        continue;
      }
      const facts = [
        { metricKey: 'calls_zoho', numericValue: 1 },
        { metricKey: 'calls_answered', numericValue: answeredCall(row) ? 1 : 0 },
        { metricKey: 'call_talk_seconds', numericValue: callSeconds(row) },
      ];
      if (!worker) {
        if (!ownerId) {
          unresolved += 1;
          await kpiMappingRepo.recordUnresolved(ctx, {
            source: 'zoho_calls',
            sourceKey: `Calls:${id}`,
            reason: 'missing_owner_id',
            ingestionRunId: run.id,
          });
        }
        for (const fact of facts) {
          const latest = priorFacts.get(`Calls:${id}\u0000${fact.metricKey}`);
          if (!latest || latest.numericValue === 0) continue;
          const result = await kpiExternalFactRepo.append(ctx, {
            workerId: latest.workerId,
            ingestionRunId: run.id,
            source: 'zoho_calls',
            sourceKey: `Calls:${id}`,
            metricKey: fact.metricKey,
            occurredAt: latest.occurredAt,
            reportingDate: latest.reportingDate,
            numericValue: 0,
            dimensions: { removedFromEligiblePopulation: true },
          });
          if (result.inserted) {
            written += 1;
            dates.add(latest.reportingDate);
          }
        }
        continue;
      }
      const day = reportingDate(occurredAt, env.KPI_REPORTING_TZ);
      for (const fact of facts) {
        pending.push({
          workerId: worker.id,
          ingestionRunId: run.id,
          source: 'zoho_calls',
          sourceKey: `Calls:${id}`,
          metricKey: fact.metricKey,
          occurredAt,
          reportingDate: day,
          numericValue: fact.numericValue,
          dimensions: { ownerZohoUserId: worker.zohoUserId },
        });
      }
    }
    for (const worker of workers) {
      for (const day of dateList(window.fromDate, window.toDate)) {
        for (const metricKey of ['calls_zoho', 'calls_answered', 'call_talk_seconds']) {
          pending.push({
            workerId: worker.id,
            ingestionRunId: run.id,
            source: 'zoho_calls',
            sourceKey: `summary:${worker.zohoUserId}:${day}`,
            metricKey,
            occurredAt: stableDayTimestamp(day),
            reportingDate: day,
            numericValue: 0,
            dimensions: { summary: true },
          });
        }
      }
    }
    const batch = await kpiExternalFactRepo.appendBatch(ctx, pending);
    written += batch.inserted;
    batch.reportingDates.forEach((day) => dates.add(day));
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: unresolved > 0 || invalid > 0 || page.truncated ? 'partial' : 'completed',
      recordsSeen: seen,
      recordsWritten: written,
      unresolvedMappings: unresolved,
      cursor: latestModifiedCursor(rows, window.end),
      error: invalid > 0 ? `${invalid} invalid call record(s) skipped` : null,
    });
    return {
      written,
      unresolved,
      dates: Array.from(dates),
      partial: unresolved > 0 || invalid > 0 || page.truncated,
    };
  } catch (error) {
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: 'failed',
      recordsSeen: seen,
      recordsWritten: written,
      unresolvedMappings: unresolved,
      error: errorMessage(error),
    });
    throw error;
  }
}

async function collectApplications(
  ctx: TenantContext,
  workers: KpiWorker[],
  window: KpiSourceWindow,
  mode: KpiSyncOptions['mode'],
): Promise<{ written: number; unresolved: number; dates: string[]; partial: boolean }> {
  const queryStart = await queryStartFor(ctx, 'zoho_applications', mode, window.start);
  const run = await kpiRepo.startIngestion(ctx, {
    source: 'zoho_applications',
    mode,
    windowStart: queryStart,
    windowEnd: window.end,
    cursor: queryStart.toISOString(),
  });
  let seen = 0;
  let written = 0;
  let unresolved = 0;
  let invalid = 0;
  const dates = new Set<string>();
  const pending: ExternalFactInput[] = [];
  try {
    const condition =
      mode !== 'hourly'
        ? `Application_Date >= '${window.fromDate}' and Application_Date <= '${window.toDate}'`
        : `Modified_Time >= '${zohoDateTime(queryStart)}' and Modified_Time <= '${zohoDateTime(window.end)}'`;
    const page = await pagedCoql(
      `select id, Owner, Application_Date, Modified_Time from Deals where ${condition} ` +
        `order by Modified_Time asc`,
    );
    const rows = page.rows;
    seen = rows.length;
    const byZoho = new Map(workers.map((worker) => [worker.zohoUserId, worker]));
    const priorFacts = await kpiExternalFactRepo.latestForKeys(
      ctx,
      'zoho_applications',
      rows
        .filter((row) => {
          const day = recordId(row.Application_Date).slice(0, 10);
          return !byZoho.has(lookupId(row.Owner)) || !/^\d{4}-\d{2}-\d{2}$/.test(day);
        })
        .map((row) => `Deals:${recordId(row.id)}:Application_Date`)
        .filter((key) => key !== 'Deals::Application_Date'),
      ['applications'],
    );
    for (const row of rows) {
      const ownerId = lookupId(row.Owner);
      const worker = byZoho.get(ownerId);
      const id = recordId(row.id);
      const day = recordId(row.Application_Date).slice(0, 10);
      if (!id) {
        invalid += 1;
        continue;
      }
      const sourceKey = `Deals:${id}:Application_Date`;
      const validDay = /^\d{4}-\d{2}-\d{2}$/.test(day);
      if (!worker || !validDay) {
        if (!ownerId) {
          unresolved += 1;
          await kpiMappingRepo.recordUnresolved(ctx, {
            source: 'zoho_applications',
            sourceKey,
            reason: 'missing_owner_id',
            ingestionRunId: run.id,
          });
        }
        if (row.Application_Date != null && !validDay) invalid += 1;
        const latest = priorFacts.get(`${sourceKey}\u0000applications`);
        if (latest && latest.numericValue !== 0) {
          const result = await kpiExternalFactRepo.append(ctx, {
            workerId: latest.workerId,
            ingestionRunId: run.id,
            source: 'zoho_applications',
            sourceKey,
            metricKey: 'applications',
            occurredAt: latest.occurredAt,
            reportingDate: latest.reportingDate,
            numericValue: 0,
            dimensions: {
              removed: true,
              reason: validDay ? 'owner_not_eligible' : 'application_date_cleared',
            },
          });
          if (result.inserted) {
            written += 1;
            dates.add(latest.reportingDate);
          }
        }
        continue;
      }
      const occurredAt = stableDayTimestamp(day);
      pending.push({
        workerId: worker.id,
        ingestionRunId: run.id,
        source: 'zoho_applications',
        sourceKey,
        metricKey: 'applications',
        occurredAt,
        reportingDate: day,
        numericValue: 1,
        dimensions: { ownerZohoUserId: worker.zohoUserId },
      });
    }
    for (const worker of workers) {
      for (const day of dateList(window.fromDate, window.toDate)) {
        pending.push({
          workerId: worker.id,
          ingestionRunId: run.id,
          source: 'zoho_applications',
          sourceKey: `summary:${worker.zohoUserId}:${day}`,
          metricKey: 'applications',
          occurredAt: stableDayTimestamp(day),
          reportingDate: day,
          numericValue: 0,
          dimensions: { summary: true },
        });
      }
    }
    const batch = await kpiExternalFactRepo.appendBatch(ctx, pending);
    written += batch.inserted;
    batch.reportingDates.forEach((day) => dates.add(day));
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: unresolved > 0 || invalid > 0 || page.truncated ? 'partial' : 'completed',
      recordsSeen: seen,
      recordsWritten: written,
      unresolvedMappings: unresolved,
      cursor: latestModifiedCursor(rows, window.end),
      error: invalid > 0 ? `${invalid} invalid application record(s) skipped` : null,
    });
    return {
      written,
      unresolved,
      dates: Array.from(dates),
      partial: unresolved > 0 || invalid > 0 || page.truncated,
    };
  } catch (error) {
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: 'failed',
      recordsSeen: seen,
      recordsWritten: written,
      unresolvedMappings: unresolved,
      error: errorMessage(error),
    });
    throw error;
  }
}

function dashboardData(value: unknown): Row | null {
  if (!value || typeof value !== 'object') return null;
  const root = value as Row;
  if (root.success === false) return null;
  return root.data && typeof root.data === 'object' ? (root.data as Row) : null;
}

async function collectSwipes(
  ctx: TenantContext,
  workers: KpiWorker[],
  window: KpiSourceWindow,
  mode: KpiSyncOptions['mode'],
): Promise<{
  written: number;
  dates: string[];
  unresolved: number;
  unavailable: number;
}> {
  const run = await kpiRepo.startIngestion(ctx, {
    source: 'sales_dwh',
    mode,
    windowStart: window.start,
    windowEnd: window.end,
  });
  let seen = 0;
  let written = 0;
  let unresolved = 0;
  let unavailable = 0;
  const dates = new Set<string>();
  const pending: ExternalFactInput[] = [];
  try {
    const nameCounts = new Map<string, number>();
    for (const worker of workers) {
      const key = worker.displayName?.trim().toLocaleLowerCase();
      if (key) nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    }
    for (const worker of workers) {
      const nameKey = worker.displayName?.trim().toLocaleLowerCase();
      if (!worker.displayName || !nameKey || nameCounts.get(nameKey) !== 1) {
        unresolved += 1;
        await kpiMappingRepo.recordUnresolved(ctx, {
          source: 'sales_dwh',
          sourceKey: worker.zohoUserId,
          observedLabel: worker.displayName,
          reason: worker.displayName ? 'duplicate_display_name' : 'missing_display_name',
          ingestionRunId: run.id,
        });
        continue;
      }
      try {
        const data = dashboardData(await fetchAgentSalesDashboard(worker.displayName));
        if (!data) throw new Error('dashboard unavailable');
        const daily = Array.isArray(data.dailyTransactionsByCarrier)
          ? (data.dailyTransactionsByCarrier as Row[])
          : [];
        const totals = new Map<string, number>();
        for (const row of daily) {
          const day = recordId(row.date).slice(0, 10);
          if (day < window.fromDate || day > window.toDate) continue;
          totals.set(day, (totals.get(day) ?? 0) + finiteNumber(row.transactions));
          seen += 1;
        }
        if (daily.length === 0) {
          const home = (await fetchHomeSnapshot(worker.zohoUserId, worker.displayName)) as Row;
          const snapshot = (home.snapshot as Row | undefined) ?? {};
          totals.set(window.toDate, finiteNumber(snapshot.swipes_today));
          seen += 1;
        }
        for (const day of dateList(window.fromDate, window.toDate)) {
          pending.push({
            workerId: worker.id,
            ingestionRunId: run.id,
            source: 'sales_dwh',
            sourceKey: `swipes:${worker.zohoUserId}:${day}`,
            metricKey: 'card_swipes',
            occurredAt: stableDayTimestamp(day),
            reportingDate: day,
            numericValue: totals.get(day) ?? 0,
            dimensions: { attribution: 'zoho_user_and_agent_name' },
          });
        }
      } catch {
        unavailable += 1;
      }
    }
    const batch = await kpiExternalFactRepo.appendBatch(ctx, pending);
    written += batch.inserted;
    batch.reportingDates.forEach((day) => dates.add(day));
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: unresolved > 0 || unavailable > 0 ? 'partial' : 'completed',
      recordsSeen: seen,
      recordsWritten: written,
      unresolvedMappings: unresolved,
      error:
        unavailable > 0
          ? `${unavailable} worker dashboard read(s) unavailable`
          : null,
    });
    return { written, dates: Array.from(dates), unresolved, unavailable };
  } catch (error) {
    await kpiRepo.finishIngestion(ctx, run.id, {
      status: 'failed',
      recordsSeen: seen,
      recordsWritten: written,
      unresolvedMappings: unresolved,
      error: errorMessage(error),
    });
    throw error;
  }
}

export async function runSalesKpiSync(
  ctx: TenantContext,
  options: KpiSyncOptions,
): Promise<KpiSyncSummary> {
  if (!env.FF_KPI_COLLECTION_ENABLED) {
    return {
      workers: 0,
      calls: 0,
      applications: 0,
      swipeDays: 0,
      unresolvedOwners: 0,
      partialSources: ['collection_disabled'],
      affectedDates: [],
    };
  }
  const window = sourceWindow(options);
  const workers = await syncKpiWorkerDirectory(
    ctx,
    options.mode === 'backfill' ? window.start : undefined,
  );
  const partialSources: string[] = [];
  let calls = { written: 0, unresolved: 0, dates: [] as string[], partial: false };
  let applications = { written: 0, unresolved: 0, dates: [] as string[], partial: false };
  let swipes = {
    written: 0,
    dates: [] as string[],
    unresolved: 0,
    unavailable: 0,
  };
  try {
    calls = await collectZohoCalls(ctx, workers, window, options.mode);
    if (calls.partial) partialSources.push('zoho_calls');
  } catch {
    partialSources.push('zoho_calls');
  }
  try {
    applications = await collectApplications(ctx, workers, window, options.mode);
    if (applications.partial) partialSources.push('zoho_applications');
  } catch {
    partialSources.push('zoho_applications');
  }
  try {
    swipes = await collectSwipes(ctx, workers, window, options.mode);
    if (swipes.unresolved > 0 || swipes.unavailable > 0) {
      partialSources.push('sales_dwh');
    }
  } catch {
    partialSources.push('sales_dwh');
  }
  return {
    workers: workers.length,
    calls: calls.written,
    applications: applications.written,
    swipeDays: swipes.written,
    unresolvedOwners: calls.unresolved + applications.unresolved + swipes.unresolved,
    partialSources,
    affectedDates: Array.from(
      new Set([...calls.dates, ...applications.dates, ...swipes.dates]),
    ).sort(),
  };
}
