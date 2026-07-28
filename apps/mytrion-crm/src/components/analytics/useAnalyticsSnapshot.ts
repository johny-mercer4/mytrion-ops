import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAnalyticsSnapshot } from '@/api/analytics';
import type { AnalyticsBlock, AnalyticsDimension } from '@/mytrions/analyst/data';

/**
 * A loaded snapshot. `block` is null until the warehouse answers — there is NO bundled sample
 * fallback any more. Substituting invented KPIs, trends and a leaderboard of made-up agent names
 * for a failed fetch produced a dashboard that looked authoritative and was fiction; a failure now
 * surfaces as `error` and the UI shows nothing rather than something false.
 */
export interface AnalyticsLoaded {
  block: AnalyticsBlock | null;
  computedAt?: string;
  /** Set when the last fetch for this dimension failed. */
  error?: string;
}

export interface AnalyticsQueryFilters {
  agentId?: string | null;
  agentName?: string | null;
  range?: 'today' | 'last_7_days' | 'this_month' | 'custom' | null;
  from?: string | null;
  to?: string | null;
}

export interface UseAnalyticsSnapshotOptions {
  /** Active dimension to load — the main data-select param. */
  dimension: AnalyticsDimension;
  /** Agent + date window — forwarded to GET /v1/analytics/:dimension as DWH query params. */
  filters?: AnalyticsQueryFilters;
  /** Re-fetch cadence in ms. 0 / undefined = no poll. Default 5 minutes. */
  pollMs?: number;
  /** When false, skip fetching (useful for deferred mounts). Default true. */
  enabled?: boolean;
  /**
   * Bypass the snapshot cache on the next load (maps to `?fresh=1` on the API).
   * After a successful load the hook clears this so polls stay cache-friendly;
   * call `refresh()` to force again.
   */
  fresh?: boolean;
}

export interface UseAnalyticsSnapshotResult {
  /** Current block for the active dimension + filters. */
  current: AnalyticsLoaded;
  /** Force a fresh warehouse recompute for the active dimension + filters. */
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** True while the first (or a filter-change) load is in flight with no block yet. */
  loading: boolean;
  /** True once we've attempted at least one load for this key. */
  hasAttempted: boolean;
}

const DEFAULT_POLL_MS = 5 * 60_000;

function filterKey(filters?: AnalyticsQueryFilters): string {
  if (!filters) return '';
  return [
    filters.agentId ?? '',
    filters.agentName ?? '',
    filters.range ?? 'this_month',
    filters.from ?? '',
    filters.to ?? '',
  ].join('|');
}

/**
 * Loads analytics snapshots from the warehouse, keyed by dimension + filter params.
 */
export function useAnalyticsSnapshot(opts: UseAnalyticsSnapshotOptions): UseAnalyticsSnapshotResult {
  const { dimension, filters, pollMs = DEFAULT_POLL_MS, enabled = true, fresh = false } = opts;
  const fKey = filterKey(filters);
  const [loaded, setLoaded] = useState<Record<string, AnalyticsLoaded>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [inflight, setInflight] = useState(0);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const lastKeyRef = useRef<string>('');
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const seqRef = useRef(0);

  const cacheKey = `${dimension}::${fKey}`;

  const load = useCallback(async (dim: AnalyticsDimension, key: string, forceFresh = false) => {
    const f = filtersRef.current;
    const seq = ++seqRef.current;
    setInflight((n) => n + 1);
    try {
      const snap = await fetchAnalyticsSnapshot(dim, {
        fresh: forceFresh,
        ...(f?.agentId ? { agent: f.agentId } : {}),
        ...(f?.agentName ? { agentName: f.agentName } : {}),
        ...(f?.range ? { range: f.range } : {}),
        ...(f?.from ? { from: f.from } : {}),
        ...(f?.to ? { to: f.to } : {}),
      });
      // Ignore stale responses when the user changed filters mid-flight.
      if (seq !== seqRef.current) return;
      setLoaded((prev) => ({
        ...prev,
        [key]: { block: snap.block, computedAt: snap.computedAt },
      }));
    } catch (e) {
      if (seq !== seqRef.current) return;
      const message = e instanceof Error ? e.message : 'Analytics snapshot unavailable';
      setLoaded((prev) => ({
        ...prev,
        [key]: {
          block: prev[key]?.block ?? null,
          ...(prev[key]?.computedAt ? { computedAt: prev[key]!.computedAt } : {}),
          error: message,
        },
      }));
    } finally {
      setInflight((n) => Math.max(0, n - 1));
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${cacheKey}:${fresh ? '1' : '0'}`;
    const already = loadedRef.current[cacheKey] && lastKeyRef.current === key && !fresh;
    if (!already) {
      lastKeyRef.current = key;
      void load(dimension, cacheKey, fresh);
    }
    if (!pollMs || pollMs <= 0) return;
    const t = setInterval(() => void load(dimension, cacheKey, false), pollMs);
    return () => clearInterval(t);
  }, [dimension, cacheKey, load, pollMs, enabled, fresh]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(dimension, cacheKey, true);
      lastKeyRef.current = `${cacheKey}:1`;
    } finally {
      setRefreshing(false);
    }
  }, [dimension, cacheKey, load]);

  const current: AnalyticsLoaded = loaded[cacheKey] ?? { block: null };
  const loading = enabled && inflight > 0 && !current.block;

  return {
    current,
    refresh,
    refreshing,
    loading,
    hasAttempted: Boolean(loaded[cacheKey]),
  };
}
