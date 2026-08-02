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
});
