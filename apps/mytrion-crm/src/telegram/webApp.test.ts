import { afterEach, describe, expect, it } from 'vitest';
import {
  applyTelegramInsets,
  bootTelegram,
  isTelegramWebView,
  type TelegramWebApp,
} from './webApp';

function mockWebApp(partial: Partial<TelegramWebApp>): TelegramWebApp {
  return {
    initData: '',
    ready: () => undefined,
    expand: () => undefined,
    ...partial,
  };
}

afterEach(() => {
  delete window.Telegram;
  delete window.TelegramWebviewProxy;
  delete document.documentElement.dataset.telegram;
  document.documentElement.style.removeProperty('--tg-inset-top');
  document.documentElement.style.removeProperty('--tg-inset-bottom');
});

describe('isTelegramWebView', () => {
  it('is false in a normal browser even if the SDK stub exists', () => {
    window.Telegram = { WebApp: mockWebApp({ initData: '', platform: 'unknown' }) };
    expect(isTelegramWebView()).toBe(false);
  });

  it('is true when Mini App initData is present', () => {
    window.Telegram = { WebApp: mockWebApp({ initData: 'query_id=1&user=%7B%7D' }) };
    expect(isTelegramWebView()).toBe(true);
  });

  it('is true when TelegramWebviewProxy exists', () => {
    window.TelegramWebviewProxy = {};
    expect(isTelegramWebView()).toBe(true);
  });
});

describe('applyTelegramInsets', () => {
  it('writes zero insets outside Telegram', () => {
    applyTelegramInsets(null);
    expect(document.documentElement.style.getPropertyValue('--tg-inset-top')).toBe('0px');
    expect(document.documentElement.style.getPropertyValue('--tg-inset-bottom')).toBe('0px');
  });

  it('sums safe-area and content-safe-area inside Telegram', () => {
    const wa = mockWebApp({
      initData: 'query_id=1',
      safeAreaInset: { top: 20, bottom: 10, left: 0, right: 0 },
      contentSafeAreaInset: { top: 24, bottom: 0, left: 0, right: 0 },
    });
    window.Telegram = { WebApp: wa };
    applyTelegramInsets(wa);
    expect(document.documentElement.style.getPropertyValue('--tg-inset-top')).toBe('44px');
    expect(document.documentElement.style.getPropertyValue('--tg-inset-bottom')).toBe('10px');
  });
});

describe('bootTelegram', () => {
  it('stamps data-telegram and expands when inside a Mini App', () => {
    let ready = false;
    let expanded = false;
    const wa = mockWebApp({
      initData: 'query_id=1',
      ready: () => {
        ready = true;
      },
      expand: () => {
        expanded = true;
      },
    });
    window.Telegram = { WebApp: wa };
    bootTelegram();
    expect(document.documentElement.dataset.telegram).toBe('true');
    expect(ready).toBe(true);
    expect(expanded).toBe(true);
  });

  it('does not stamp data-telegram in a normal browser', () => {
    window.Telegram = { WebApp: mockWebApp({ initData: '', platform: 'unknown' }) };
    bootTelegram();
    expect(document.documentElement.dataset.telegram).toBeUndefined();
  });
});
