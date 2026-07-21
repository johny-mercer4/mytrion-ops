/**
 * Module-level in-flight share + short TTL for read fetchers with several simultaneous
 * consumers (sidebar badge + Home preview + Inbox tab all load the inbox independently).
 * NOT SWR: within ttlMs callers get the cached value; concurrent callers join the same
 * promise; errors are never cached. `fresh` (the useLoad refresh flag) bypasses the TTL
 * but still joins an in-flight fetch.
 */
const inflight = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; ts: number }>();

export function dedupedFetch<T>(
  key: string,
  fn: () => Promise<T>,
  opts: { ttlMs?: number; fresh?: boolean } = {},
): Promise<T> {
  const ttlMs = opts.ttlMs ?? 0;
  if (!opts.fresh && ttlMs > 0) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.ts < ttlMs) return Promise.resolve(hit.data as T);
  }
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = fn()
    .then((data) => {
      cache.set(key, { data, ts: Date.now() });
      return data;
    })
    .finally(() => {
      // Identity guard: an invalidate() during flight replaces/deletes the entry — only
      // remove it if it's still ours, so a newer fetch is never detached by an old one.
      if (inflight.get(key) === p) inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/**
 * Drop cached entries AND detach in-flight promises for keys starting with `prefix`, so the
 * next caller refetches (current awaiters still resolve with the old result).
 */
export function invalidateDeduped(prefix: string): void {
  for (const k of [...cache.keys()]) if (k.startsWith(prefix)) cache.delete(k);
  for (const k of [...inflight.keys()]) if (k.startsWith(prefix)) inflight.delete(k);
}
