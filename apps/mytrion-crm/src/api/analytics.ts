/**
 * Live analytics snapshots (GET /v1/analytics/:dimension).
 * Unfiltered (org MTD): ~2h cache. Filtered (agent / date): ~5min cache + in-flight dedupe.
 * `fresh: true` forces a recompute (the dashboard's Refresh button).
 */
import { request } from './transport';
import type { AnalyticsBlock, AnalyticsDimension } from '../mytrions/analyst/data';

export interface AnalyticsSnapshot {
  dimension: AnalyticsDimension;
  /** ISO timestamp — when the block was computed from the warehouse. */
  computedAt: string;
  ttlMinutes: number;
  block: AnalyticsBlock;
}

export interface FetchAnalyticsOpts {
  fresh?: boolean;
  /** Zoho user id — scopes the snapshot to that agent's book. */
  agent?: string | null;
  agentName?: string | null;
  range?: 'today' | 'last_7_days' | 'this_month' | 'custom' | null;
  from?: string | null;
  to?: string | null;
}

export async function fetchAnalyticsSnapshot(
  dimension: AnalyticsDimension,
  opts: FetchAnalyticsOpts = {},
): Promise<AnalyticsSnapshot> {
  const query: Record<string, string> = {};
  if (opts.fresh) query.fresh = '1';
  if (opts.agent) query.agent = opts.agent;
  if (opts.agentName) query.agent_name = opts.agentName;
  if (opts.range) query.range = opts.range;
  if (opts.from) query.from = opts.from;
  if (opts.to) query.to = opts.to;

  return (await request('GET', `/analytics/${dimension}`, { query })) as AnalyticsSnapshot;
}

/** One column of a standing report — `type` drives the Excel number format. */
export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'money' | 'percent' | 'date';
  width?: number;
}

export interface ReportResult {
  reportId: string;
  title: string;
  sheet: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** The warehouse had more rows than the export cap — the sheet is partial. */
  truncated: boolean;
}

/**
 * Run a standing report for a date window. Returns rows as JSON; the .xlsx is written in the
 * browser (see mytrions/analyst/reportsExport.ts) so the API stays format-agnostic.
 */
export async function fetchAnalyticsReport(
  reportId: string,
  opts: FetchAnalyticsOpts = {},
): Promise<ReportResult> {
  const query: Record<string, string> = {};
  if (opts.agent) query.agent = opts.agent;
  if (opts.agentName) query.agent_name = opts.agentName;
  if (opts.range) query.range = opts.range;
  if (opts.from) query.from = opts.from;
  if (opts.to) query.to = opts.to;

  return (await request('GET', `/analytics/reports/${reportId}`, { query })) as ReportResult;
}
