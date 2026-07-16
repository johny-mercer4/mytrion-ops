/**
 * Tiny load hook shared by the Mytrion modules' live-data adapters (extracted from the
 * Sales redesign): loading/error/data + reload, with stale-data drop when the INPUTS
 * change (e.g. a View-as switch) so a previous subject's result can't outlive the switch.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const depsKey = JSON.stringify(deps);
  const prevKey = useRef(depsKey);
  useEffect(() => {
    let off = false;
    // Drop stale data when the INPUTS change; a plain reload() keeps the old value visible.
    if (prevKey.current !== depsKey) {
      prevKey.current = depsKey;
      setData(null);
    }
    setLoading(true);
    setError(null);
    fn()
      .then((d) => !off && setData(d))
      .catch((e: unknown) => !off && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
    // eslint-disable-next-line
  }, [tick, depsKey]);
  return { data, loading, error, reload };
}
