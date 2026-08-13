/**
 * Horizon worker-CRM Telegram webhook — secret gate, /start open-prompt, isolation from the
 * client mini-app bot. Does not long-poll; does not read TELEGRAM_BOT_TOKEN.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendPrompt = vi.hoisted(() => vi.fn(async () => undefined));
const refreshLink = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../src/integrations/telegramHorizonBot.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/telegramHorizonBot.js')>();
  return { ...mod, sendHorizonOpenPrompt: sendPrompt, ensureHorizonWebhook: vi.fn(async () => undefined) };
});

vi.mock('../../src/repos/horizonWorkerTelegramRepo.js', () => ({
  horizonWorkerTelegramRepo: {
    refreshFromBotStart: refreshLink,
    upsertWebAppBind: vi.fn(),
    findByZohoUserId: vi.fn(),
    findByTelegramUserId: vi.fn(),
  },
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';

const SECRET = { 'x-telegram-bot-api-secret-token': 'horizon-test-secret' };

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  sendPrompt.mockClear();
  refreshLink.mockClear();
});

describe('POST /v1/telegram/horizon-webhook', () => {
  it('rejects a missing or wrong webhook secret', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      payload: { update_id: 1 },
    });
    expect(missing.statusCode).toBe(401);

    const wrong = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: { 'x-telegram-bot-api-secret-token': 'nope' },
      payload: { update_id: 1 },
    });
    expect(wrong.statusCode).toBe(401);
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('acks /start in a private chat, refreshes an existing link, and opens the Mini App', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: SECRET,
      payload: {
        update_id: 9,
        message: {
          message_id: 1,
          chat: { id: 42, type: 'private' },
          from: { id: 42, username: 'ada' },
          text: '/start',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith(42);
    expect(refreshLink).toHaveBeenCalledTimes(1);
    expect(refreshLink).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      { telegramUserId: '42', telegramChatId: '42', telegramUsername: 'ada' },
    );
  });

  it('does not mint a Zoho identity when /start has no existing Telegram link', async () => {
    refreshLink.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: SECRET,
      payload: {
        update_id: 12,
        message: {
          message_id: 4,
          chat: { id: 7, type: 'private' },
          from: { id: 7 },
          text: '/start',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(refreshLink).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledTimes(1);
  });

  it('acks non-start updates without sending or refreshing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: SECRET,
      payload: {
        update_id: 10,
        message: {
          message_id: 2,
          chat: { id: 42, type: 'private' },
          from: { id: 42, username: 'ada' },
          text: 'hello',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(refreshLink).not.toHaveBeenCalled();
  });

  it('ignores group chats so a Horizon bot added to a client group cannot reply', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: SECRET,
      payload: {
        update_id: 11,
        message: {
          message_id: 3,
          chat: { id: -100, type: 'supergroup' },
          from: { id: 9, username: 'ada' },
          text: '/start',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sendPrompt).not.toHaveBeenCalled();
    expect(refreshLink).not.toHaveBeenCalled();
  });
});
