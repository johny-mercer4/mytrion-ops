import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveSupportBotDmAccess } from '../../modules/carrier/supportBotDmAccess.js';
import { registeredMiniAppCompanyRepo } from '../../repos/registeredMiniAppCompanyRepo.js';
import { supportBotGatewayRepo } from '../../repos/supportBotGatewayRepo.js';
import { requireContext } from './helpers.js';

const messagesBatchSchema = z.object({
  carrierId: z.string().min(1),
  messages: z
    .array(
      z.object({
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
});

/** Gateway control-plane routes: access, chat mapping, message ingest and monitor proxy. */
export async function supportBotGatewayRoutes(
  app: FastifyInstance,
): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/support-bot/dm-access', guard, async (request) => {
    const query = z
      .object({ telegramUserId: z.string().min(1).max(40) })
      .parse(request.query);
    const access = await resolveSupportBotDmAccess(
      requireContext(request),
      query.telegramUserId,
    );
    return { access };
  });

  app.post('/support-bot/messages', guard, async (request, reply) => {
    const body = messagesBatchSchema.parse(request.body);
    const inserted = await supportBotGatewayRepo.insertMessages(
      requireContext(request),
      body.messages.map((message) => ({
        carrierId: body.carrierId,
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
    return reply.code(201).send({ inserted });
  });

  const monitorUpstream = `http://localhost:${process.env['MONITOR_PORT'] ?? '8787'}`;
  async function proxyMonitor(
    path: string,
    request: { query: unknown },
    reply: {
      code: (status: number) => { send: (body: unknown) => unknown };
      header: (key: string, value: string) => void;
    },
  ): Promise<unknown> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(
      (request.query as Record<string, unknown>) ?? {},
    )) {
      if (typeof value === 'string' || typeof value === 'number') {
        params.set(key, String(value));
      }
    }
    const response = await fetch(
      `${monitorUpstream}${path}?${params.toString()}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    reply.header(
      'content-type',
      response.headers.get('content-type') ?? 'text/plain',
    );
    return reply
      .code(response.status)
      .send(Buffer.from(await response.arrayBuffer()));
  }

  app.get('/support-bot/monitor', async (request, reply) => {
    const query = request.url.includes('?')
      ? request.url.slice(request.url.indexOf('?'))
      : '';
    return reply.redirect(`/v1/support-bot/monitor/${query}`);
  });
  app.get('/support-bot/monitor/', async (request, reply) =>
    proxyMonitor('/', request, reply),
  );
  app.get('/support-bot/monitor/api/turns', async (request, reply) =>
    proxyMonitor('/api/turns', request, reply),
  );
  app.get('/support-bot/monitor/api/metrics', async (request, reply) =>
    proxyMonitor('/api/metrics', request, reply),
  );

  app.get('/support-bot/chat-map', guard, async (request) => {
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

  app.post('/support-bot/chat-map', guard, async (request, reply) => {
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
    });
    await auditFromContext(ctx, {
      action: 'support_bot.chat_map.set',
      status: 'ok',
      resourceType: 'support_bot_chat',
      resourceId: body.chatId,
      detail: { carrierId: body.carrierId },
    });
    return reply.status(201).send(row);
  });

  app.post('/support-bot/chat-map/auto-bind', guard, async (request, reply) => {
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
    });
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
      companyName: result.bound ? registration.companyName ?? null : null,
    });
  });

  app.get('/support-bot/access', guard, async (request) => {
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
}
