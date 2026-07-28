import type { FastifyInstance, FastifyRequest } from 'fastify';
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
import { supportBotRequestHash } from '../../modules/carrier/supportBotOperationIdentity.js';
import { executeSupportBotOperation } from '../../modules/carrier/supportBotOperationService.js';
import { telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import { supportBotOperationRepo } from '../../repos/supportBotOperationRepo.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { requireContext } from './helpers.js';

const cardActionSchema = supportBotCallerSchema.extend({
  cardLast6: z.string().trim().min(4).max(19),
  action: z.enum(['activate', 'deactivate']),
});

const operationHeadersSchema = z.object({
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  turnId: z.string().min(1).max(128),
  writeOccurrence: z.coerce.number().int().min(0).max(100),
  sessionKeyHash: z.string().regex(/^[a-f0-9]{64}$/),
  fencingToken: z.coerce.number().int().positive(),
});

function stringHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function operationHeaders(request: FastifyRequest) {
  return operationHeadersSchema.parse({
    idempotencyKey: stringHeader(request, 'idempotency-key'),
    turnId: stringHeader(request, 'x-support-bot-turn-id'),
    writeOccurrence: stringHeader(
      request,
      'x-support-bot-write-occurrence',
    ),
    sessionKeyHash: stringHeader(request, 'x-support-bot-session-key'),
    fencingToken: stringHeader(request, 'x-support-bot-fencing-token'),
  });
}

/** First idempotent support-bot write vertical slice. */
export async function supportBotCardActionRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

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

    if (!env.FF_SUPPORT_BOT_IDEMPOTENCY) {
      takeSupportBotWrite(body.carrierId);
      const raw = await efsWrapper.setCardStatus(
        body.carrierId,
        cardNumber,
        body.action,
      );
      await auditFromContext(
        telegramCtx('owner', registration.telegramUserId),
        {
          action: 'carrier.support_bot.card_status_change',
          status: 'ok',
          resourceType: 'efs_card',
          resourceId: cardNumber.slice(-6),
          detail: { carrierId: body.carrierId, action: body.action, via: 'support-bot' },
        },
      );
      return {
        success: true,
        last6: cardNumber.slice(-6),
        action: body.action,
        raw,
      };
    }

    const metadata = operationHeaders(request);
    const requestHash = supportBotRequestHash('card_action', {
      carrierId: body.carrierId,
      telegramUserId: body.telegramUserId,
      cardLast6: cardNumber.slice(-6),
      action: body.action,
    });
    const execution = await executeSupportBotOperation(ctx, {
      ...metadata,
      operationType: 'card_action',
      requestHash,
      actorTelegramUserId: body.telegramUserId,
      carrierId: body.carrierId,
      leaseExpiresAt: new Date(Date.now() + 2 * 60_000),
      execute: async () => {
        takeSupportBotWrite(body.carrierId);
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
