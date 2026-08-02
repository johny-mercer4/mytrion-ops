import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveSupportBotCaller } from '../../modules/carrier/supportBotCaller.js';
import { supportBotRequestHash } from '../../modules/carrier/supportBotOperationIdentity.js';
import { supportBotConfirmationRepo } from '../../repos/supportBotConfirmationRepo.js';
import { supportBotGatewayRepo } from '../../repos/supportBotGatewayRepo.js';
import { requireContext } from './helpers.js';

const confirmableToolSchema = z.enum([
  'octane_money_code',
  'octane_card_action',
  'octane_card_limits',
  'octane_card_info',
  'octane_service_request',
  'octane_override',
]);

const confirmationScopeSchema = z.object({
  token: z.string().regex(/^[a-f0-9]{32}$/u),
  carrierId: z.string().min(1).max(40),
  chatId: z.union([z.string(), z.number()]).transform(String),
  telegramUserId: z.union([z.string(), z.number()]).transform(String),
  messageId: z.union([z.string(), z.number()]).transform(String),
});

const createSchema = confirmationScopeSchema.extend({
  toolName: confirmableToolSchema,
  arguments: z.record(z.unknown()).refine(
    (value) => JSON.stringify(value).length <= 6_000,
    'confirmation arguments are too large',
  ),
});

const resolveSchema = confirmationScopeSchema.extend({
  updateId: z.union([z.string(), z.number()]).transform(String),
  decision: z.enum(['confirm', 'cancel']),
});

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function toolAllowedForRole(toolName: z.infer<typeof confirmableToolSchema>, role: 'owner' | 'driver') {
  if (toolName === 'octane_override') return role === 'driver';
  if (toolName === 'octane_card_info' || toolName === 'octane_service_request') return true;
  return role === 'owner';
}

async function verifyScope(
  request: Parameters<typeof requireContext>[0],
  body: { carrierId: string; chatId: string; telegramUserId: string },
): Promise<'owner' | 'driver'> {
  const ctx = requireContext(request);
  const chat = await supportBotGatewayRepo.findChat(ctx, body.chatId);
  if (!chat?.enabled || chat.carrierId !== body.carrierId) {
    throw new AppError('Confirmation does not match an enabled Telegram chat', {
      statusCode: 403,
      code: 'SUPPORT_BOT_CONFIRMATION_SCOPE_MISMATCH',
      expose: true,
    });
  }
  const { role } = await resolveSupportBotCaller(ctx, body.carrierId, body.telegramUserId);
  return role;
}

/** Durable, one-time confirmations bound to actor, chat, carrier, message, tool and exact args. */
export async function supportBotConfirmationRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.supportBotGatewayAuth] };

  app.post('/support-bot/confirmations', guard, async (request, reply) => {
    const body = createSchema.parse(request.body);
    const role = await verifyScope(request, body);
    if (!toolAllowedForRole(body.toolName, role)) {
      throw new AppError('This action is not allowed for the registered support-bot role', {
        statusCode: 403,
        code: 'SUPPORT_BOT_CONFIRMATION_ROLE_DENIED',
        expose: true,
      });
    }
    if (String(body.arguments['telegram_user_id'] ?? '') !== body.telegramUserId) {
      throw new AppError('Confirmation actor does not match the bound tool arguments', {
        statusCode: 403,
        code: 'SUPPORT_BOT_CONFIRMATION_ACTOR_MISMATCH',
        expose: true,
      });
    }
    const ctx = requireContext(request);
    const row = await supportBotConfirmationRepo.create(ctx, {
      tokenHash: tokenHash(body.token),
      carrierId: body.carrierId,
      chatId: body.chatId,
      telegramUserId: body.telegramUserId,
      messageId: body.messageId,
      toolName: body.toolName,
      arguments: body.arguments,
      argumentsHash: supportBotRequestHash(body.toolName, body.arguments),
      expiresAt: new Date(Date.now() + env.SUPPORT_BOT_CONFIRMATION_TTL_SECONDS * 1_000),
    });
    await auditFromContext(ctx, {
      action: 'support_bot.confirmation.create',
      status: 'ok',
      resourceType: 'support_bot_confirmation',
      resourceId: row.id,
      detail: {
        carrierId: row.carrierId,
        chatId: row.chatId,
        telegramUserId: row.telegramUserId,
        toolName: row.toolName,
        argumentsHash: row.argumentsHash,
      },
    });
    return reply.code(201).send({ confirmationId: row.id, expiresAt: row.expiresAt });
  });

  app.post('/support-bot/confirmations/resolve', guard, async (request) => {
    const body = resolveSchema.parse(request.body);
    await verifyScope(request, body);
    const ctx = requireContext(request);
    const result = await supportBotConfirmationRepo.resolve(ctx, {
      ...body,
      tokenHash: tokenHash(body.token),
    });
    if (result.kind === 'not_found') {
      throw new AppError('Confirmation was not found', {
        statusCode: 404,
        code: 'SUPPORT_BOT_CONFIRMATION_NOT_FOUND',
        expose: true,
      });
    }
    if (result.kind === 'scope_mismatch') {
      throw new AppError('Confirmation belongs to another actor or message', {
        statusCode: 403,
        code: 'SUPPORT_BOT_CONFIRMATION_SCOPE_MISMATCH',
        expose: true,
      });
    }
    if (result.kind === 'expired') {
      throw new AppError('Confirmation expired; request a new one', {
        statusCode: 410,
        code: 'SUPPORT_BOT_CONFIRMATION_EXPIRED',
        expose: true,
      });
    }
    if (result.kind === 'already_resolved') {
      throw new AppError('Confirmation was already used', {
        statusCode: 409,
        code: 'SUPPORT_BOT_CONFIRMATION_ALREADY_USED',
        expose: true,
      });
    }
    if (result.kind !== 'resolved' && result.kind !== 'replay') {
      throw new AppError('Confirmation could not be resolved', {
        statusCode: 409,
        code: 'SUPPORT_BOT_CONFIRMATION_UNAVAILABLE',
        expose: true,
      });
    }
    const row = result.confirmation;
    await auditFromContext(ctx, {
      action: `support_bot.confirmation.${body.decision}`,
      status: 'ok',
      resourceType: 'support_bot_confirmation',
      resourceId: row.id,
      detail: {
        carrierId: row.carrierId,
        chatId: row.chatId,
        telegramUserId: row.telegramUserId,
        toolName: row.toolName,
        argumentsHash: row.argumentsHash,
        updateId: body.updateId,
      },
    });
    if (body.decision === 'cancel') return { confirmed: false, confirmationId: row.id };
    return {
      confirmed: true,
      confirmationId: row.id,
      toolName: row.toolName,
      arguments: row.arguments,
      argumentsHash: row.argumentsHash,
      turnId: `confirmation:${row.id}`,
    };
  });
}
