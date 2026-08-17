import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import {
  buildHorizonOpenUrl,
  derivePublicHttpsUrl,
  horizonBotSharesClientToken,
  isHorizonStartCommand,
  resolveHorizonMiniAppUrl,
  resolveHorizonWebhookUrl,
  signHorizonInitData,
  verifyHorizonInitData,
  verifyHorizonWebhookSecret,
  parseHorizonInitDataIdentity,
  sendHorizonDocument,
  WEBHOOK_PATH,
} from '../../src/integrations/telegramHorizonBot.js';

describe('Horizon Telegram bot isolation', () => {
  it('uses HORIZON_BOT_TOKEN, not the client mini-app token, for initData HMAC', () => {
    expect(env.HORIZON_BOT_TOKEN).toBe('horizon-test-token');
    expect(env.HORIZON_BOT_TOKEN).not.toBe(env.TELEGRAM_BOT_TOKEN);
    expect(env.HORIZON_BOT_TOKEN).not.toBe(env.TELEGRAM_CARRIER_BOT_TOKEN);
    expect(horizonBotSharesClientToken()).toBe(false);
  });

  it('accepts a payload signed with the Horizon token and rejects a different bot token', () => {
    const fields = {
      auth_date: String(Math.floor(Date.now() / 1000)),
      query_id: 'AAE',
      user: JSON.stringify({ id: 1, first_name: 'Ada' }),
    };
    expect(verifyHorizonInitData(signHorizonInitData(fields)).ok).toBe(true);

    const params = new URLSearchParams(fields);
    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    const otherToken = env.TELEGRAM_CARRIER_BOT_TOKEN || env.TELEGRAM_BOT_TOKEN || 'other-bot-token';
    const secretKey = createHmac('sha256', 'WebAppData').update(otherToken).digest();
    params.set('hash', createHmac('sha256', secretKey).update(dataCheckString).digest('hex'));
    expect(verifyHorizonInitData(params.toString()).ok).toBe(false);
  });

  it('rejects stale initData even when the HMAC is valid', () => {
    const signed = signHorizonInitData({
      auth_date: String(Math.floor(Date.now() / 1000) - 10_000),
      user: JSON.stringify({ id: 1 }),
    });
    expect(verifyHorizonInitData(signed, 3600).ok).toBe(false);
  });

  it('parses user id, username, and private chat id from verified initData fields', () => {
    expect(
      parseHorizonInitDataIdentity({
        user: JSON.stringify({ id: 99, username: 'ada' }),
      }),
    ).toEqual({ telegramUserId: '99', telegramChatId: '99', telegramUsername: 'ada' });

    expect(
      parseHorizonInitDataIdentity({
        user: JSON.stringify({ id: 99, username: 'ada' }),
        chat: JSON.stringify({ id: -100, type: 'supergroup' }),
      }),
    ).toEqual({ telegramUserId: '99', telegramChatId: '-100', telegramUsername: 'ada' });

    expect(parseHorizonInitDataIdentity({ user: JSON.stringify({ first_name: 'Ada' }) })).toBeNull();
    expect(parseHorizonInitDataIdentity({})).toBeNull();
  });
});

describe('Horizon webhook secret', () => {
  it('accepts HORIZON_BOT_SECRET and rejects anything else', () => {
    expect(verifyHorizonWebhookSecret('horizon-test-secret')).toBe(true);
    expect(verifyHorizonWebhookSecret('wrong-secret')).toBe(false);
    expect(verifyHorizonWebhookSecret(undefined)).toBe(false);
    expect(verifyHorizonWebhookSecret(['horizon-test-secret'])).toBe(false);
  });
});

describe('Horizon URLs and /start', () => {
  it('resolves the Mini App to /main when HORIZON_MINI_APP_URL is set', () => {
    expect(resolveHorizonMiniAppUrl()).toBe('https://example.test/main');
    expect(resolveHorizonWebhookUrl()).toBe('');
    expect(WEBHOOK_PATH).toBe('/v1/telegram/horizon-webhook');
  });

  it('uses the HTTPS Mini App URL for the web_app button when no short name / Main App flag is set', () => {
    expect(buildHorizonOpenUrl()).toBe('https://example.test/main');
  });

  it('derives Render URLs from origin + suffix when explicit env is empty', () => {
    expect(derivePublicHttpsUrl('', 'https://ops.example.test/', '/main')).toBe(
      'https://ops.example.test/main',
    );
    expect(derivePublicHttpsUrl('', 'https://ops.example.test', WEBHOOK_PATH)).toBe(
      `https://ops.example.test${WEBHOOK_PATH}`,
    );
    expect(derivePublicHttpsUrl('https://explicit.test/main/', 'https://ops.example.test', '/main')).toBe(
      'https://explicit.test/main',
    );
    expect(derivePublicHttpsUrl('', '', '/main')).toBe('');
  });

  it('recognizes /start in private chat copy', () => {
    expect(isHorizonStartCommand('/start')).toBe(true);
    expect(isHorizonStartCommand('/start payload')).toBe(true);
    expect(isHorizonStartCommand('/start@horizon_test_bot')).toBe(true);
    expect(isHorizonStartCommand('/help')).toBe(false);
    expect(isHorizonStartCommand(undefined)).toBe(false);
  });
});

describe('sendHorizonDocument token isolation', () => {
  it('POSTs sendDocument with HORIZON_BOT_TOKEN, never the client bot tokens', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain(`/bot${env.HORIZON_BOT_TOKEN}/sendDocument`);
      expect(String(url)).not.toContain(`/bot${env.TELEGRAM_BOT_TOKEN}/sendDocument`);
      expect(String(url)).not.toContain(`/bot${env.TELEGRAM_CARRIER_BOT_TOKEN}/sendDocument`);
      return {
        json: async () => ({ ok: true }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      await sendHorizonDocument({
        chatId: '99',
        fileName: 'report.csv',
        contentType: 'text/csv',
        bytes: new Uint8Array([1, 2, 3]),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

