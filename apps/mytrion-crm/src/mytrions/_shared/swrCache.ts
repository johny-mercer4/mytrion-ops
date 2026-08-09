/**
 * Shared client-side stale-while-revalidate store for every Mytrion module.
 *
 * This is the Data Center's cache, promoted out of `sales/redesign/dcCache.ts` unchanged — Manager's
 * cards and now HR were already importing it from there, so the file had outgrown its name and its
 * folder. `dcCache.ts` re-exports these symbols under their original `*DcCache` names, so the fifteen
 * existing call sites keep working and there is still exactly ONE store: keys are namespaced by
 * module (`sales:leads:…`, `hr:employees:…`), and a prefix invalidation only ever touches its own.
 *
 * Two notification kinds keep it loop-free:
 *  - a successful fetch calls `writeSwrCache` → subscribers ADOPT the new value (no refetch);
 *  - an edit calls `invalidateSwrCache(prefix)` → subscribers REFETCH (data stays visible meanwhile).
 *
 * Intentionally tiny and dependency-free. `@tanstack/react-query` sits unused in package.json; it is
 * not wired in anywhere and this is the reason — the app needs a handful of long-lived keys and one
 * rule (a refresh never blanks the screen), not a query framework.
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
const MAX_CACHE_ENTRIES = 240;

function pruneStore(): void {
  while (store.size > MAX_CACHE_ENTRIES) {
    const oldest = store.keys().next().value as string | undefined;
    if (!oldest) return;
    store.delete(oldest);
  }
}

/**
 * In-flight reads, keyed exactly like the store.
 *
 * The cache dedupes reads that are *finished*; nothing deduped reads that were still in the air, so
 * every concurrent consumer of one key fired its own request. Two ways that happened in practice:
 * React StrictMode mounts→unmounts→remounts each component in development, and the load effect ran
 * on both mounts while the first response was still pending; and two panels reading the same key at
 * once (a list and a card over the same summary) each fetched independently. Joining the promise in
 * flight collapses those to one request and one write.
 *
 * Forced runs — `reload()` and the refetch after `invalidateSwrCache` — deliberately do NOT join.
 * An invalidation means "what you have is wrong", and a request that departed before the save that
 * triggered it would answer with exactly the stale row the caller is trying to get rid of.
 */
const inflight = new Map<string, Promise<unknown>>();

function fetchDeduped<T>(key: string, fn: () => Promise<T>, force: boolean): Promise<T> {
  if (!force) {
    const running = inflight.get(key) as Promise<T> | undefined;
    if (running) return running;
  }
  const p = fn();
  inflight.set(key, p);
  // Settled either way, drop it — but only if a newer forced run has not already replaced it.
  const clear = (): void => {
    if (inflight.get(key) === p) inflight.delete(key);
  };
  void p.then(clear, clear);
  return p;
}

function notify(key: string, kind: NotifyKind): void {
  const set = listeners.get(key);
  if (set) for (const fn of [...set]) fn(kind);
}

export function readSwrCache<T>(key: string): Entry<T> | null {
  const hit = store.get(key) as Entry<T> | undefined;
  if (!hit) return null;
  // Map insertion order doubles as a tiny LRU without another dependency.
  store.delete(key);
  store.set(key, hit);
  return hit;
}

/** Subscribe to write/invalidate for one key (Tickets feed SWR, etc.). */
export function subscribeSwrCache(key: string, fn: Listener): () => void {
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
export function writeSwrCache<T>(key: string, data: T): number {
  const ts = Date.now();
  store.delete(key);
  store.set(key, { data, ts });
  pruneStore();
  notify(key, 'write');
  return ts;
}

/**
 * Drop every cached entry whose key starts with `prefix` and wake their subscribers to refetch.
 * Called after an inline edit (`invalidateSwrCache('hr:employees')`) so the list reflects the change
 * immediately without the caller needing a handle on the loader.
 */
export function invalidateSwrCache(prefix: string): void {
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
 * when the cache is older than `staleMs` (or on `reload()` / `invalidateSwrCache`). A refetch never
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
  const initial = readSwrCache<T>(key);
  const [data, setData] = useState<T | null>(initial?.data ?? null);
  const [cachedAt, setCachedAt] = useState<number | null>(initial?.ts ?? null);
  const [loading, setLoading] = useState<boolean>(enabled && !initial);
  const [revalidating, setRevalidating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  /**
   * Monotonic run id. A response is applied to state only if it belongs to the LATEST run.
   *
   * This replaces an `alive` boolean ref that the mount effect set back to true on every run: on a key
   * change the cleanup set it false, the new effect immediately set it true again, and the previous key's
   * in-flight response then passed the liveness check and wrote itself into state — so switching agent /
   * search term / filter could leave the old subject's rows on screen under the new key. The cache write
   * was always keyed correctly; it was only the local state that took the wrong value.
   */
  const runId = useRef(0);
  const mounted = useRef(true);
  /**
   * Which key the value on screen belongs to, and whether there is one.
   *
   * Kept in refs because `run` cannot read `data`: it would have to join the dep array, and every
   * fetch would then rebuild the callback and refire the load effect.
   */
  const shownKey = useRef<string | null>(initial ? key : null);
  const hasData = useRef<boolean>(initial != null);
  useEffect(() => {
    // Set on the way IN as well as cleared on the way out. StrictMode mounts, unmounts and remounts the
    // same component instance, so the ref survives the simulated unmount — a cleanup-only effect would
    // latch `false` on the first teardown and this hook would never update state again in development.
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (force: boolean): Promise<void> => {
      if (!enabled) return;
      const mine = (runId.current += 1);
      const current = (): boolean => mounted.current && runId.current === mine;
      const hit = readSwrCache<T>(key);
      if (hit) {
        setData(hit.data);
        setCachedAt(hit.ts);
        hasData.current = true;
      } else if (shownKey.current === key && hasData.current) {
        // The SAME key with an empty cache: an invalidation just dropped the entry, which is how a save
        // or a delete asks for fresh data. What is on screen is still this key's own last-known-good, so
        // keep it and revalidate — clearing it turns every ordinary save into a full-page loader, and the
        // whole point of this hook is that a refetch never flashes one.
      } else {
        // A DIFFERENT key with no cache: drop the previous key's value rather than presenting it as this
        // key's result. Matches the sibling `useLoad`, which documents the same rule.
        setData(null);
        setCachedAt(null);
        hasData.current = false;
      }
      shownKey.current = key;
      const fresh = hit != null && Date.now() - hit.ts < staleMs;
      if (fresh && !force) {
        setLoading(false);
        return;
      }
      if (hit || hasData.current) setRevalidating(true);
      else setLoading(true);
      setError(null);
      try {
        const d = await fetchDeduped(key, fnRef.current, force);
        // The cache is written even for a superseded run — the data is valid for ITS key, and a later
        // reader of that key should get it rather than refetching.
        const ts = writeSwrCache(key, d);
        if (!current()) return;
        setData(d);
        setCachedAt(ts);
        hasData.current = true;
      } catch (e) {
        if (!current()) return;
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (current()) {
          setLoading(false);
          setRevalidating(false);
        }
      }
    },
    [key, enabled, staleMs],
  );

  // Initial load + reload on key/enabled change.
  useEffect(() => {
    void run(false);
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
        const hit = readSwrCache<T>(key);
        if (hit) {
          setData(hit.data);
          setCachedAt(hit.ts);
          shownKey.current = key;
          hasData.current = true;
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
