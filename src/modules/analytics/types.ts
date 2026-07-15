/**
 * Live analytics shapes — shared by the /v1/analytics route, the snapshot cache, and the
 * analytics.snapshot agent tool. Mirrors the web app's dashboard block shape so the frontend
 * renders a snapshot verbatim.
 */

export const ANALYTICS_DIMENSIONS = ['pipeline', 'transactions', 'billing'] as const;
export type AnalyticsDimension = (typeof ANALYTICS_DIMENSIONS)[number];

export function isAnalyticsDimension(value: string): value is AnalyticsDimension {
  return (ANALYTICS_DIMENSIONS as readonly string[]).includes(value);
}

export interface KpiStat {
  label: string;
  value: string;
  hint?: string;
  /** Trend pill: current vs prev; higherIsBetter decides good/bad colouring. */
  delta?: { prev: number; current: number; higherIsBetter: boolean };
}

export interface TrendPoint {
  label: string;
  value: number;
  /** Trailing in-progress day → rendered as a faded bar. */
  partial?: boolean;
}

export type BreakdownTone =
  | 'good'
  | 'warn'
  | 'bad'
  | 'info'
  | 'neutral'
  | 'purple'
  | 'sky'
  | 'teal'
  | 'amber';

export interface BreakdownItem {
  label: string;
  value: number;
  tone: BreakdownTone;
}

export interface LeaderboardRow {
  name: string;
  col1: number;
  col2: number | string;
  col3: number | string;
}

export interface AnalyticsBlock {
  label: string;
  caption: string;
  kpis: KpiStat[];
  trendLabel: string;
  trend: TrendPoint[];
  breakdownLabel: string;
  breakdown: BreakdownItem[];
  leaderboardLabel: string;
  leaderboardCols: [string, string, string];
  leaderboard: LeaderboardRow[];
}

export interface AnalyticsSnapshot {
  dimension: AnalyticsDimension;
  /** ISO timestamp of when the block was computed from the DWH. */
  computedAt: string;
  /** Cache policy the server applied (minutes). */
  ttlMinutes: number;
  block: AnalyticsBlock;
}
