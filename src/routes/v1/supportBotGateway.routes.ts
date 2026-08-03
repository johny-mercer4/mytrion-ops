import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveSupportBotDmAccess } from '../../modules/carrier/supportBotDmAccess.js';
import {
  commitSupportBotMemory,
  recallSupportBotMemory,
} from '../../modules/carrier/supportBotMemory.js';
import { searchSupportBotKnowledge } from '../../modules/carrier/supportBotKnowledge.js';
import {
  resolveSupportBotCaller,
  supportBotCallerSchema,
} from '../../modules/carrier/supportBotCaller.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { supportBotGatewayRepo } from '../../repos/supportBotGatewayRepo.js';
import { supportBotConfirmationRepo } from '../../repos/supportBotConfirmationRepo.js';
import { requireContext } from './helpers.js';

const messagesBatchSchema = z.object({
  // Legacy development gateway compatibility; new gateways bind carrier per row.
  carrierId: z.string().min(1).max(40).optional(),
  messages: z
    .array(
      z.object({
        carrierId: z.string().min(1).max(40).optional(),
        ts: z.string().max(40),
        chatId: z.union([z.string(), z.number()]),
        msgId: z.union([z.string(), z.number()]).optional(),
        userId: z.union([z.string(), z.number()]),
        name: z.string().max(200),
        dir: z.enum(['in', 'out']),
        text: z.string().max(8000),
        photo: z.boolean().optional(),
        engaged: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(200),
}).superRefine((value, ctx) => {
  value.messages.forEach((message, index) => {
    if (!message.carrierId && !value.carrierId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['messages', index, 'carrierId'],
        message: 'carrierId is required per message',
      });
    }
  });
});

let lastMessageRetentionAt = 0;

const memoryScopeSchema = supportBotCallerSchema.extend({
  chatId: z.union([z.string(), z.number()]).transform(String),
});

const supportKnowledgeSearchSchema = z.object({
  carrierId: z.string().min(1).max(40),
  query: z.string().trim().min(2).max(400),
  enabledServices: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u))
    .max(32)
    .default([]),
  limit: z.coerce.number().int().positive().max(5).optional(),
});

