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
import type { TenantContext } from '../../src/types/tenantContext.js';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  dmAccess: vi.fn(),
  findRegistration: vi.fn(),
  listActiveByCarrier: vi.fn(),
  insertMessages: vi.fn(async () => 1),
  listEnabledChats: vi.fn(),
  setChat: vi.fn(),
  autoBindChat: vi.fn(),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: mocks.audit,
}));
vi.mock('../../src/modules/carrier/supportBotDmAccess.js', () => ({
  resolveSupportBotDmAccess: mocks.dmAccess,
}));
vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findActiveByTelegramUserId: mocks.findRegistration,
    listActiveByCarrier: mocks.listActiveByCarrier,
  },
}));
vi.mock('../../src/repos/supportBotGatewayRepo.js', () => ({
  supportBotGatewayRepo: {
    insertMessages: mocks.insertMessages,
    listEnabledChats: mocks.listEnabledChats,
    setChat: mocks.setChat,
    autoBindChat: mocks.autoBindChat,
  },
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

async function app() {
  const instance = Fastify({ logger: false });
  errorHandlerPlugin(instance);
  await instance.register(sensible);
  instance.decorate('sessionOrApiKey', async () => undefined);
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

  it('proxies metrics and preserves monitor query parameters', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ pid: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const server = await app();
    const response = await server.inject({
      method: 'GET',
      url: '/support-bot/monitor/api/metrics?token=secret&since=2026-07-28T00%3A00%3A00.000Z',
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ pid: 42 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8787/api/metrics?token=secret&since=2026-07-28T00%3A00%3A00.000Z',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
