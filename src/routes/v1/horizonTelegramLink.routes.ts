/**
 * POST /horizon/telegram/link — bind Horizon Mini App Telegram identity after Zoho login.
 *
 * Auth is the Zoho Bearer session. initData is HMAC-verified with HORIZON_BOT_TOKEN and is not
 * a login. Never logs raw initData or the bot token.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  parseHorizonInitDataIdentity,
  verifyHorizonInitData,
} from '../../integrations/telegramHorizonBot.js';
import { AppError, AuthError, RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { horizonWorkerTelegramRepo } from '../../repos/horizonWorkerTelegramRepo.js';
import { requireContext } from './helpers.js';

const linkBodySchema = z.object({
  initData: z.string().min(1).max(8_192),
});

function zohoUserIdFromSession(request: FastifyRequest): string {
  const ctx = requireContext(request);
  if (ctx.audience !== 'internal') {
    throw new RBACError('Horizon Telegram link is internal-only');
  }
  if (!ctx.sessionVerified || !ctx.userId.startsWith('zoho:')) {
    throw new RBACError('Only Zoho-signed-in workers can link Telegram');
  }
  return ctx.userId.slice('zoho:'.length);
}

export async function horizonTelegramLinkRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/horizon/telegram/link',
    { onRequest: [app.authenticate] },
    async (request) => {
      if (!env.HORIZON_BOT_TOKEN) {
        throw new AppError('Horizon bot is not configured', {
          statusCode: 503,
          code: 'HORIZON_BOT_UNCONFIGURED',
        });
      }

      const zohoUserId = zohoUserIdFromSession(request);
      const ctx = requireContext(request);
      const { initData } = linkBodySchema.parse(request.body ?? {});

      const verified = verifyHorizonInitData(initData);
      if (!verified.ok) {
        throw new AuthError('Could not verify Telegram Mini App identity', {
          code: 'HORIZON_INITDATA_INVALID',
        });
      }

      const identity = parseHorizonInitDataIdentity(verified.fields);
      if (!identity) {
        throw new ValidationError('Verified Telegram payload is missing a user id', {
          code: 'HORIZON_INITDATA_USER_MISSING',
        });
      }

      const row = await horizonWorkerTelegramRepo.upsertWebAppBind(ctx, {
        zohoUserId,
        telegramUserId: identity.telegramUserId,
        telegramChatId: identity.telegramChatId,
        telegramUsername: identity.telegramUsername,
        zohoUsername: ctx.userName ?? null,
        zohoEmail: ctx.email ?? null,
      });

      await auditFromContext(ctx, {
        action: 'horizon.telegram.link',
        status: 'ok',
        resourceType: 'horizon_worker_telegram_link',
        resourceId: row.id,
        detail: {
          telegramUserId: row.telegramUserId,
          linkedVia: row.linkedVia,
        },
      });

      return {
        ok: true as const,
        linked: {
          zohoUserId: row.zohoUserId,
          telegramUserId: row.telegramUserId,
          telegramChatId: row.telegramChatId,
          telegramUsername: row.telegramUsername,
          linkedVia: row.linkedVia,
          status: row.status,
        },
      };
    },
  );
}
