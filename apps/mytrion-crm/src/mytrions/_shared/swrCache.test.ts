/**
 * The shared SWR store.
 *
 * Worth locking down because fifteen call sites across Sales, Manager and now HR depend on it, and two
 * of its rules are the kind that break silently: a superseded response must never land in state (that is
 * how one agent's rows end up on screen under another agent's key), and the hook must keep working after
 * StrictMode's simulated unmount/remount.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  invalidateSwrCache,
  readSwrCache,
  useCachedLoad,
  writeSwrCache,
  formatCachedAt,
} from './swrCache';

/** Each test uses its own key prefix; the store is module-level and shared by design. */
let n = 0;
const uniq = (): string => `test:${(n += 1)}`;

beforeEach(() => {
  invalidateSwrCache('test:');
});

describe('store primitives', () => {
  it('reads back what it wrote, with a timestamp', () => {
    const k = uniq();
    const ts = writeSwrCache(k, { a: 1 });
    expect(readSwrCache<{ a: number }>(k)).toEqual({ data: { a: 1 }, ts });
  });

  it('invalidates by prefix and leaves other prefixes alone', () => {
    writeSwrCache('test:keep:1', 'x');
    writeSwrCache('other:1', 'y');
    invalidateSwrCache('test:keep');
    expect(readSwrCache('test:keep:1')).toBeNull();
    expect(readSwrCache('other:1')).not.toBeNull();
    invalidateSwrCache('other:');
  });

  it('formats a cached-at caption', () => {
    expect(formatCachedAt(null)).toBe('');
    expect(formatCachedAt(Date.now())).toBe('just now');
    expect(formatCachedAt(Date.now() - 90_000)).toBe('1m ago');
  });
});

describe('useCachedLoad', () => {
  it('fetches on a cold cache and reports loading only while there is nothing to show', async () => {
    const k = uniq();
    const fn = vi.fn(async () => 'value');
    const { result } = renderHook(() => useCachedLoad(k, fn));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.data).toBe('value'));
    expect(result.current.loading).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('paints instantly from a warm cache and does not refetch while fresh', async () => {
    const k = uniq();
    writeSwrCache(k, 'cached');
    const fn = vi.fn(async () => 'fetched');
    const { result } = renderHook(() => useCachedLoad(k, fn, { staleMs: 60_000 }));
    expect(result.current.data).toBe('cached');
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fn).not.toHaveBeenCalled();
  });

  it('revalidates a stale entry WITHOUT blanking the visible data', async () => {
    const k = uniq();
    writeSwrCache(k, 'old');
    const fn = vi.fn(async () => 'new');
    const { result } = renderHook(() => useCachedLoad(k, fn, { staleMs: -1 }));
    // The whole point of SWR here: the old value stays on screen while the refetch runs.
    expect(result.current.data).toBe('old');
    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.data).toBe('new'));
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does not fetch when disabled, but still adopts cache', async () => {
    const k = uniq();
    writeSwrCache(k, 'cached');
    const fn = vi.fn(async () => 'fetched');
    const { result } = renderHook(() => useCachedLoad(k, fn, { enabled: false }));
    expect(result.current.data).toBe('cached');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fn).not.toHaveBeenCalled();
  });

  it('surfaces a fetch error and keeps loading from getting stuck', async () => {
    const k = uniq();
    const fn = vi.fn(async () => {
      throw new Error('boom');
    });
    const { result } = renderHook(() => useCachedLoad(k, fn));
    await waitFor(() => expect(result.current.error).toBe('boom'));
    expect(result.current.loading).toBe(false);
  });

  it('CLEARS the previous key’s data when the key changes with a cold cache', async () => {
    const a = uniq();
    const b = uniq();
    writeSwrCache(a, 'A');
    const fn = vi.fn(async (key: string) => `fetched-${key}`);
    const { result, rerender } = renderHook(({ key }) => useCachedLoad(key, () => fn(key)), {
      initialProps: { key: a },
    });
    expect(result.current.data).toBe('A');

    rerender({ key: b });
    // The regression this guards: showing key A's value under key B while B loads.
    expect(result.current.data).toBeNull();
    await waitFor(() => expect(result.current.data).toBe(`fetched-${b}`));
  });

  it('IGNORES a superseded response — a slow first key cannot overwrite the second', async () => {
    const a = uniq();
    const b = uniq();
    let releaseA: (v: string) => void = () => {};
    const fn = vi.fn((key: string) =>
      key === a ? new Promise<string>((res) => (releaseA = res)) : Promise.resolve('B-value'),
    );

    const { result, rerender } = renderHook(({ key }) => useCachedLoad(key, () => fn(key)), {
      initialProps: { key: a },
    });
    // Switch keys while A is still in flight, then let A resolve LATE.
    rerender({ key: b });
    await waitFor(() => expect(result.current.data).toBe('B-value'));
    await act(async () => {
      releaseA('A-value-late');
    });
    expect(result.current.data).toBe('B-value');
    // A's result is still cached under A's own key — it was valid data, just for a different key.
    expect(readSwrCache<string>(a)?.data).toBe('A-value-late');
  });

  it('refetches every subscriber when its key is invalidated', async () => {
    const k = uniq();
    let value = 'first';
    const fn = vi.fn(async () => value);
    const { result } = renderHook(() => useCachedLoad(k, fn, { staleMs: 60_000 }));
    await waitFor(() => expect(result.current.data).toBe('first'));

    value = 'second';
    await act(async () => {
      invalidateSwrCache(k);
    });
    await waitFor(() => expect(result.current.data).toBe('second'));
  });

  it('adopts a value another component wrote for the same key', async () => {
    const k = uniq();
    const { result } = renderHook(() => useCachedLoad(k, async () => 'mine', { staleMs: 60_000 }));
    await waitFor(() => expect(result.current.data).toBe('mine'));
    await act(async () => {
      writeSwrCache(k, 'theirs');
    });
    expect(result.current.data).toBe('theirs');
  });

  it('reload() forces a refetch even when the entry is fresh', async () => {
    const k = uniq();
    let value = 'v1';
    const fn = vi.fn(async () => value);
    const { result } = renderHook(() => useCachedLoad(k, fn, { staleMs: 600_000 }));
    await waitFor(() => expect(result.current.data).toBe('v1'));
    expect(fn).toHaveBeenCalledTimes(1);

    value = 'v2';
    await act(async () => {
      result.current.reload();
    });
    await waitFor(() => expect(result.current.data).toBe('v2'));
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('still updates state after an unmount/remount cycle (StrictMode shape)', async () => {
    const k = uniq();
    const fn = vi.fn(async () => 'value');
    const { result, unmount } = renderHook(() => useCachedLoad(k, fn));
    await waitFor(() => expect(result.current.data).toBe('value'));
    unmount();

    // A fresh mount of the same hook must work — the regression here was a `mounted` ref that latched
    // false on the first teardown and was never set true again.
    invalidateSwrCache(k);
    const second = renderHook(() => useCachedLoad(k, fn));
    await waitFor(() => expect(second.result.current.data).toBe('value'));
    expect(second.result.current.loading).toBe(false);
  });
});
