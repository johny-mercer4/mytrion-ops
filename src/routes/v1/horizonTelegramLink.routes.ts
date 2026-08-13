/**
 * Horizon Mini App Telegram identity.
 *
 * POST /horizon/telegram/link — bind after Zoho login (HMAC initData, not a login).
 * GET  /horizon/telegram/links — Admin directory of linked workers.
 * POST /horizon/telegram/export-send is registered separately (multipart sendDocument).
 *
 * Never logs raw initData or the bot token.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import {
  parseHorizonInitDataIdentity,
  verifyHorizonInitData,
} from '../../integrations/telegramHorizonBot.js';
import { AppError, AuthError, RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { zohoUserIdFromContext } from '../../modules/horizon/telegramLink.js';
import { horizonWorkerTelegramRepo } from '../../repos/horizonWorkerTelegramRepo.js';
import { requireContext } from './helpers.js';

const linkBodySchema = z.object({
  initData: z.string().min(1).max(8_192),
});

function requireAdmin(request: Parameters<typeof requireContext>[0]) {
  const ctx = requireContext(request);
  if (ctx.audience !== 'internal') {
    throw new RBACError('Horizon Telegram directory is internal-only');
  }
  if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
    throw new RBACError('Admin access required to view Octane Telegram users');
  }
  return ctx;
}

function toDirectoryRow(row: {
  zohoUsername: string | null;
  zohoUserId: string;
  telegramUserId: string;
  telegramUsername: string | null;
  updatedAt: Date;
}) {
  return {
    userName: row.zohoUsername,
    zohoUserId: row.zohoUserId,
    telegramUserId: row.telegramUserId,
    telegramUsername: row.telegramUsername,
    lastLoginAt: row.updatedAt.toISOString(),
  };
}

export async function horizonTelegramLinkRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/horizon/telegram/links',
    { onRequest: [app.authenticate] },
    async (request) => {
      const ctx = requireAdmin(request);
      const rows = await horizonWorkerTelegramRepo.list(ctx);
      return { items: rows.map(toDirectoryRow) };
    },
  );

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

      const ctx = requireContext(request);
      const zohoUserId = zohoUserIdFromContext(ctx);
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
