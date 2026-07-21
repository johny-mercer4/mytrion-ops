/**
 * Tiny load hook shared by the Mytrion modules' live-data adapters (extracted from the
 * Sales redesign): loading/error/data + reload, with stale-data drop when the INPUTS
 * change (e.g. a View-as switch) so a previous subject's result can't outlive the switch.
 *
 * `reload()`  — refetch, keeping current data visible and NOT flipping `loading` (used on
 *               input changes; avoids chat/list flicker while reconciling).
 * `refresh()` — user-driven Refresh button: flips `refreshing` true for spinner/disabled
 *               feedback AND passes `fresh=true` to the fetch fn so cached endpoints can
 *               bypass their cache. `fn` receives that flag: `(fresh) => fetch(fresh)`;
 *               fns that don't need it simply ignore the argument.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  /** true only while a user-driven refresh() is in flight — drive the button spinner off this */
  refreshing: boolean;
  error: string | null;
  reload: () => void;
  refresh: () => void;
}

export function useLoad<T>(fn: (fresh: boolean) => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const freshRef = useRef(false);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const refresh = useCallback(() => {
    freshRef.current = true;
    setRefreshing(true);
    setTick((t) => t + 1);
  }, []);
  const depsKey = JSON.stringify(deps);
  const prevKey = useRef(depsKey);
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;
  useEffect(() => {
    let off = false;
    const isFresh = freshRef.current;
    // Drop stale data when the INPUTS change; a plain reload() keeps the old value visible
    // and does not flip `loading` (avoids chat/list flicker while reconciling).
    if (prevKey.current !== depsKey) {
      prevKey.current = depsKey;
      setData(null);
      dataRef.current = null;
      setLoading(true);
    } else {
      setLoading(dataRef.current === null);
    }
    setError(null);
    fn(isFresh)
      .then((d) => {
        if (off) return;
        dataRef.current = d;
        setData(d);
      })
      .catch((e: unknown) => !off && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => {
        if (off) return;
        setLoading(false);
        setRefreshing(false);
        freshRef.current = false;
      });
    return () => {
      off = true;
    };
    // eslint-disable-next-line
  }, [tick, depsKey]);
  return { data, loading, refreshing, error, reload, refresh };
}
