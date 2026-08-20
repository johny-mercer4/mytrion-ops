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

export type MytrionUsageCoverageStatus = 'complete' | 'partial' | 'unavailable';
export type MytrionPresenceStatus = 'active' | 'idle' | 'offline';

export interface MytrionUsageCoverage {
  source: string;
  label: string;
  status: MytrionUsageCoverageStatus;
  availableFrom: string | null;
  availableThrough: string | null;
  note: string | null;
}

export interface MytrionUsageSummary {
  eligibleAgents: number;
  activeAgents: number | null;
  workspaceSessions: number | null;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  uiActions: number | null;
  workOutcomes: number | null;
}

export interface MytrionUsageDay {
  date: string;
  partial: boolean;
  activeAgents: number | null;
  workspaceSessions: number | null;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  uiActions: number | null;
  workOutcomes: number | null;
  aiTurns: number | null;
}

export interface SalesAgentUsageRow {
  /** Stable rendering key only. It is deliberately omitted from spreadsheet exports. */
  workerId: string;
  displayName: string;
  currentStatus: MytrionPresenceStatus | null;
  signIns: number | null;
  workspaceSessions: number | null;
  onlineSeconds: number | null;
  activeSeconds: number | null;
  activeDays: number | null;
  uiActions: number | null;
  workOutcomes: number | null;
  ticketCreates: number | null;
  escalationCreates: number | null;
  automationStarted: number | null;
  automationSucceeded: number | null;
  automationFailed: number | null;
  calls: number | null;
  talkSeconds: number | null;
  aiTurns: number | null;
  aiToolCalls: number | null;
  lastActivityAt: string | null;
}

export interface MytrionUsageBreakdownRow {
  key: string;
  label: string;
  count: number | null;
}

export interface MytrionUsageSnapshot {
  scope: { mytrion: 'sales'; population: 'sales_agent' };
  timeZone: string;
  range: {
    preset: NonNullable<FetchAnalyticsOpts['range']>;
    from: string;
    to: string;
  };
  computedAt: string;
  population: { eligibleAgents: number };
  coverage: MytrionUsageCoverage[];
  summary: MytrionUsageSummary;
  days: MytrionUsageDay[];
  agents: SalesAgentUsageRow[];
  breakdowns: {
    activity: MytrionUsageBreakdownRow[];
    workOutcomes: MytrionUsageBreakdownRow[];
    tickets: MytrionUsageBreakdownRow[];
    automations: MytrionUsageBreakdownRow[];
    ai: MytrionUsageBreakdownRow[];
  };
}

/** Internal Sales Mytrion usage, session-authenticated and server-RBAC gated. */
export async function fetchSalesMytrionUsage(
  opts: Pick<FetchAnalyticsOpts, 'fresh' | 'range' | 'from' | 'to'> = {},
): Promise<MytrionUsageSnapshot> {
  const query: Record<string, string> = {};
  if (opts.fresh) query.fresh = '1';
  if (opts.range) query.range = opts.range;
  if (opts.from) query.from = opts.from;
  if (opts.to) query.to = opts.to;
  return (await request('GET', '/analytics/mytrion/sales', {
    query,
    // This is a cross-agent management snapshot. A TopBar View-as selection must not re-scope it.
    impersonate: false,
  })) as MytrionUsageSnapshot;
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
