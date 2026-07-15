/**
 * Snapshot cache for the live analytics dashboard. Requests are served from memory (fast) and a
 * snapshot self-expires after ANALYTICS_CACHE_TTL_MINUTES (default 120 = "clears itself every
 * 2 hours"); the warmer recomputes on that same cadence so the cache is always warm. One compute
 * runs per dimension at a time (in-flight dedupe) so a stampede can't pile queries on the DWH.
 */
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { computeAnalyticsBlock } from './service.js';
import { ANALYTICS_DIMENSIONS, type AnalyticsDimension, type AnalyticsSnapshot } from './types.js';

interface CacheEntry {
  snapshot: AnalyticsSnapshot;
  expiresAt: number;
}

const cache = new Map<AnalyticsDimension, CacheEntry>();
const inFlight = new Map<AnalyticsDimension, Promise<AnalyticsSnapshot>>();
let warmTimer: NodeJS.Timeout | null = null;

function ttlMs(): number {
  return env.ANALYTICS_CACHE_TTL_MINUTES * 60_000;
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

/**
 * The one read path: cached snapshot when fresh, recompute when expired/missing.
 * `force` bypasses the cache (the dashboard's Refresh button).
 */
export async function getAnalyticsSnapshot(
  dimension: AnalyticsDimension,
  opts: { force?: boolean } = {},
): Promise<AnalyticsSnapshot> {
  const entry = cache.get(dimension);
  if (!opts.force && entry && entry.expiresAt > Date.now()) return entry.snapshot;
  return computeShared(dimension);
}

/** Recompute every dimension (warmer + boot warm-up). Failures log and never throw. */
export async function refreshAllAnalytics(): Promise<void> {
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
}
