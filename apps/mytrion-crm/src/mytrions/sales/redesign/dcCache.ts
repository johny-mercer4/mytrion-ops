/**
 * Data Center client-side cache (stale-while-revalidate). Keeps the last-loaded Clients / Leads /
 * Deals / Rejections in a module-level store keyed per view (+ acted-as agent), so switching sub-tabs
 * or re-entering the Data Center paints INSTANTLY from cache while a background refetch reconciles.
 *
 * Two notification kinds keep it loop-free:
 *  - a successful fetch calls `writeDcCache` → subscribers ADOPT the new value (no refetch);
 *  - an edit calls `invalidateDcCache(prefix)` → subscribers REFETCH (data stays visible meanwhile).
 *
 * This is intentionally tiny and dependency-free (no react-query): the Data Center only needs a
 * handful of long-lived keys, and SWR here means refreshes/tab-switches never show a blank loader.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

type NotifyKind = 'write' | 'invalidate';
type Listener = (kind: NotifyKind) => void;

interface Entry<T> {
  data: T;
  /** epoch ms the value was fetched — drives "Updated Xs ago" + staleness. */
  ts: number;
}

const store = new Map<string, Entry<unknown>>();
const listeners = new Map<string, Set<Listener>>();

function notify(key: string, kind: NotifyKind): void {
  const set = listeners.get(key);
  if (set) for (const fn of [...set]) fn(kind);
}

export function readDcCache<T>(key: string): Entry<T> | null {
  return (store.get(key) as Entry<T> | undefined) ?? null;
}

/** Subscribe to write/invalidate for one key (Tickets feed SWR, etc.). */
export function subscribeDcCache(key: string, fn: Listener): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(fn);
  return () => {
    const cur = listeners.get(key);
    if (!cur) return;
    cur.delete(fn);
    if (cur.size === 0) listeners.delete(key);
  };
}

/** Store a freshly-fetched value and tell every mounted hook on this key to adopt it. */
export function writeDcCache<T>(key: string, data: T): number {
  const ts = Date.now();
  store.set(key, { data, ts });
  notify(key, 'write');
  return ts;
}

/**
 * Drop every cached entry whose key starts with `prefix` and wake their subscribers to refetch.
 * Called after an inline edit (`invalidateDcCache('sales:leads')`) so the list reflects the change
 * immediately without the caller needing a handle on the loader.
 */
export function invalidateDcCache(prefix: string): void {
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) store.delete(key);
  }
  for (const key of [...listeners.keys()]) {
    if (key.startsWith(prefix)) notify(key, 'invalidate');
  }
}

/** "just now" / "12s ago" / "4m ago" / "2h ago" for the Refresh caption. */
export function formatCachedAt(ts: number | null): string {
  if (!ts) return '';
  const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (secs < 5) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  return `${h}h ago`;
}

export interface CachedLoad<T> {
  data: T | null;
  /** True only when there is NOTHING to show yet (first load, cold cache). */
  loading: boolean;
  /** Background refetch in progress while cached data is already on screen. */
  revalidating: boolean;
  error: string | null;
  /** Force a background revalidation (the Refresh button). */
  reload: () => void;
  /** epoch ms of the shown data (null when none). */
  cachedAt: number | null;
}

/**
 * Stale-while-revalidate loader. Paints cached data instantly, then revalidates in the background
 * when the cache is older than `staleMs` (or on `reload()` / `invalidateDcCache`). A refetch never
 * clears the visible data, so refreshes don't flash a spinner.
 *
 * `enabled:false` (a lazy sub-tab that isn't open) skips fetching but still adopts cache, so opening
 * the tab is instant if it was loaded before.
 */
export function useCachedLoad<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { enabled?: boolean; staleMs?: number } = {},
): CachedLoad<T> {
  const enabled = opts.enabled !== false;
  const staleMs = opts.staleMs ?? 60_000;
  const initial = readDcCache<T>(key);
  const [data, setData] = useState<T | null>(initial?.data ?? null);
  const [cachedAt, setCachedAt] = useState<number | null>(initial?.ts ?? null);
  const [loading, setLoading] = useState<boolean>(enabled && !initial);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);

  const run = useCallback(
    async (force: boolean): Promise<void> => {
      if (!enabled) return;
      const hit = readDcCache<T>(key);
      if (hit) {
        setData(hit.data);
        setCachedAt(hit.ts);
      }
      const fresh = hit != null && Date.now() - hit.ts < staleMs;
      if (fresh && !force) {
        setLoading(false);
        return;
      }
      if (hit) setRevalidating(true);
      else setLoading(true);
      setError(null);
      try {
        const d = await fnRef.current();
        if (!alive.current) return;
        const ts = writeDcCache(key, d);
        setData(d);
        setCachedAt(ts);
      } catch (e) {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (alive.current) {
          setLoading(false);
          setRevalidating(false);
        }
      }
    },
    [key, enabled, staleMs],
  );

  // Initial load + reload on key/enabled change.
  useEffect(() => {
    alive.current = true;
    void run(false);
    return () => {
      alive.current = false;
    };
  }, [run]);

  // Subscribe to writes (adopt) + invalidations (refetch) for this key.
  useEffect(() => {
    if (!enabled) return undefined;
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    const onNotify: Listener = (kind) => {
      if (kind === 'invalidate') {
        void run(true);
      } else {
        const hit = readDcCache<T>(key);
        if (hit) {
          setData(hit.data);
          setCachedAt(hit.ts);
        }
      }
    };
    set.add(onNotify);
    return () => {
      const cur = listeners.get(key);
      if (!cur) return;
      cur.delete(onNotify);
      if (cur.size === 0) listeners.delete(key);
    };
  }, [key, enabled, run]);

  const reload = useCallback(() => {
    void run(true);
  }, [run]);

  return { data, loading, revalidating, error, reload, cachedAt };
}
