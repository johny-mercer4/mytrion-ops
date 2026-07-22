import type { AnalyticsDimension } from '@/mytrions/analyst/data';

/** Which sections of the dashboard to render. */
export type AnalyticsSection = 'kpis' | 'trend' | 'breakdown' | 'leaderboard';

const DIMENSIONS = new Set<AnalyticsDimension>(['pipeline', 'transactions', 'billing']);
const SECTIONS = new Set<AnalyticsSection>(['kpis', 'trend', 'breakdown', 'leaderboard']);

/**
 * Params that drive analytics data fetch + which UI blocks render.
 * Pass as a prop (`<AnalyticsDashboard params={…} />`) or via URL
 * (`/m/analyst?dimension=transactions&sections=kpis,trend&fresh=1`).
 */
export interface AnalyticsParams {
  /** Which warehouse snapshot to load. Default `pipeline`. */
  dimension?: AnalyticsDimension;
  /** UI blocks to render. Default = all. */
  sections?: AnalyticsSection[];
  /** Limit which dimension tabs appear. Default = all three. */
  dimensions?: AnalyticsDimension[];
  /** Bypass the ~2h snapshot cache on load / refresh. */
  fresh?: boolean;
  /** Poll interval ms; 0 = no poll. */
  pollMs?: number;
  /** Dashboard title override. */
  title?: string;
  showHeader?: boolean;
  showTabs?: boolean;
  showRefresh?: boolean;
}

function isDimension(v: string): v is AnalyticsDimension {
  return DIMENSIONS.has(v as AnalyticsDimension);
}

function isSection(v: string): v is AnalyticsSection {
  return SECTIONS.has(v as AnalyticsSection);
}

/** Parse dashboard params from a URL query string or URLSearchParams. */
export function parseAnalyticsParams(
  input: string | URLSearchParams | Record<string, string | undefined>,
): AnalyticsParams {
  const qs =
    typeof input === 'string'
      ? new URLSearchParams(input.startsWith('?') ? input.slice(1) : input)
      : input instanceof URLSearchParams
        ? input
        : new URLSearchParams(
            Object.entries(input).flatMap(([k, v]) => (v !== undefined ? [[k, v]] : [])),
          );

  const out: AnalyticsParams = {};

  const dim = qs.get('dimension')?.trim();
  if (dim && isDimension(dim)) out.dimension = dim;

  const sectionsRaw = qs.get('sections')?.trim();
  if (sectionsRaw) {
    const sections = sectionsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(isSection);
    if (sections.length > 0) out.sections = sections;
  }

  const dimensionsRaw = qs.get('dimensions')?.trim();
  if (dimensionsRaw) {
    const dimensions = dimensionsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(isDimension);
    if (dimensions.length > 0) out.dimensions = dimensions;
  }

  const fresh = qs.get('fresh')?.trim();
  if (fresh === '1' || fresh === 'true') out.fresh = true;
  if (fresh === '0' || fresh === 'false') out.fresh = false;

  const pollMs = qs.get('pollMs')?.trim();
  if (pollMs && /^\d+$/.test(pollMs)) out.pollMs = Number(pollMs);

  const title = qs.get('title')?.trim();
  if (title) out.title = title;

  for (const [key, flag] of [
    ['showHeader', 'showHeader'],
    ['showTabs', 'showTabs'],
    ['showRefresh', 'showRefresh'],
  ] as const) {
    const v = qs.get(key)?.trim();
    if (v === '0' || v === 'false') out[flag] = false;
    if (v === '1' || v === 'true') out[flag] = true;
  }

  return out;
}

/** Serialize analytics params to a query object (for URL sync). */
export function analyticsParamsToQuery(params: AnalyticsParams): Record<string, string> {
  const q: Record<string, string> = {};
  if (params.dimension) q.dimension = params.dimension;
  if (params.sections?.length) q.sections = params.sections.join(',');
  if (params.dimensions?.length) q.dimensions = params.dimensions.join(',');
  if (params.fresh === true) q.fresh = '1';
  if (params.fresh === false) q.fresh = '0';
  if (params.pollMs !== undefined) q.pollMs = String(params.pollMs);
  if (params.title) q.title = params.title;
  if (params.showHeader === false) q.showHeader = '0';
  if (params.showTabs === false) q.showTabs = '0';
  if (params.showRefresh === false) q.showRefresh = '0';
  return q;
}
