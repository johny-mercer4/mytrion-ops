import { afterEach, describe, expect, it, vi } from 'vitest';
import { refreshBearer } from './transport';
import { jsonResponse } from '../test/sse';

const SESSION_KEY = 'octane.session.v1';

function seedSession(): void {
  localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ accessToken: 'old', refreshToken: 'r1', worker: { zohoUserId: '1' } }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('refreshBearer', () => {
  it('rotates the stored session on success', async () => {
    seedSession();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(200, { accessToken: 'new', refreshToken: 'r2' })));
    expect(await refreshBearer()).toBe(true);
    const stored = JSON.parse(localStorage.getItem(SESSION_KEY) ?? '{}') as Record<string, string>;
    expect(stored['accessToken']).toBe('new');
    expect(stored['refreshToken']).toBe('r2');
  });

  it('dedupes concurrent refreshes into one fetch', async () => {
    seedSession();
    const fetchMock = vi.fn(async () => jsonResponse(200, { accessToken: 'new', refreshToken: 'r2' }));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b, c] = await Promise.all([refreshBearer(), refreshBearer(), refreshBearer()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clears the session ONLY on a definitive auth rejection (401), not on 5xx or network', async () => {
    // 401 → cleared
    seedSession();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, {})));
    expect(await refreshBearer()).toBe(false);
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();

    // 503 → kept (deploy in progress must not log the worker out)
    seedSession();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(503, {})));
    expect(await refreshBearer()).toBe(false);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();

    // network failure → kept
    seedSession();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
    expect(await refreshBearer()).toBe(false);
    expect(localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });

  it('returns false with no stored session', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await refreshBearer()).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
