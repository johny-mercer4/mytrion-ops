import { describe, expect, it, vi } from 'vitest';
import { AsyncSWRCache } from '../../src/lib/asyncSWRCache.js';

describe('AsyncSWRCache', () => {
  it('coalesces concurrent loads and serves a fresh hit', async () => {
    const cache = new AsyncSWRCache();
    const loader = vi.fn(async () => ({ value: 1 }));
    const [first, second] = await Promise.all([
      cache.getOrLoad('a', loader, { ttlMs: 60_000 }),
      cache.getOrLoad('a', loader, { ttlMs: 60_000 }),
    ]);
    const third = await cache.getOrLoad('a', loader, { ttlMs: 60_000 });
    expect(first.data).toEqual({ value: 1 });
    expect(second.data).toEqual({ value: 1 });
    expect(third.freshness).toBe('fresh');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns stale data when revalidation fails inside the stale window', async () => {
    const cache = new AsyncSWRCache();
    await cache.getOrLoad('a', async () => 'cached', { ttlMs: 0 });
    const result = await cache.getOrLoad('a', async () => Promise.reject(new Error('offline')), {
      ttlMs: 0,
      staleIfErrorMs: 60_000,
      force: true,
    });
    expect(result.data).toBe('cached');
    expect(result.freshness).toBe('stale');
    expect(result.staleReason).toBe('offline');
  });

  it('invalidates by prefix', async () => {
    const cache = new AsyncSWRCache();
    const loader = vi.fn(async () => 'value');
    await cache.getOrLoad('sales:user:1', loader, { ttlMs: 60_000 });
    cache.invalidate('sales:user');
    await cache.getOrLoad('sales:user:1', loader, { ttlMs: 60_000 });
    expect(loader).toHaveBeenCalledTimes(2);
  });

  describe('peek', () => {
    it('returns the cached value without checking TTL or invoking a loader', async () => {
      const cache = new AsyncSWRCache();
      await cache.getOrLoad('a', async () => ({ n: 1 }), { ttlMs: 0 }); // already-expired TTL
      expect(cache.peek('a')).toEqual({ n: 1 });
    });

    it('returns the SAME object reference — mutating it in place is visible on the next getOrLoad', async () => {
      const cache = new AsyncSWRCache();
      const loader = vi.fn(async () => ({ rows: [{ id: '1', name: 'old' }] }));
      await cache.getOrLoad('a', loader, { ttlMs: 60_000 });
      const peeked = cache.peek<{ rows: Array<{ id: string; name: string }> }>('a');
      peeked!.rows[0]!.name = 'new';
      const after = await cache.getOrLoad('a', loader, { ttlMs: 60_000 });
      expect(after.data.rows[0]!.name).toBe('new');
      expect(loader).toHaveBeenCalledTimes(1); // still fresh — the patch didn't force a reload
    });

    it('returns undefined for a missing key', () => {
      const cache = new AsyncSWRCache();
      expect(cache.peek('missing')).toBeUndefined();
    });
  });
});
