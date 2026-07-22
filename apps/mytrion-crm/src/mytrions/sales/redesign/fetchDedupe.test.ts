import { describe, expect, it } from 'vitest';
import { dedupedFetch, invalidateDeduped } from './fetchDedupe';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('dedupedFetch', () => {
  it('shares one in-flight fetch and serves the TTL cache afterwards', async () => {
    let calls = 0;
    const d = deferred<string>();
    const fn = () => {
      calls += 1;
      return d.promise;
    };
    const key = 'share:a';
    const p1 = dedupedFetch(key, fn, { ttlMs: 60_000 });
    const p2 = dedupedFetch(key, fn, { ttlMs: 60_000 });
    d.resolve('v1');
    expect(await p1).toBe('v1');
    expect(await p2).toBe('v1');
    expect(await dedupedFetch(key, fn, { ttlMs: 60_000 })).toBe('v1'); // cache hit
    expect(calls).toBe(1);
  });

  it('fresh=true bypasses the TTL cache', async () => {
    const key = 'fresh:a';
    await dedupedFetch(key, async () => 'v1', { ttlMs: 60_000 });
    expect(await dedupedFetch(key, async () => 'v2', { ttlMs: 60_000, fresh: true })).toBe('v2');
  });

  it('errors are never cached — the next caller refetches', async () => {
    const key = 'err:a';
    await expect(dedupedFetch(key, async () => Promise.reject(new Error('boom')), { ttlMs: 60_000 })).rejects.toThrow('boom');
    expect(await dedupedFetch(key, async () => 'ok', { ttlMs: 60_000 })).toBe('ok');
  });

  it('a fetch detached by invalidateDeduped must NOT re-cache its stale payload (delete-race)', async () => {
    const key = 'inbox:race';
    const stale = deferred<string[]>();
    // Fetch F starts with the pre-delete list in flight.
    const f = dedupedFetch(key, () => stale.promise, { ttlMs: 30_000 });
    // The user deletes a row; the delete handler invalidates mid-flight.
    invalidateDeduped('inbox:');
    // F resolves late with the pre-delete list.
    stale.resolve(['M', 'other']);
    expect(await f).toEqual(['M', 'other']); // the original awaiter still gets its result
    // A post-invalidation consumer must REFETCH, not read F's resurrected payload.
    let refetched = false;
    const next = await dedupedFetch(
      key,
      async () => {
        refetched = true;
        return ['other'];
      },
      { ttlMs: 30_000 },
    );
    expect(refetched).toBe(true);
    expect(next).toEqual(['other']);
  });

  it('a late fetch never detaches a newer in-flight fetch for the same key', async () => {
    const key = 'inbox:late';
    const old = deferred<string>();
    const fOld = dedupedFetch(key, () => old.promise, { ttlMs: 30_000 });
    invalidateDeduped('inbox:');
    const fNew = deferred<string>();
    const started = dedupedFetch(key, () => fNew.promise, { ttlMs: 30_000 });
    old.resolve('stale');
    await fOld;
    // The old fetch resolving must not delete/poison the new in-flight entry: a third caller joins fNew.
    let extraCalls = 0;
    const joined = dedupedFetch(key, async () => {
      extraCalls += 1;
      return 'should-not-run';
    }, { ttlMs: 30_000 });
    fNew.resolve('fresh');
    expect(await started).toBe('fresh');
    expect(await joined).toBe('fresh');
    expect(extraCalls).toBe(0);
  });
});
