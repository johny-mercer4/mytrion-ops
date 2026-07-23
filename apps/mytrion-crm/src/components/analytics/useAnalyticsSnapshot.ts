import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchAnalyticsSnapshot } from '@/api/analytics';
import { ANALYTICS, type AnalyticsBlock, type AnalyticsDimension } from '@/mytrions/analyst/data';

export interface AnalyticsLoaded {
  block: AnalyticsBlock;
  /** 'live' = warehouse snapshot; 'sample' = bundled fallback (backend unreachable). */
  source: 'live' | 'sample';
  computedAt?: string;
}

export interface UseAnalyticsSnapshotOptions {
  /** Active dimension to load — the main data-select param. */
  dimension: AnalyticsDimension;
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
  /** Current block for `dimension` (sample fallback until live loads). */
  current: AnalyticsLoaded;
  /** Force a fresh warehouse recompute for the active dimension. */
  refresh: () => Promise<void>;
  refreshing: boolean;
  /** True once we've attempted at least one load for this dimension. */
  hasAttempted: boolean;
}

const DEFAULT_POLL_MS = 5 * 60_000;

/**
 * Loads / caches analytics snapshots per dimension.
 *
 * Data is selected by params:
 *   useAnalyticsSnapshot({ dimension: 'transactions', fresh: true, pollMs: 0 })
 */
export function useAnalyticsSnapshot(opts: UseAnalyticsSnapshotOptions): UseAnalyticsSnapshotResult {
  const { dimension, pollMs = DEFAULT_POLL_MS, enabled = true, fresh = false } = opts;
  const [loaded, setLoaded] = useState<Partial<Record<AnalyticsDimension, AnalyticsLoaded>>>({});
  const [refreshing, setRefreshing] = useState(false);
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  // Track the last (dimension, fresh) we loaded so a fresh=true param reloads once.
  const lastKeyRef = useRef<string>('');

  const load = useCallback(async (dim: AnalyticsDimension, forceFresh = false) => {
    try {
      const snap = await fetchAnalyticsSnapshot(dim, { fresh: forceFresh });
      setLoaded((prev) => ({
        ...prev,
        [dim]: { block: snap.block, source: 'live', computedAt: snap.computedAt },
      }));
    } catch {
      // Backend off / DWH unconfigured → keep (or fall back to) the bundled sample block.
      setLoaded((prev) =>
        prev[dim]?.source === 'live'
          ? prev
          : { ...prev, [dim]: { block: ANALYTICS[dim], source: 'sample' } },
      );
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const key = `${dimension}:${fresh ? '1' : '0'}`;
    const already = loadedRef.current[dimension] && lastKeyRef.current === key && !fresh;
    if (!already) {
      lastKeyRef.current = key;
      void load(dimension, fresh);
    }
    if (!pollMs || pollMs <= 0) return;
    const t = setInterval(() => void load(dimension, false), pollMs);
    return () => clearInterval(t);
  }, [dimension, load, pollMs, enabled, fresh]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load(dimension, true);
      lastKeyRef.current = `${dimension}:1`;
    } finally {
      setRefreshing(false);
    }
  }, [dimension, load]);

  const current: AnalyticsLoaded = loaded[dimension] ?? { block: ANALYTICS[dimension], source: 'sample' };

  return {
    current,
    refresh,
    refreshing,
    hasAttempted: Boolean(loaded[dimension]),
  };
}
