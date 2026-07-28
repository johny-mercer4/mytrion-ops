/**
 * Snapshot cache for the live analytics dashboard.
 *
 * - Unfiltered (org-wide this_month): long TTL, warmer keeps it hot.
 * - Filtered (agent / date): short TTL + in-flight dedupe so switching filters / React Strict Mode
 *   double-fetches don't stampede the small shared DWH pool (max ~5). On compute failure, serve
 *   a still-fresh stale filtered entry when available.
 */
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  hasAnalyticsFilters,
  normalizeFilters,
  type AnalyticsFilters,
} from './filters.js';
import { computeAnalyticsBlock } from './service.js';
import { ANALYTICS_DIMENSIONS, type AnalyticsDimension, type AnalyticsSnapshot } from './types.js';

interface CacheEntry {
  snapshot: AnalyticsSnapshot;
  expiresAt: number;
}

/** Filtered views are interactive — keep them short so picks feel fresh without hammering DWH. */
const FILTERED_TTL_MS = 5 * 60_000;

const cache = new Map<AnalyticsDimension, CacheEntry>();
const inFlight = new Map<AnalyticsDimension, Promise<AnalyticsSnapshot>>();

const filteredCache = new Map<string, CacheEntry>();
const filteredInFlight = new Map<string, Promise<AnalyticsSnapshot>>();

let warmTimer: NodeJS.Timeout | null = null;

function ttlMs(): number {
  return env.ANALYTICS_CACHE_TTL_MINUTES * 60_000;
}

function filteredKey(dimension: AnalyticsDimension, filters: AnalyticsFilters): string {
  const f = normalizeFilters(filters);
  return [
    dimension,
    f.agentId ?? '',
    f.agentName ?? '',
    f.range ?? 'this_month',
    f.from ?? '',
    f.to ?? '',
  ].join('|');
}

async function compute(dimension: AnalyticsDimension): Promise<AnalyticsSnapshot> {
  const block = await computeAnalyticsBlock(dimension);
  const snapshot: AnalyticsSnapshot = {
    dimension,
    computedAt: new Date().toISOString(),
    ttlMinutes: env.ANALYTICS_CACHE_TTL_MINUTES,
    block,
  };
  cache.set(dimension, { snapshot, expiresAt: Date.now() + ttlMs() });
  return snapshot;
}

/** Compute with in-flight dedupe: concurrent callers share one DWH pass per dimension. */
function computeShared(dimension: AnalyticsDimension): Promise<AnalyticsSnapshot> {
  const running = inFlight.get(dimension);
  if (running) return running;
  const p = compute(dimension).finally(() => inFlight.delete(dimension));
  inFlight.set(dimension, p);
  return p;
}

async function computeFiltered(
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters,
  key: string,
): Promise<AnalyticsSnapshot> {
  const block = await computeAnalyticsBlock(dimension, filters);
  const snapshot: AnalyticsSnapshot = {
    dimension,
    computedAt: new Date().toISOString(),
    ttlMinutes: Math.round(FILTERED_TTL_MS / 60_000),
    block,
  };
  filteredCache.set(key, { snapshot, expiresAt: Date.now() + FILTERED_TTL_MS });
  return snapshot;
}

function computeFilteredShared(
  dimension: AnalyticsDimension,
  filters: AnalyticsFilters,
  key: string,
): Promise<AnalyticsSnapshot> {
  const running = filteredInFlight.get(key);
  if (running) return running;
  const p = computeFiltered(dimension, filters, key).finally(() => filteredInFlight.delete(key));
  filteredInFlight.set(key, p);
  return p;
}

/**
 * The one read path: cached snapshot when fresh, recompute when expired/missing.
 * `force` bypasses the cache (the dashboard's Refresh button).
 */
export async function getAnalyticsSnapshot(
  dimension: AnalyticsDimension,
  opts: { force?: boolean; filters?: AnalyticsFilters | null } = {},
): Promise<AnalyticsSnapshot> {
  const filters = normalizeFilters(opts.filters);

  if (hasAnalyticsFilters(filters)) {
    const key = filteredKey(dimension, filters);
    const entry = filteredCache.get(key);
    if (!opts.force && entry && entry.expiresAt > Date.now()) return entry.snapshot;

    try {
      return await computeFilteredShared(dimension, filters, key);
    } catch (err) {
      // Prefer a still-usable stale filtered snapshot over a blank 502 when DWH is flaky.
      if (entry) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), dimension, key },
          'analytics filtered recompute failed — serving stale filtered snapshot',
        );
        return entry.snapshot;
      }
      throw err;
    }
  }

  const entry = cache.get(dimension);
  if (!opts.force && entry && entry.expiresAt > Date.now()) return entry.snapshot;
  return computeShared(dimension);
}

/** Recompute every dimension (warmer + boot warm-up). Failures log and never throw. */
export async function refreshAllAnalytics(): Promise<void> {
  // Yield the tiny DWH pool to interactive filtered requests (UI filter changes).
  if (filteredInFlight.size > 0 || inFlight.size > 0) {
    logger.debug(
      { filteredInFlight: filteredInFlight.size, inFlight: inFlight.size },
      'analytics warmer skipped — interactive compute in flight',
    );
    return;
  }
  for (const dimension of ANALYTICS_DIMENSIONS) {
    try {
      await computeShared(dimension);
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : String(err), dimension }, 'analytics refresh failed');
    }
  }
}

/**
 * Start the self-refresh loop: warm now, then recompute on the TTL cadence so entries are
 * replaced right as they expire. No-op when the DWH isn't configured. Timer is unref'd — it
 * never holds the process open.
 */
export function startAnalyticsWarmer(): void {
  if (warmTimer || !env.DWH_DATABASE_URL) return;
  void refreshAllAnalytics();
  warmTimer = setInterval(() => void refreshAllAnalytics(), ttlMs());
  warmTimer.unref();
  logger.info({ ttlMinutes: env.ANALYTICS_CACHE_TTL_MINUTES }, 'analytics warmer started');
}

/** Stop the warmer and drop all snapshots (graceful shutdown / tests). */
export function resetAnalyticsCache(): void {
  if (warmTimer) {
    clearInterval(warmTimer);
    warmTimer = null;
  }
  cache.clear();
  inFlight.clear();
  filteredCache.clear();
  filteredInFlight.clear();
}
