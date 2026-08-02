import sensible from '@fastify/sensible';
import Fastify from 'fastify';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';
import { AppError } from '../../src/lib/errors.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  dmAccess: vi.fn(),
  findRegistration: vi.fn(),
  listActiveByCarrier: vi.fn(),
  listActiveForSupportBot: vi.fn(),
  insertMessages: vi.fn(async () => 1),
  deleteMessagesOlderThan: vi.fn(async () => 0),
  listEnabledChats: vi.fn(),
  setChat: vi.fn(),
  disableChat: vi.fn(),
  autoBindChat: vi.fn(),
  resolveCaller: vi.fn(),
  recallMemory: vi.fn(),
  commitMemory: vi.fn(),
  searchKnowledge: vi.fn(),
  deleteConfirmations: vi.fn(async () => 0),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: mocks.audit,
}));
vi.mock('../../src/modules/carrier/supportBotDmAccess.js', () => ({
  resolveSupportBotDmAccess: mocks.dmAccess,
}));
vi.mock('../../src/modules/carrier/supportBotCaller.js', async () => {
  const { z } = await import('zod');
  return {
    supportBotCallerSchema: z.object({
      telegramUserId: z.string().min(1).max(40),
      carrierId: z.string().min(1).max(40),
    }),
    resolveSupportBotCaller: mocks.resolveCaller,
  };
});
vi.mock('../../src/modules/carrier/supportBotMemory.js', () => ({
  recallSupportBotMemory: mocks.recallMemory,
  commitSupportBotMemory: mocks.commitMemory,
}));
vi.mock('../../src/modules/carrier/supportBotKnowledge.js', () => ({
  searchSupportBotKnowledge: mocks.searchKnowledge,
}));
vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findActiveByTelegramUserId: mocks.findRegistration,
    listActiveByCarrier: mocks.listActiveByCarrier,
    listActiveForSupportBot: mocks.listActiveForSupportBot,
  },
}));
vi.mock('../../src/repos/supportBotGatewayRepo.js', () => ({
  supportBotGatewayRepo: {
    insertMessages: mocks.insertMessages,
    deleteMessagesOlderThan: mocks.deleteMessagesOlderThan,
    listEnabledChats: mocks.listEnabledChats,
    setChat: mocks.setChat,
    disableChat: mocks.disableChat,
    autoBindChat: mocks.autoBindChat,
  },
}));
vi.mock('../../src/repos/supportBotConfirmationRepo.js', () => ({
  supportBotConfirmationRepo: { deleteResolvedBefore: mocks.deleteConfirmations },
}));

let requestContext: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-a',
};

vi.mock('../../src/routes/v1/helpers.js', () => ({
  requireContext: () => requestContext,
}));

import { supportBotGatewayRoutes } from '../../src/routes/v1/supportBotGateway.routes.js';
import { env } from '../../src/config/env.js';

async function app() {
  const instance = Fastify({ logger: false });
  errorHandlerPlugin(instance);
  await instance.register(sensible);
  instance.decorate('supportBotGatewayAuth', async () => undefined);
  instance.decorate('supportBotGatewayOrAdmin', async () => undefined);
  await instance.register(supportBotGatewayRoutes);
  return instance;
}