/** Gateway control-plane routes: access, chat mapping, message ingest and monitor proxy. */
export async function supportBotGatewayRoutes(
  app: FastifyInstance,
): Promise<void> {
  const serviceGuard = { onRequest: [app.supportBotGatewayAuth] };
  const adminOrServiceGuard = { onRequest: [app.supportBotGatewayOrAdmin] };

  app.get('/support-bot/dm-access', serviceGuard, async (request) => {
    const query = z
      .object({ telegramUserId: z.string().min(1).max(40) })
      .parse(request.query);
    const access = await resolveSupportBotDmAccess(
      requireContext(request),
      query.telegramUserId,
    );
    return { access };
  });

  app.post('/support-bot/messages', serviceGuard, async (request, reply) => {
    const body = messagesBatchSchema.parse(request.body);
    const inserted = await supportBotGatewayRepo.insertMessages(
      requireContext(request),
      body.messages.map((message) => ({
        carrierId: message.carrierId ?? body.carrierId ?? '',
        chatId: String(message.chatId),
        ...(message.msgId != null ? { msgId: String(message.msgId) } : {}),
        telegramUserId: String(message.userId),
        name: message.name,
        direction: message.dir,
        text: message.text,
        photo: message.photo ?? false,
        engaged: message.engaged ?? false,
        sentAt: new Date(message.ts),
      })),
    );
    if (Date.now() - lastMessageRetentionAt > 24 * 60 * 60_000) {
      lastMessageRetentionAt = Date.now();
      const ctx = requireContext(request);
      void Promise.all([
        supportBotGatewayRepo.deleteMessagesOlderThan(
          ctx,
          new Date(Date.now() - env.SUPPORT_BOT_MESSAGE_RETENTION_DAYS * 86_400_000),
        ),
        supportBotConfirmationRepo.deleteResolvedBefore(
          ctx,
          new Date(Date.now() - env.SUPPORT_BOT_CONFIRMATION_RETENTION_DAYS * 86_400_000),
        ),
      ])
        .catch((error: unknown) => request.log.warn({ error }, 'support-bot message retention failed'));
    }
    return reply.code(201).send({ inserted });
  });

  app.post('/support-bot/memory/recall', serviceGuard, async (request) => {
    const body = memoryScopeSchema
      .extend({
        query: z.string().trim().min(1).max(4000),
        limit: z.coerce.number().int().positive().max(8).optional(),
      })
      .parse(request.body);
    const ctx = requireContext(request);
    await resolveSupportBotCaller(ctx, body.carrierId, body.telegramUserId);
    if (!env.FF_SUPPORT_BOT_MEMORY) return { memories: [] };
    const memories = await recallSupportBotMemory(
      ctx,
      {
        carrierId: body.carrierId,
        chatId: body.chatId,
        telegramUserId: body.telegramUserId,
      },
      body.query,
      body.limit,
    );
    return { memories };
  });

  app.post('/support-bot/memory/commit', serviceGuard, async (request, reply) => {
    const body = memoryScopeSchema
      .extend({
        question: z.string().min(1).max(6000),
        answer: z.string().min(1).max(6000),
      })
      .parse(request.body);
    const ctx = requireContext(request);
    await resolveSupportBotCaller(ctx, body.carrierId, body.telegramUserId);
    if (!env.FF_SUPPORT_BOT_MEMORY) return reply.code(202).send({ stored: false });
    const stored = await commitSupportBotMemory(
      ctx,
      {
        carrierId: body.carrierId,
        chatId: body.chatId,
        telegramUserId: body.telegramUserId,
      },
      body.question,
      body.answer,
    );
    if (stored) {
      await auditFromContext(ctx, {
        action: 'support_bot.memory.commit',
        status: 'ok',
        resourceType: 'support_bot_memory',
        resourceId: `${body.carrierId}:${body.chatId}:${body.telegramUserId}`,
        detail: {
          carrierId: body.carrierId,
          chatId: body.chatId,
          telegramUserId: body.telegramUserId,
        },
      });
    }
    return reply.code(202).send({ stored });
  });

  app.post('/support-bot/knowledge/search', serviceGuard, async (request) => {
    const body = supportKnowledgeSearchSchema.parse(request.body);
    const ctx = requireContext(request);
    const articles = await searchSupportBotKnowledge(
      ctx,
      {
        carrierId: body.carrierId,
        enabledServices: body.enabledServices,
      },
      body.query,
      body.limit,
    );
    await auditFromContext(ctx, {
      action: 'support_bot.knowledge.search',
      status: 'ok',
      resourceType: 'support_bot_knowledge',
      resourceId: body.carrierId,
      detail: {
        carrierId: body.carrierId,
        enabledServices: body.enabledServices,
        hitIds: articles.map((article) => article.id),
      },
    });
    return { articles };
  });

  async function proxyMonitor(
    path: string,
    request: { query: unknown },
    reply: {
      code: (status: number) => { send: (body: unknown) => unknown };
      header: (key: string, value: string) => void;
    },
  ): Promise<unknown> {
    const monitorUpstream = env.SUPPORT_BOT_GATEWAY_MONITOR_URL.replace(/\/+$/u, '');
    if (!monitorUpstream) {
      throw new AppError('Support-bot monitor upstream is not configured', {
        statusCode: 503,
        code: 'SUPPORT_BOT_MONITOR_UNAVAILABLE',
        expose: true,
      });
    }
    const target = new URL(path, `${monitorUpstream}/`);
    for (const [key, value] of Object.entries(
      (request.query as Record<string, unknown>) ?? {},
    )) {
      if (key !== 'token' && (typeof value === 'string' || typeof value === 'number')) {
        target.searchParams.set(key, String(value));
      }
    }
    if (env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN) {
      target.searchParams.set('token', env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN);
    }
    const response = await fetch(target, { signal: AbortSignal.timeout(10_000) });
    reply.header(
      'content-type',
      response.headers.get('content-type') ?? 'text/plain',
    );
    return reply
      .code(response.status)
      .send(Buffer.from(await response.arrayBuffer()));
  }

  app.get('/support-bot/monitor', adminOrServiceGuard, async (request, reply) => {
    const query = request.url.includes('?')
      ? request.url.slice(request.url.indexOf('?'))
      : '';
    return reply.redirect(`/v1/support-bot/monitor/${query}`);
  });
  app.get('/support-bot/monitor/', adminOrServiceGuard, async (request, reply) =>
    proxyMonitor('/', request, reply),
  );
  app.get('/support-bot/monitor/api/turns', adminOrServiceGuard, async (request, reply) =>
    proxyMonitor('/api/turns', request, reply),
  );
  app.get('/support-bot/monitor/api/metrics', adminOrServiceGuard, async (request, reply) =>
    proxyMonitor('/api/metrics', request, reply),
  );

  app.get('/support-bot/chat-map', adminOrServiceGuard, async (request) => {
    const rows = await supportBotGatewayRepo.listEnabledChats(
      requireContext(request),
    );
    return {
      chats: rows.map((row) => ({
        chatId: row.chatId,
        carrierId: row.carrierId,
      })),
    };
  });

  app.post('/support-bot/chat-map', adminOrServiceGuard, async (request, reply) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) {
      throw new RBACError('Mapping bot chats requires admin access');
    }
    const body = z
      .object({
        chatId: z.string().min(1).max(40),
        carrierId: z.string().min(1).max(40),
      })
      .parse(request.body);
    const row = await supportBotGatewayRepo.setChat(ctx, {
      ...body,
      createdBy: ctx.userId,
    }, env.SUPPORT_BOT_MAX_GROUPS);
    await auditFromContext(ctx, {
      action: 'support_bot.chat_map.set',
      status: 'ok',
      resourceType: 'support_bot_chat',
      resourceId: body.chatId,
      detail: { carrierId: body.carrierId },
    });
    return reply.status(201).send(row);
  });

  app.delete('/support-bot/chat-map/:chatId', adminOrServiceGuard, async (request, reply) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) {
      throw new RBACError('Disabling bot chats requires admin access');
    }
    const { chatId } = z
      .object({ chatId: z.string().min(1).max(40) })
      .parse(request.params);
    const row = await supportBotGatewayRepo.disableChat(ctx, chatId);
    if (!row) {
      throw new AppError('Support-bot chat mapping not found', {
        statusCode: 404,
        code: 'SUPPORT_BOT_CHAT_NOT_FOUND',
        expose: true,
      });
    }
    await auditFromContext(ctx, {
      action: 'support_bot.chat_map.disable',
      status: 'ok',
      resourceType: 'support_bot_chat',
      resourceId: chatId,
      detail: { carrierId: row.carrierId },
    });
    return reply.status(204).send();
  });

  app.post('/support-bot/chat-map/auto-bind', serviceGuard, async (request, reply) => {
    const ctx = requireContext(request);
    const body = z
      .object({
        chatId: z.string().min(1).max(40),
        telegramUserId: z.string().min(1).max(40),
      })
      .parse(request.body);
    const registration =
      await registeredMiniAppCompanyRepo.findActiveByTelegramUserId(
        ctx,
        body.telegramUserId,
      );
    if (
      !registration?.carrierId ||
      registration.profile === 'driver'
    ) {
      throw new AppError('No active owner registration for this sender.', {
        statusCode: 404,
        code: 'SUPPORT_BOT_AUTO_BIND_NO_OWNER',
        expose: true,
      });
    }
    const result = await supportBotGatewayRepo.autoBindChat(ctx, {
      chatId: body.chatId,
      carrierId: registration.carrierId,
      createdBy: `auto:tg:${body.telegramUserId}`,
    }, env.SUPPORT_BOT_MAX_GROUPS);
    if (result.bound) {
      await auditFromContext(ctx, {
        action: 'support_bot.chat_map.auto_bind',
        status: 'ok',
        resourceType: 'support_bot_chat',
        resourceId: body.chatId,
        detail: {
          carrierId: registration.carrierId,
          boundBy: body.telegramUserId,
        },
      });
    }
    return reply.status(result.bound ? 201 : 200).send({
      carrierId: result.row.carrierId,
      bound: result.bound,
      companyName: registration.companyName ?? null,
    });
  });

  /**
   * Read-only first half of owner/manager auto-bind. The gateway displays this exact company in a
   * Telegram confirmation before it calls the mutating auto-bind route above. Drivers and revoked
   * registrations fail closed, and the carrier always comes from the server-owned registration.
   */
  app.post('/support-bot/chat-map/auto-bind/preview', serviceGuard, async (request) => {
    const ctx = requireContext(request);
    const body = z
      .object({ telegramUserId: z.string().min(1).max(40) })
      .parse(request.body);
    const registration =
      await registeredMiniAppCompanyRepo.findActiveByTelegramUserId(
        ctx,
        body.telegramUserId,
      );
    if (!registration?.carrierId || registration.profile === 'driver') {
      throw new AppError('No active owner or manager registration for this sender.', {
        statusCode: 404,
        code: 'SUPPORT_BOT_AUTO_BIND_NO_OWNER',
        expose: true,
      });
    }
    return {
      carrierId: registration.carrierId,
      companyName: registration.companyName ?? null,
      profile: registration.profile,
    };
  });

  app.get('/support-bot/access', serviceGuard, async (request) => {
    const query = z
      .object({ carrierId: z.string().min(1).max(40) })
      .parse(request.query);
    const rows = await registeredMiniAppCompanyRepo.listActiveByCarrier(
      requireContext(request),
      query.carrierId,
    );
    return {
      carrierId: query.carrierId,
      users: rows.map((row) => ({
        telegramUserId: row.telegramUserId,
        profile: row.profile,
        name: row.driverName,
      })),
    };
  });

  app.get('/support-bot/access-snapshot', serviceGuard, async (request) => {
    const max = env.SUPPORT_BOT_ACCESS_SNAPSHOT_MAX;
    const rows = await registeredMiniAppCompanyRepo.listActiveForSupportBot(
      requireContext(request),
      max + 1,
    );
    if (rows.length > max) {
      throw new AppError('Support-bot access snapshot exceeds the configured safety cap', {
        statusCode: 503,
        code: 'SUPPORT_BOT_ACCESS_SNAPSHOT_TOO_LARGE',
        expose: true,
      });
    }
    return {
      generatedAt: new Date().toISOString(),
      users: rows.flatMap((row) =>
        row.carrierId
          ? [
              {
                carrierId: row.carrierId,
                telegramUserId: row.telegramUserId,
                profile: row.profile,
                name: row.driverName,
              },
            ]
          : [],
      ),
    };
  });
}
