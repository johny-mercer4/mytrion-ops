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

/** A transient network blip (dev-server restart, brief unreachability, Render cold start) surfaces
 *  as an ApiError with code 'NETWORK'. We retry those ONCE after this delay before surfacing them. */
const NETWORK_RETRY_MS = 700;

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
    const isNetworkErr = (e: unknown): boolean =>
      !!e && typeof e === 'object' && (e as { code?: string }).code === 'NETWORK';
    // Retry a transient NETWORK miss once before surfacing it, so a momentary drop (dev-server
    // restart, cold start) doesn't wipe the view. Real failures (4xx/5xx or a second miss) surface.
    void (async () => {
      try {
        let d: T;
        try {
          d = await fn(isFresh);
        } catch (e) {
          if (off || !isNetworkErr(e)) throw e;
          await new Promise((r) => setTimeout(r, NETWORK_RETRY_MS));
          if (off) return;
          d = await fn(isFresh);
        }
        if (off) return;
        dataRef.current = d;
        setData(d);
      } catch (e) {
        if (!off) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!off) {
          setLoading(false);
          setRefreshing(false);
          freshRef.current = false;
        }
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line
  }, [tick, depsKey]);
  return { data, loading, refreshing, error, reload, refresh };
}
