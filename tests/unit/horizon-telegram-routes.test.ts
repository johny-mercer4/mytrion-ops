/**
 * Horizon worker-CRM Telegram webhook — secret gate, /start open-prompt, isolation from the
 * client mini-app bot. Does not long-poll; does not read TELEGRAM_BOT_TOKEN.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const sendPrompt = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../../src/integrations/telegramHorizonBot.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/telegramHorizonBot.js')>();
  return { ...mod, sendHorizonOpenPrompt: sendPrompt, ensureHorizonWebhook: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';

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

  it('acks /start in a private chat and asks the Horizon bot to open the Mini App', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: SECRET,
      payload: {
        update_id: 9,
        message: {
          message_id: 1,
          chat: { id: 42, type: 'private' },
          text: '/start',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendPrompt).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith(42);
  });

  it('acks non-start updates without sending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/telegram/horizon-webhook',
      headers: SECRET,
      payload: {
        update_id: 10,
        message: {
          message_id: 2,
          chat: { id: 42, type: 'private' },
          text: 'hello',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sendPrompt).not.toHaveBeenCalled();
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
          text: '/start',
        },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
