import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './transport';

vi.mock('./transport', async () => {
  const actual = await vi.importActual<typeof import('./transport')>('./transport');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from './transport';
import { beginZohoLogin, completeZohoCallbackIfPresent } from './auth';
import { getSession } from './session';

const STATE_KEY = 'octane.oauth.state';
const requestMock = vi.mocked(request);

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const impl = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: impl });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, value: { ...impl } });
  // sessionStorage must be a separate map
  const session = new Map<string, string>();
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => session.get(k) ?? null,
      setItem: (k: string, v: string) => void session.set(k, v),
      removeItem: (k: string) => void session.delete(k),
      clear: () => session.clear(),
    },
  });
  return store;
}

describe('Zoho OAuth state persistence', () => {
  beforeEach(() => {
    installStorage();
    requestMock.mockReset();
    window.history.replaceState(null, '', '/main');
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('writes OAuth state to sessionStorage and localStorage before redirecting', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    requestMock.mockResolvedValueOnce({
      authorizeUrl: 'https://accounts.zoho.com/oauth/v2/auth?state=abc',
      state: 'abc',
    });

    await beginZohoLogin();

    expect(sessionStorage.getItem(STATE_KEY)).toBe('abc');
    expect(localStorage.getItem(STATE_KEY)).toBe('abc');
    expect(assign).toHaveBeenCalledWith('https://accounts.zoho.com/oauth/v2/auth?state=abc');
    vi.unstubAllGlobals();
  });

  it('completes the callback from localStorage when sessionStorage was dropped', async () => {
    localStorage.setItem(STATE_KEY, 'signed-state');
    window.history.replaceState(null, '', '/main?code=one-time&state=signed-state');
    requestMock.mockResolvedValueOnce({
      accessToken: 'at',
      refreshToken: 'rt',
      worker: { zohoUserId: '1', userName: 'Ada', email: null, profile: null, role: null },
    });

    const ok = await completeZohoCallbackIfPresent();

    expect(ok).toBe(true);
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
    expect(getSession()?.worker.zohoUserId).toBe('1');
  });

  it('rejects a callback whose stashed state does not match', async () => {
    localStorage.setItem(STATE_KEY, 'expected');
    sessionStorage.setItem(STATE_KEY, 'expected');
    window.history.replaceState(null, '', '/main?code=one-time&state=other');

    await expect(completeZohoCallbackIfPresent()).rejects.toBeInstanceOf(ApiError);
    expect(requestMock).not.toHaveBeenCalled();
  });
});
