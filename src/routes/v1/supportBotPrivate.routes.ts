import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env, isProduction } from '../../config/env.js';
import { getCardEfsIdentity } from '../../integrations/dwhCards.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { requireDriverCardNumber, telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import {
  resolveSupportBotCaller,
  resolveSupportBotCardByLast6,
  sendSupportBotPrivate,
  supportBotCallerSchema,
} from '../../modules/carrier/supportBotCaller.js';
import { notifyMiniApp } from '../../modules/notifications/service.js';
import { takeToken } from '../../modules/security/rateBucket.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { requireContext } from './helpers.js';
import { executeSupportBotWrite } from './supportBotOperation.js';

function takeReadToken(carrierId: string): void {
  if (!takeToken(`support-bot-read:${carrierId}`, 30)) {
    throw new AppError('Too many requests right now — try again in a minute.', {
      statusCode: 429,
      code: 'SUPPORT_BOT_RATE_LIMITED',
      expose: true,
    });
  }
}

/** Sensitive values that are delivered only to the verified asker's private bot chat. */
export async function supportBotPrivateRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { onRequest: [app.supportBotGatewayAuth] };

  app.post('/support-bot/balance', guard, async (request) => {
    const body = supportBotCallerSchema.parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'owner') {
      throw new AppError('Balance figures are for the account owner.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_OWNER_ONLY',
        expose: true,
      });
    }
    takeReadToken(body.carrierId);
    const balance = await serverCrmWrapper.getCarrierBalance(body.carrierId);
    const formatMoney = (value: unknown): string =>
      typeof value === 'number'
        ? `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
        : '—';
    await sendSupportBotPrivate(
      registration,
      [
        `💰 ${registration.companyName ?? 'Octane'} balance`,
        `EFS balance: ${formatMoney(balance.efs_balance)}`,
        ...(balance['credit_remaining'] != null
          ? [`Credit remaining: ${formatMoney(balance['credit_remaining'])}`]
          : []),
        ...(balance.efs_error
          ? ['⚠ EFS live read failed — figures may be stale']
          : []),
      ].join('\n'),
    );
    return { success: true, deliveredTo: 'private_bot_chat' };
  });

  app.post('/support-bot/manual-code', guard, async (request) => {
    const body = supportBotCallerSchema
      .extend({
        cardLast6: z.string().trim().min(4).max(19).optional(),
      })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    takeReadToken(body.carrierId);
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration)
        : await resolveSupportBotCardByLast6(
            body.carrierId,
            body.cardLast6 ?? '',
          );
    await sendSupportBotPrivate(
      registration,
      `🔑 Manual entry code (card •••• ${cardNumber.slice(-6)}):\n${cardNumber}`,
    );
    await auditFromContext(
      telegramCtx(registration.profile, registration.telegramUserId),
      {
        action: 'carrier.support_bot.manual_code',
        status: 'ok',
        resourceType: 'efs_card',
        resourceId: cardNumber.slice(-6),
        detail: {
          carrierId: body.carrierId,
          role,
          via: 'support-bot',
        },
      },
    );
    return {
      success: true,
      deliveredTo: 'private_bot_chat',
      last6: cardNumber.slice(-6),
    };
  });

  app.post('/support-bot/override', guard, async (request) => {
    if (!env.FF_MINIAPP_CARD_WRITES_ENABLED) {
      throw new AppError('Card actions are not enabled yet.', {
        statusCode: 503,
        code: 'MINIAPP_WRITES_DISABLED',
        expose: true,
      });
    }
    const body = supportBotCallerSchema
      .extend({ requestId: z.string().min(1).max(128) })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'driver') {
      throw new AppError(
        'Owners pick a card in the mini-app — open Card management there.',
        {
          statusCode: 403,
          code: 'SUPPORT_BOT_DRIVER_ONLY',
          expose: true,
        },
      );
    }
    const cardNumber = await requireDriverCardNumber(registration);
    const ctx = telegramCtx('driver', registration.telegramUserId);
    const mock = !isProduction && env.FF_DEV_MOCK_TELEGRAM_ENABLED;
    if (!mock) {
      await efsWrapper.assertCardFraudHeld(body.carrierId, cardNumber);
    }
    const execution = await executeSupportBotWrite(request, {
      operationType: 'override',
      actorTelegramUserId: body.telegramUserId,
      carrierId: body.carrierId,
      validatedArguments: {
        carrierId: body.carrierId,
        telegramUserId: body.telegramUserId,
        requestId: body.requestId,
        cardLast6: cardNumber.slice(-6),
      },
      confirmationArguments: {
        telegram_user_id: body.telegramUserId,
      },
      prepare: () => {
        if (!takeToken(`support-bot-write:${body.carrierId}`, 5)) {
          throw new AppError('Too many card actions right now — try again in a minute.', {
            statusCode: 429,
            code: 'SUPPORT_BOT_RATE_LIMITED',
            expose: true,
          });
        }
      },
      execute: async () => {
        if (!mock) await efsWrapper.overrideCard(body.carrierId, cardNumber);
        return { success: true, last6: cardNumber.slice(-6), minutes: 30 };
      },
      sanitize: (output) => output,
    });
    await auditFromContext(ctx, {
      action: execution.replayed
        ? 'carrier.support_bot.card_override_replay'
        : 'carrier.support_bot.card_override',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: registration.cardId ?? cardNumber.slice(-6),
      detail: {
        carrierId: body.carrierId,
        operationId: execution.operationId,
        replayed: execution.replayed,
        via: 'support-bot',
      },
    });

    if (!execution.replayed) void (async () => {
      const identity = env.DWH_DATABASE_URL
        ? await getCardEfsIdentity(body.carrierId, cardNumber).catch(() => ({
            unit: null,
            driverName: null,
          }))
        : { unit: null, driverName: null };
      await notifyMiniApp({
        type: 'override',
        tenantId: registration.tenantId,
        carrierId: body.carrierId,
        telegramUserId: registration.telegramUserId,
        dedupeKey: [
          'override',
          body.carrierId,
          registration.cardId ?? cardNumber.slice(-6),
          body.requestId,
        ].join(':'),
        payload: {
          last6: cardNumber.slice(-6),
          card: cardNumber,
          unit: identity.unit || '—',
          driverName: identity.driverName || '—',
          cardId: registration.cardId ?? '',
        },
      });
    })();
    return {
      ...execution.result,
      ...(execution.replayed ? { replayed: true } : {}),
    };
  });
}
