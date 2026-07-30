/**
 * Shared building blocks for the per-dimension analytics computes.
 *
 * Extracted from service.ts when the dimension count outgrew the 600-line file cap: every
 * `dimensions/*.ts` module formats numbers, shapes trends and soft-fails queries the same way, so
 * the helpers live here once rather than being re-derived (and drifting) per dimension.
 */
import { logger } from '../../lib/logger.js';
import { filterCaption, normalizeFilters, type AnalyticsFilters } from './filters.js';
import type { TrendPoint } from './types.js';

export function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toLocaleString('en-US');
}

export function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

export function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

export const num = (v: unknown): number => (v == null ? 0 : Number(v));

export interface DayRow {
  day_label: string;
  value: string | number | null;
}

export function toTrend(rows: DayRow[]): TrendPoint[] {
  return rows.map((r, i) => ({
    label: r.day_label,
    value: num(r.value),
    ...(i === rows.length - 1 ? { partial: true } : {}),
  }));
}

export function withCte(cte: string, body: string): string {
  return cte ? `with ${cte}\n${body}` : body;
}

function hasAgentOrNonDefaultDate(f: AnalyticsFilters): boolean {
  return Boolean(f.agentId || f.agentName || f.range !== 'this_month' || f.from || f.to);
}

export function captionFor(base: string, filters: AnalyticsFilters): string {
  const f = normalizeFilters(filters);
  return hasAgentOrNonDefaultDate(f) ? `${base} · ${filterCaption(f)}` : base;
}

/**
 * Soft-fail a query: log and return `fallback` so one slow/broken statement degrades a block to
 * partial data instead of blanking it. The DWH statement_timeout (30s) fires under dbt rebuild
 * locks, and a whole-block 502 reads to the user as "analytics is down".
 */
export async function softQuery<T>(
  label: string,
  run: () => Promise<T[]>,
  fallback: T[] = [],
): Promise<T[]> {
  try {
    return await run();
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : String(err), query: label },
      'analytics query failed — continuing with partial data',
    );
    return fallback;
  }
}
