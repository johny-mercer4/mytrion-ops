/**
 * Live analytics snapshots (GET /v1/analytics/:dimension). The backend serves these from a
 * ~2h snapshot cache over the warehouse, so a normal load is instant; `fresh: true` forces a
 * recompute (the dashboard's Refresh button).
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

export async function fetchAnalyticsSnapshot(
  dimension: AnalyticsDimension,
  opts: { fresh?: boolean } = {},
): Promise<AnalyticsSnapshot> {
  return (await request('GET', `/analytics/${dimension}`, {
    query: opts.fresh ? { fresh: '1' } : {},
  })) as AnalyticsSnapshot;
}
