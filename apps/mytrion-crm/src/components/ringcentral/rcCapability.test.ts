import { afterEach, describe, expect, it } from 'vitest';
import { inAppCallingSupported } from './rcCapability';

afterEach(() => {
  delete window.Telegram;
  delete window.TelegramWebviewProxy;
});

describe('inAppCallingSupported', () => {
  it('is true in a normal browser', () => {
    expect(inAppCallingSupported()).toBe(true);
  });

  it('is false inside Telegram WebView', () => {
    window.Telegram = {
      WebApp: {
        initData: 'query_id=1',
        ready: () => undefined,
        expand: () => undefined,
      },
    };
    expect(inAppCallingSupported()).toBe(false);
  });
});
