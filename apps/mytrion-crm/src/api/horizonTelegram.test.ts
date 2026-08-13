import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./transport', async () => {
  const actual = await vi.importActual<typeof import('./transport')>('./transport');
  return { ...actual, request: vi.fn() };
});

vi.mock('../telegram/webApp', () => ({
  isTelegramWebView: vi.fn(() => false),
  getTelegramInitData: vi.fn(() => null),
}));

vi.mock('./session', () => ({
  getSession: vi.fn(() => null),
}));

import { request } from './transport';
import { getTelegramInitData, isTelegramWebView } from '../telegram/webApp';
import { getSession } from './session';
import { bindHorizonTelegramAfterLogin, resetHorizonTelegramBind } from './horizonTelegram';

const requestMock = vi.mocked(request);
const isTelegram = vi.mocked(isTelegramWebView);
const initData = vi.mocked(getTelegramInitData);
const session = vi.mocked(getSession);

describe('bindHorizonTelegramAfterLogin', () => {
  beforeEach(() => {
    resetHorizonTelegramBind();
    requestMock.mockReset();
    isTelegram.mockReturnValue(false);
    initData.mockReturnValue(null);
    session.mockReturnValue(null);
    vi.useFakeTimers();
  });

  afterEach(() => {
    resetHorizonTelegramBind();
    vi.useRealTimers();
  });

  it('does not call the API outside Telegram', async () => {
    session.mockReturnValue({
      accessToken: 'at',
      refreshToken: 'rt',
      worker: { zohoUserId: '42', userName: 'Ada', email: null, profile: null, role: null },
    });
    await expect(bindHorizonTelegramAfterLogin()).resolves.toBe(false);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('POSTs initData with the Zoho bearer and without impersonation headers', async () => {
    isTelegram.mockReturnValue(true);
    initData.mockReturnValue('query_id=1&user=%7B%22id%22%3A99%7D');
    session.mockReturnValue({
      accessToken: 'at',
      refreshToken: 'rt',
      worker: { zohoUserId: '42', userName: 'Ada', email: null, profile: null, role: null },
    });
    requestMock.mockResolvedValueOnce({ ok: true });

    await expect(bindHorizonTelegramAfterLogin()).resolves.toBe(true);
    expect(requestMock).toHaveBeenCalledWith('POST', '/horizon/telegram/link', {
      body: { initData: 'query_id=1&user=%7B%22id%22%3A99%7D' },
      impersonate: false,
    });
  });

  it('does not throw when the bind fails, and retries later', async () => {
    isTelegram.mockReturnValue(true);
    initData.mockReturnValue('query_id=1');
    session.mockReturnValue({
      accessToken: 'at',
      refreshToken: 'rt',
      worker: { zohoUserId: '42', userName: 'Ada', email: null, profile: null, role: null },
    });
    requestMock.mockRejectedValueOnce(new Error('backend down'));
    requestMock.mockResolvedValueOnce({ ok: true });

    await expect(bindHorizonTelegramAfterLogin()).resolves.toBe(false);
    expect(requestMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it('shares an in-flight bind and skips a second POST after success', async () => {
    isTelegram.mockReturnValue(true);
    initData.mockReturnValue('query_id=1');
    session.mockReturnValue({
      accessToken: 'at',
      refreshToken: 'rt',
      worker: { zohoUserId: '42', userName: 'Ada', email: null, profile: null, role: null },
    });
    let resolveRequest: (value: unknown) => void = () => undefined;
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );

    const first = bindHorizonTelegramAfterLogin();
    const second = bindHorizonTelegramAfterLogin();
    expect(second).toBe(first);
    resolveRequest({ ok: true });
    await expect(first).resolves.toBe(true);
    await expect(bindHorizonTelegramAfterLogin()).resolves.toBe(true);
    expect(requestMock).toHaveBeenCalledTimes(1);
  });
});
