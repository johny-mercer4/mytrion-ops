import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { requireDriverCardNumber, telegramCtx } from '../../modules/carrier/miniAppAuth.js';
import {
  requireSupportBotWrites,
  resolveSupportBotCaller,
  resolveSupportBotCardByLast6,
  sendSupportBotPrivate,
  supportBotCallerSchema,
  takeSupportBotWrite,
} from '../../modules/carrier/supportBotCaller.js';
import { efsWrapper } from '../../wrappers/efsWrapper.js';
import { serverCrmWrapper } from '../../wrappers/serverCrmWrapper.js';
import { requireContext } from './helpers.js';
import { executeSupportBotWrite } from './supportBotOperation.js';

/** Idempotent money-code, limit, and card-identity mutations. */
export async function supportBotMutationRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.supportBotGatewayAuth] };

  app.post('/support-bot/money-code/draw', guard, async (request) => {
    if (!env.FF_MINIAPP_MONEY_CODE_ENABLED) {
      throw new AppError('Money code is not enabled yet.', {
        statusCode: 503,
        code: 'MINIAPP_MONEY_CODE_DISABLED',
        expose: true,
      });
    }
    const body = supportBotCallerSchema
      .extend({
        amount: z.coerce.number().positive(),
        unitNumber: z.string().trim().min(1).max(60),
        reason: z.string().trim().min(1).max(120),
      })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'owner') {
      throw new AppError('Money codes are issued by the account owner.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_OWNER_ONLY',
        expose: true,
      });
    }
    const execution = await executeSupportBotWrite(request, {
      operationType: 'money_code',
      actorTelegramUserId: body.telegramUserId,
      carrierId: body.carrierId,
      validatedArguments: body,
      confirmationArguments: {
        telegram_user_id: body.telegramUserId,
        amount: body.amount,
        unit_number: body.unitNumber,
        reason: body.reason,
      },
      prepare: () => takeSupportBotWrite(body.carrierId),
      execute: async () => {
        const result = (await serverCrmWrapper.drawMoneyCode(body.carrierId, {
          amount: body.amount,
          unitNumber: body.unitNumber,
          reason: body.reason,
          requestedBy: `support-bot: ${registration.companyName ?? 'owner'} (telegram:${registration.telegramUserId})`,
        })) as Record<string, unknown>;
        const code = [
          result['code'],
          result['money_code'],
          result['moneyCode'],
          result['express_code'],
        ]
          .map((value) => (value == null ? '' : String(value)))
          .find((value) => value.length >= 4);
        await sendSupportBotPrivate(
          registration,
          code
            ? `💵 Money code (unit ${body.unitNumber}, $${body.amount}):\n${code}\n${body.reason}`
            : `💵 Money code issued (unit ${body.unitNumber}, $${body.amount}) — open the mini-app to view it.`,
        );
        return { success: true, deliveredTo: 'private_bot_chat' };
      },
      sanitize: (output) => output,
    });
    await auditFromContext(telegramCtx('owner', registration.telegramUserId), {
      action: execution.replayed
        ? 'carrier.support_bot.money_code_replay'
        : 'carrier.support_bot.money_code_draw',
      status: 'ok',
      resourceType: 'money_code',
      resourceId: body.carrierId,
      detail: {
        carrierId: body.carrierId,
        amount: body.amount,
        unitNumber: body.unitNumber,
        operationId: execution.operationId,
        replayed: execution.replayed,
        via: 'support-bot',
      },
    });
    return { ...execution.result, ...(execution.replayed ? { replayed: true } : {}) };
  });

  app.post('/support-bot/card-limits', guard, async (request) => {
    requireSupportBotWrites();
    const body = supportBotCallerSchema
      .extend({
        cardLast6: z.string().trim().min(4).max(19),
        limitId: z.enum(['ULSD', 'DEFD']),
        action: z.enum(['increase', 'decrease']),
        value: z.coerce.number().positive().max(env.MINIAPP_LIMIT_CHANGE_MAX),
      })
      .parse(request.body);
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role !== 'owner') {
      throw new AppError('Limit changes are an owner action.', {
        statusCode: 403,
        code: 'SUPPORT_BOT_OWNER_ONLY',
        expose: true,
      });
    }
    const cardNumber = await resolveSupportBotCardByLast6(body.carrierId, body.cardLast6);
    const execution = await executeSupportBotWrite(request, {
      operationType: 'card_limits',
      actorTelegramUserId: body.telegramUserId,
      carrierId: body.carrierId,
      validatedArguments: { ...body, cardLast6: cardNumber.slice(-6) },
      confirmationArguments: {
        telegram_user_id: body.telegramUserId,
        card_last6: body.cardLast6,
        limit_id: body.limitId,
        action: body.action,
        value: body.value,
      },
      prepare: () => takeSupportBotWrite(body.carrierId),
      execute: async () => {
        await efsWrapper.setCardLimits(body.carrierId, cardNumber, {
          limitId: body.limitId,
          value: body.value,
          action: body.action,
        });
        return { success: true, last6: cardNumber.slice(-6) };
      },
      sanitize: (output) => output,
    });
    await auditFromContext(telegramCtx('owner', registration.telegramUserId), {
      action: execution.replayed
        ? 'carrier.support_bot.card_limits_replay'
        : 'carrier.support_bot.card_limits_change',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardNumber.slice(-6),
      detail: {
        carrierId: body.carrierId,
        limitId: body.limitId,
        action: body.action,
        value: body.value,
        operationId: execution.operationId,
        replayed: execution.replayed,
        via: 'support-bot',
      },
    });
    return { ...execution.result, ...(execution.replayed ? { replayed: true } : {}) };
  });

  app.post('/support-bot/card-info', guard, async (request) => {
    requireSupportBotWrites();
    const body = supportBotCallerSchema
      .extend({
        cardLast6: z.string().trim().min(4).max(19).optional(),
        unitNumber: z.string().trim().min(1).max(60).optional(),
        driverId: z.string().trim().min(1).max(60).optional(),
        driverName: z.string().trim().min(1).max(120).optional(),
      })
      .parse(request.body);
    if (!body.unitNumber && !body.driverId && !body.driverName) {
      throw new AppError('Provide a unit number, driver ID, or driver name to change.', {
        statusCode: 400,
        code: 'CARD_INFO_EMPTY',
        expose: true,
      });
    }
    const { registration, role } = await resolveSupportBotCaller(
      requireContext(request),
      body.carrierId,
      body.telegramUserId,
    );
    if (role === 'driver' && body.driverName) {
      throw new AppError('The driver name on the card is managed by your company owner.', {
        statusCode: 403,
        code: 'DRIVER_NAME_OWNER_ONLY',
        expose: true,
      });
    }
    const cardNumber =
      role === 'driver'
        ? await requireDriverCardNumber(registration)
        : await resolveSupportBotCardByLast6(body.carrierId, body.cardLast6 ?? '');
    const fields = {
      ...(body.unitNumber ? { unitNumber: body.unitNumber } : {}),
      ...(body.driverId ? { driverId: body.driverId } : {}),
      ...(body.driverName ? { driverName: body.driverName } : {}),
    };
    const execution = await executeSupportBotWrite(request, {
      operationType: 'card_info',
      actorTelegramUserId: body.telegramUserId,
      carrierId: body.carrierId,
      validatedArguments: { ...body, cardLast6: cardNumber.slice(-6) },
      confirmationArguments: {
        telegram_user_id: body.telegramUserId,
        ...(body.cardLast6 ? { card_last6: body.cardLast6 } : {}),
        ...(body.unitNumber ? { unit_number: body.unitNumber } : {}),
        ...(body.driverId ? { driver_id: body.driverId } : {}),
        ...(body.driverName ? { driver_name: body.driverName } : {}),
      },
      prepare: () => takeSupportBotWrite(body.carrierId),
      execute: async () => {
        await efsWrapper.updateCardInfo(body.carrierId, cardNumber, fields);
        return { success: true, last6: cardNumber.slice(-6) };
      },
      sanitize: (output) => output,
    });
    await auditFromContext(telegramCtx(registration.profile, registration.telegramUserId), {
      action: execution.replayed
        ? 'carrier.support_bot.card_info_replay'
        : 'carrier.support_bot.card_info_change',
      status: 'ok',
      resourceType: 'efs_card',
      resourceId: cardNumber.slice(-6),
      detail: {
        carrierId: body.carrierId,
        role,
        fields: Object.keys(fields),
        operationId: execution.operationId,
        replayed: execution.replayed,
        via: 'support-bot',
      },
    });
    return { ...execution.result, ...(execution.replayed ? { replayed: true } : {}) };
  });
}
