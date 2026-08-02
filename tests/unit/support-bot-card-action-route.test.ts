import Fastify from 'fastify';
import sensible from '@fastify/sensible';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  findRegistration: vi.fn(),
  findConfirmation: vi.fn(),
  issueFence: vi.fn(async () => 12),
  executeOperation: vi.fn(),
  listCards: vi.fn(),
  setCardStatus: vi.fn(),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: mocks.audit,
}));
vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findActiveByTelegramUserId: mocks.findRegistration,
  },
}));
vi.mock('../../src/repos/supportBotConfirmationRepo.js', () => ({
  supportBotConfirmationRepo: {
    findById: mocks.findConfirmation,
  },
}));
vi.mock('../../src/repos/supportBotOperationRepo.js', () => ({
  supportBotOperationRepo: {
    issueFence: mocks.issueFence,
  },
}));
vi.mock('../../src/modules/carrier/supportBotOperationService.js', () => ({
  executeSupportBotOperation: mocks.executeOperation,
}));
vi.mock('../../src/wrappers/efsWrapper.js', () => ({
  efsWrapper: {
    listCards: mocks.listCards,
    setCardStatus: mocks.setCardStatus,
  },
}));
vi.mock('../../src/wrappers/serverCrmWrapper.js', () => ({
  serverCrmWrapper: { getCards: vi.fn() },
}));

const requestContext: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-1',
};

vi.mock('../../src/routes/v1/helpers.js', () => ({
  requireContext: () => requestContext,
}));

import { supportBotCardActionRoutes } from '../../src/routes/v1/supportBotCardAction.routes.js';
import { supportBotRequestHash } from '../../src/modules/carrier/supportBotOperationIdentity.js';

async function app() {
  const instance = Fastify({ logger: false });
  errorHandlerPlugin(instance);
  await instance.register(sensible);
  instance.decorate('supportBotGatewayAuth', async () => undefined);
  await instance.register(supportBotCardActionRoutes);
  return instance;
}

const body = {
  carrierId: '44',
  telegramUserId: '9001',
  cardLast6: '123456',
  action: 'deactivate',
};

describe('support-bot card-action route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.FF_MINIAPP_CARD_WRITES_ENABLED = true;
    env.FF_SUPPORT_BOT_IDEMPOTENCY = false;
    mocks.findRegistration.mockResolvedValue({
      id: 'reg-1',
      tenantId: 'tenant-a',
      profile: 'owner',
      carrierId: '44',
      telegramUserId: '9001',
    });
    mocks.listCards.mockResolvedValue({
      data: [{ cardNumber: '708305123456' }],
    });
    mocks.findConfirmation.mockResolvedValue({
      id: 'sbcf_test',
      status: 'consumed',
      carrierId: '44',
      telegramUserId: '9001',
      toolName: 'octane_card_action',
      argumentsHash: supportBotRequestHash('octane_card_action', {
        telegram_user_id: '9001',
        card_last6: '123456',
        action: 'deactivate',
      }),
    });
    mocks.setCardStatus.mockResolvedValue({ provider: 'ok' });
  });

  it('preserves legacy execution but still sanitizes the response while the flag is off', async () => {
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/card-action',
      payload: body,
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      last6: '123456',
      action: 'deactivate',
    });
    expect(mocks.executeOperation).not.toHaveBeenCalled();
    expect(mocks.setCardStatus).toHaveBeenCalledOnce();
  });

  it('issues a Postgres fence only when idempotency is enabled', async () => {
    env.FF_SUPPORT_BOT_IDEMPOTENCY = true;
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/session-fence',
      payload: { sessionKeyHash: 'a'.repeat(64) },
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enabled: true, fencingToken: 12 });
    expect(mocks.issueFence).toHaveBeenCalledWith(
      requestContext,
      'a'.repeat(64),
    );
  });

  it('fails closed when required operation metadata is absent', async () => {
    env.FF_SUPPORT_BOT_IDEMPOTENCY = true;
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/card-action',
      payload: body,
    });
    await server.close();

    expect(response.statusCode).toBe(400);
    expect(mocks.executeOperation).not.toHaveBeenCalled();
    expect(mocks.setCardStatus).not.toHaveBeenCalled();
  });

  it('passes trusted metadata to the operation executor and returns sanitized output', async () => {
    env.FF_SUPPORT_BOT_IDEMPOTENCY = true;
    mocks.executeOperation.mockResolvedValue({
      operationId: 'sbo-1',
      replayed: false,
      result: { success: true, last6: '123456', action: 'deactivate' },
    });
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/card-action',
      headers: {
        'idempotency-key': 'b'.repeat(64),
        'x-support-bot-confirmation-id': 'sbcf_test',
        'x-support-bot-turn-id': 'confirmation:sbcf_test',
        'x-support-bot-write-occurrence': '0',
        'x-support-bot-session-key': 'a'.repeat(64),
        'x-support-bot-fencing-token': '12',
      },
      payload: body,
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      last6: '123456',
      action: 'deactivate',
    });
    expect(mocks.executeOperation).toHaveBeenCalledWith(
      requestContext,
      expect.objectContaining({
        idempotencyKey: 'b'.repeat(64),
        turnId: 'confirmation:sbcf_test',
        writeOccurrence: 0,
        sessionKeyHash: 'a'.repeat(64),
        fencingToken: 12,
        operationType: 'card_action',
        actorTelegramUserId: '9001',
        carrierId: '44',
      }),
    );
    expect(mocks.setCardStatus).not.toHaveBeenCalled();
  });

  it('echoes replay metadata without changing fresh response bodies', async () => {
    env.FF_SUPPORT_BOT_IDEMPOTENCY = true;
    mocks.executeOperation.mockResolvedValue({
      operationId: 'sbo-1',
      replayed: true,
      result: {
        success: true,
        last6: '123456',
        action: 'deactivate',
      },
    });
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/card-action',
      headers: {
        'idempotency-key': 'b'.repeat(64),
        'x-support-bot-confirmation-id': 'sbcf_test',
        'x-support-bot-turn-id': 'confirmation:sbcf_test',
        'x-support-bot-write-occurrence': '0',
        'x-support-bot-session-key': 'a'.repeat(64),
        'x-support-bot-fencing-token': '12',
      },
      payload: body,
    });
    await server.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      success: true,
      last6: '123456',
      action: 'deactivate',
      replayed: true,
    });
  });

  it('rejects mutation metadata that does not match the consumed confirmation', async () => {
    env.FF_SUPPORT_BOT_IDEMPOTENCY = true;
    mocks.findConfirmation.mockResolvedValue({
      id: 'sbcf_test',
      status: 'consumed',
      carrierId: '44',
      telegramUserId: 'another-user',
      toolName: 'octane_card_action',
      argumentsHash: 'wrong',
    });
    const server = await app();
    const response = await server.inject({
      method: 'POST',
      url: '/support-bot/card-action',
      headers: {
        'idempotency-key': 'b'.repeat(64),
        'x-support-bot-confirmation-id': 'sbcf_test',
        'x-support-bot-turn-id': 'confirmation:sbcf_test',
        'x-support-bot-write-occurrence': '0',
        'x-support-bot-session-key': 'a'.repeat(64),
        'x-support-bot-fencing-token': '12',
      },
      payload: body,
    });
    await server.close();

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: { code: 'SUPPORT_BOT_CONFIRMATION_REQUIRED' },
    });
    expect(mocks.executeOperation).not.toHaveBeenCalled();
    expect(mocks.setCardStatus).not.toHaveBeenCalled();
  });
});
