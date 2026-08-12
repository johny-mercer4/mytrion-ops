/**
 * Horizon worker-CRM Telegram bot webhook.
 *
 * POST /telegram/horizon-webhook — Telegram Bot API updates for HORIZON_BOT_TOKEN only.
 * Auth is `X-Telegram-Bot-Api-Secret-Token` = HORIZON_BOT_SECRET (not the client mini-app
 * token, not API_KEY). No getUpdates poller lives here.
 *
 * Identity inside the Mini App remains Zoho OAuth; this route only opens the app.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  isHorizonStartCommand,
  sendHorizonOpenPrompt,
  TELEGRAM_SECRET_HEADER,
  verifyHorizonWebhookSecret,
} from '../../integrations/telegramHorizonBot.js';
import { AppError, AuthError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

const updateSchema = z
  .object({
    update_id: z.number().optional(),
    message: z
      .object({
        message_id: z.number(),
        chat: z.object({
          id: z.number(),
          type: z.string().optional(),
        }),
        text: z.string().optional(),
      })
      .optional(),
  })
  .passthrough();

export async function horizonTelegramRoutes(app: FastifyInstance): Promise<void> {
  app.post('/telegram/horizon-webhook', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.HORIZON_BOT_TOKEN) {
      throw new AppError('Horizon bot is not configured', {
        statusCode: 503,
        code: 'HORIZON_BOT_UNCONFIGURED',
      });
    }
    if (!env.HORIZON_BOT_SECRET) {
      throw new AppError('Horizon webhook secret is not configured', {
        statusCode: 503,
        code: 'HORIZON_WEBHOOK_UNCONFIGURED',
      });
    }
    if (!verifyHorizonWebhookSecret(request.headers[TELEGRAM_SECRET_HEADER])) {
      throw new AuthError('Invalid or missing Horizon Telegram webhook secret');
    }

    const parsed = updateSchema.safeParse(request.body ?? {});
    const update = parsed.success ? parsed.data : {};
    const message = update.message;
    const chatType = message?.chat.type;
    if (message && (chatType === undefined || chatType === 'private') && isHorizonStartCommand(message.text)) {
      try {
        await sendHorizonOpenPrompt(message.chat.id);
      } catch (err) {
        logger.error({ err, chatId: message.chat.id }, 'Horizon /start reply failed');
      }
    }

    return reply.code(200).send({ ok: true });
  });
}
