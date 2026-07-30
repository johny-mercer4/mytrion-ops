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
