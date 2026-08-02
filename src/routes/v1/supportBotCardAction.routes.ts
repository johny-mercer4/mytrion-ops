import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  requireSupportBotWrites,
  resolveSupportBotCaller,
  resolveSupportBotCardByLast6,
  supportBotCallerSchema,
  takeSupportBotWrite,
} from '../../modules/carrier/supportBotCaller.js';
import { telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import { supportBotOperationRepo } from '../../repos/supportBotOperationRepo.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { requireContext } from './helpers.js';
import { executeSupportBotWrite } from './supportBotOperation.js';

const cardActionSchema = supportBotCallerSchema.extend({
  cardLast6: z.string().trim().min(4).max(19),
  action: z.enum(['activate', 'deactivate']),
});

/** Session fencing plus owner card activation/deactivation. */
export async function supportBotCardActionRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { onRequest: [app.supportBotGatewayAuth] };

  app.post('/support-bot/session-fence', guard, async (request) => {
    if (!env.FF_SUPPORT_BOT_IDEMPOTENCY) {
      return { enabled: false, fencingToken: null };
    }
    const body = z
      .object({ sessionKeyHash: z.string().regex(/^[a-f0-9]{64}$/) })
      .parse(request.body);
    const fencingToken = await supportBotOperationRepo.issueFence(
      requireContext(request),
      body.sessionKeyHash,
    );
    return { enabled: true, fencingToken };
  });

  app.post('/support-bot/card-action', guard, async (request) => {
    requireSupportBotWrites();
    const body = cardActionSchema.parse(request.body);
    const ctx = requireContext(request);
    const { registration, role } = await resolveSupportBotCaller(
      ctx,
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'owner') {
      throw new AppError('Card activation is an owner action.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_OWNER_ONLY',
        expose: true,
      });
    }
    const cardNumber = await resolveSupportBotCardByLast6(
      body.carrierId,
      body.cardLast6,
    );

    const execution = await executeSupportBotWrite(request, {
      operationType: 'card_action',
      actorTelegramUserId: body.telegramUserId,
      carrierId: body.carrierId,
      validatedArguments: {
        carrierId: body.carrierId,
        telegramUserId: body.telegramUserId,
        cardLast6: cardNumber.slice(-6),
        action: body.action,
      },
      confirmationArguments: {
        telegram_user_id: body.telegramUserId,
        card_last6: body.cardLast6,
        action: body.action,
      },
      prepare: () => takeSupportBotWrite(body.carrierId),
      execute: async () => {
        const raw = await efsWrapper.setCardStatus(
          body.carrierId,
          cardNumber,
          body.action,
        );
        return {
          success: true,
          last6: cardNumber.slice(-6),
          action: body.action,
          raw,
        };
      },
      sanitize: (output) => ({
        success: output.success,
        last6: output.last6,
        action: output.action,
      }),
    });
    await auditFromContext(
      telegramCtx('owner', registration.telegramUserId),
      {
        action: execution.replayed
          ? 'carrier.support_bot.card_status_replay'
          : 'carrier.support_bot.card_status_change',
        status: 'ok',
        resourceType: 'efs_card',
        resourceId: cardNumber.slice(-6),
        detail: {
          carrierId: body.carrierId,
          action: body.action,
          via: 'support-bot',
          operationId: execution.operationId,
          replayed: execution.replayed,
        },
      },
    );
    return {
      ...execution.result,
      ...(execution.replayed ? { replayed: true } : {}),
    };
  });
}
