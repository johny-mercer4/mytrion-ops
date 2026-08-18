import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fetchSalesMytrionUsage,
  type MytrionUsageSnapshot,
} from '@/api/analytics';

import type { DashboardFilterParams } from './categories';

interface LoadedUsage {
  snapshot: MytrionUsageSnapshot | null;
  error?: string;
}

export interface MytrionUsageSnapshotState {
  current: LoadedUsage;
  loading: boolean;
  refreshing: boolean;
  hasAttempted: boolean;
  refresh: () => Promise<void>;
}

function filterKey(filters: DashboardFilterParams): string {
  return [filters.range, filters.from ?? '', filters.to ?? ''].join('|');
}

/** Loads the local Sales usage snapshot while retaining the last good result on refresh failures. */
export function useMytrionUsageSnapshot(
  filters: DashboardFilterParams,
): MytrionUsageSnapshotState {
  const key = filterKey(filters);
  const [loaded, setLoaded] = useState<Record<string, LoadedUsage>>({});
  const [inflight, setInflight] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const filtersRef = useRef(filters);
  const seqRef = useRef(0);
  filtersRef.current = filters;

  const load = useCallback(async (loadKey: string, fresh = false): Promise<void> => {
    const currentFilters = filtersRef.current;
    const seq = ++seqRef.current;
    setInflight((count) => count + 1);
    try {
      const snapshot = await fetchSalesMytrionUsage({
        fresh,
        range: currentFilters.range,
        from: currentFilters.from,
        to: currentFilters.to,
      });
      if (seq !== seqRef.current) return;
      setLoaded((previous) => ({ ...previous, [loadKey]: { snapshot } }));
    } catch (cause) {
      if (seq !== seqRef.current) return;
      const error = cause instanceof Error ? cause.message : 'Mytrion usage is unavailable';
      setLoaded((previous) => ({
        ...previous,
        [loadKey]: { snapshot: previous[loadKey]?.snapshot ?? null, error },
      }));
    } finally {
      setInflight((count) => Math.max(0, count - 1));
    }
  }, []);

  useEffect(() => {
    void load(key);
    const timer = setInterval(() => void load(key), 5 * 60_000);
    return () => clearInterval(timer);
  }, [key, load]);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    try {
      await load(key, true);
    } finally {
      setRefreshing(false);
    }
  }, [key, load]);

  const current = loaded[key] ?? { snapshot: null };
  return {
    current,
    loading: inflight > 0 && !current.snapshot,
    refreshing,
    hasAttempted: Object.prototype.hasOwnProperty.call(loaded, key),
    refresh,
  };
}