describe('support-bot gateway routes tenant isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requestContext = {
      ...requestContext,
      tenantId: 'tenant-a',
      requestId: 'req-a',
    };
    mocks.listEnabledChats.mockImplementation(
      async (ctx: TenantContext) =>
        ctx.tenantId === 'tenant-a'
          ? [
              {
                id: 'chat-a',
                tenantId: 'tenant-a',
                chatId: '-1001',
                carrierId: 'carrier-a',
                enabled: true,
                createdBy: 'admin',
                createdAt: new Date(),
                updatedAt: new Date(),
              },
            ]
          : [],
    );
    mocks.listActiveByCarrier.mockResolvedValue([]);
    mocks.listActiveForSupportBot.mockResolvedValue([]);
    mocks.resolveCaller.mockResolvedValue({ registration: {}, role: 'owner' });
    mocks.recallMemory.mockResolvedValue([]);
    mocks.commitMemory.mockResolvedValue(true);
    mocks.searchKnowledge.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('passes the authenticated tenant to chat-map reads', async () => {
    const server = await app();
    const tenantA = await server.inject({
      method: 'GET',
      url: '/support-bot/chat-map',
    });
    requestContext = {
      ...requestContext,
      tenantId: 'tenant-b',
      requestId: 'req-b',
    };
    const tenantB = await server.inject({
      method: 'GET',
      url: '/support-bot/chat-map',
    });
    await server.close();

    expect(tenantA.json()).toEqual({
      chats: [{ chatId: '-1001', carrierId: 'carrier-a' }],
    });
    expect(tenantB.json()).toEqual({ chats: [] });
    expect(mocks.listEnabledChats).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ tenantId: 'tenant-a' }),
    );
    expect(mocks.listEnabledChats).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ tenantId: 'tenant-b' }),
    );
  });

  it('uses the authenticated tenant for access-list lookup', async () => {
    const server = await app();
    await server.inject({
      method: 'GET',
      url: '/support-bot/access?carrierId=carrier-a',
    });
    await server.close();

    expect(mocks.listActiveByCarrier).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      'carrier-a',
    );
  });

  it('cannot auto-bind from a registration outside the tenant', async () => {
    mocks.findRegistration.mockResolvedValue(undefined);
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/chat-map/auto-bind',
      payload: { chatId: '-1002', telegramUserId: '9001' },
    });
    await server.close();

    expect(response.statusCode).toBe(404);
    expect(mocks.findRegistration).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      '9001',
    );
    expect(mocks.autoBindChat).not.toHaveBeenCalled();
  });

  it('disables a chat mapping only with admin authority and audits it', async () => {
    mocks.disableChat.mockResolvedValue({
      id: 'chat-a',
      tenantId: 'tenant-a',
      chatId: '-1001',
      carrierId: 'carrier-a',
      enabled: false,
      createdBy: 'admin',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const server = await app();

    const denied = await server.inject({
      method: 'DELETE',
      url: '/support-bot/chat-map/-1001',
    });
    expect(denied.statusCode).toBe(403);
    expect(mocks.disableChat).not.toHaveBeenCalled();

    requestContext = { ...requestContext, role: 'admin' };
    const disabled = await server.inject({
      method: 'DELETE',
      url: '/support-bot/chat-map/-1001',
    });
    await server.close();

    expect(disabled.statusCode).toBe(204);
    expect(mocks.disableChat).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      '-1001',
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      expect.objectContaining({
        action: 'support_bot.chat_map.disable',
        resourceId: '-1001',
      }),
    );
  });

  it('proxies metrics and preserves monitor query parameters', async () => {
    const previousUrl = env.SUPPORT_BOT_GATEWAY_MONITOR_URL;
    const previousToken = env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN;
    env.SUPPORT_BOT_GATEWAY_MONITOR_URL = 'https://gateway.internal.example';
    env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN = 'backend-owned-monitor-secret';
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ pid: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    try {
      const server = await app();
      const response = await server.inject({
        method: 'GET',
        url: '/support-bot/monitor/api/metrics?token=untrusted&since=2026-07-28T00%3A00%3A00.000Z',
      });
      await server.close();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pid: 42 });
      const [target, init] = fetchMock.mock.calls[0] ?? [];
      expect(target).toBeInstanceOf(URL);
      expect(String(target)).toBe(
        'https://gateway.internal.example/api/metrics?since=2026-07-28T00%3A00%3A00.000Z&token=backend-owned-monitor-secret',
      );
      expect(init).toEqual(expect.objectContaining({ signal: expect.any(AbortSignal) }));
    } finally {
      env.SUPPORT_BOT_GATEWAY_MONITOR_URL = previousUrl;
      env.SUPPORT_BOT_GATEWAY_MONITOR_TOKEN = previousToken;
    }
  });

  it('recalls memory with authenticated tenant plus carrier/chat/user scope', async () => {
    const previous = env.FF_SUPPORT_BOT_MEMORY;
    env.FF_SUPPORT_BOT_MEMORY = true;
    try {
      mocks.recallMemory.mockResolvedValue([
        { content: 'prior issue', score: 0.9, createdAt: new Date() },
      ]);
      const server = await app();
      const response = await server.inject({
        method: 'POST',
        url: '/support-bot/memory/recall',
        payload: {
          carrierId: 'carrier-a',
          chatId: '-1001',
          telegramUserId: '9001',
          query: 'that issue',
        },
      });
      await server.close();

      expect(response.statusCode).toBe(200);
      expect(mocks.resolveCaller).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a' }),
        'carrier-a',
        '9001',
      );
      expect(mocks.recallMemory).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a' }),
        {
          carrierId: 'carrier-a',
          chatId: '-1001',
          telegramUserId: '9001',
        },
        'that issue',
        undefined,
      );
    } finally {
      env.FF_SUPPORT_BOT_MEMORY = previous;
    }
  });

  it('searches knowledge with authenticated tenant and exact carrier scope', async () => {
    mocks.searchKnowledge.mockResolvedValue([
      {
        id: 'kb-a',
        slug: 'report-help',
        title: 'Report help',
        content: 'Use the report tool.',
        translations: {},
        serviceId: 'transactions',
        knowledgeType: 'tool_pointer',
        riskClass: 'read',
        source: 'test',
        version: 1,
        score: 0.9,
      },
    ]);
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/knowledge/search',
      payload: {
        carrierId: 'carrier-a',
        query: 'report qanday olaman',
        enabledServices: ['knowledge', 'transactions'],
        limit: 3,
      },
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(mocks.searchKnowledge).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      {
        carrierId: 'carrier-a',
        enabledServices: ['knowledge', 'transactions'],
      },
      'report qanday olaman',
      3,
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      expect.objectContaining({
        action: 'support_bot.knowledge.search',
        resourceId: 'carrier-a',
      }),
    );
  });

  it('does not query another user memory when caller verification fails', async () => {
    const previous = env.FF_SUPPORT_BOT_MEMORY;
    env.FF_SUPPORT_BOT_MEMORY = true;
    mocks.resolveCaller.mockRejectedValue(
      new AppError('carrier/user mismatch', {
        statusCode: 403,
        code: 'SUPPORT_BOT_CARRIER_MISMATCH',
        expose: true,
      }),
    );
    try {
      const server = await app();
      const response = await server.inject({
        method: 'POST',
        url: '/support-bot/memory/recall',
        payload: {
          carrierId: 'carrier-a',
          chatId: '-1001',
          telegramUserId: 'user-b',
          query: 'user A history',
        },
      });
      await server.close();

      expect(response.statusCode).toBe(403);
      expect(mocks.recallMemory).not.toHaveBeenCalled();
    } finally {
      env.FF_SUPPORT_BOT_MEMORY = previous;
    }
  });
});
