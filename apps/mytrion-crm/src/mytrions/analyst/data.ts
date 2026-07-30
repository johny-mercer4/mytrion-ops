/**
 * Analytics dashboard SHAPES only.
 *
 * The single data path is GET /v1/analytics/:dimension (warehouse-backed, ~2h snapshot cache) — see
 * api/analytics.ts and components/analytics/useAnalyticsSnapshot.ts. These interfaces mirror the
 * backend's modules/analytics/types.ts exactly, so a live snapshot renders verbatim.
 *
 * The bundled `ANALYTICS` fallback that used to live below was DELETED. It shipped invented KPIs, a
 * fabricated 14-day trend and a leaderboard of made-up agent names, and rendered whenever the
 * warehouse was unreachable — a dashboard that looked authoritative and was fiction. A failed fetch
 * now surfaces an error and no figures. Do not reintroduce seed data here.
 */

export interface KpiStat {
  label: string;
  value: string;
  hint?: string;
  /** Optional trend pill: compares `current` vs `prev`; `higherIsBetter` decides good/bad colour. */
  delta?: { prev: number; current: number; higherIsBetter: boolean };
}

export interface TrendPoint {
  label: string;
  value: number;
  /** The trailing day is in-progress → rendered as a faded bar. */
  partial?: boolean;
}

export interface BreakdownItem {
  label: string;
  value: number;
  tone: 'good' | 'warn' | 'bad' | 'info' | 'neutral' | 'purple' | 'sky' | 'teal' | 'amber';
}

export interface LeaderboardRow {
  name: string;
  col1: number;
  col2: number | string;
  col3: number | string;
}

export interface AnalyticsBlock {
  label: string;
  /** One-line context under the KPI row. */
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

export type AnalyticsDimension =
  | 'sales'
  | 'pipeline'
  | 'support'
  | 'transactions'
  | 'billing'
  | 'receivables';
