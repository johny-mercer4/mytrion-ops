import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const mocks = vi.hoisted(() => ({
  audit: vi.fn(async () => undefined),
  create: vi.fn(),
  resolve: vi.fn(),
  findChat: vi.fn(),
  resolveCaller: vi.fn(),
}));

vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: mocks.audit,
}));
vi.mock('../../src/modules/carrier/supportBotCaller.js', () => ({
  resolveSupportBotCaller: mocks.resolveCaller,
}));
vi.mock('../../src/repos/supportBotConfirmationRepo.js', () => ({
  supportBotConfirmationRepo: { create: mocks.create, resolve: mocks.resolve },
}));
vi.mock('../../src/repos/supportBotGatewayRepo.js', () => ({
  supportBotGatewayRepo: { findChat: mocks.findChat },
}));

const ctx: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'support-bot-gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-confirm',
};

vi.mock('../../src/routes/v1/helpers.js', () => ({ requireContext: () => ctx }));

import { supportBotConfirmationRoutes } from '../../src/routes/v1/supportBotConfirmation.routes.js';

const token = 'a'.repeat(32);
const baseBody = {
  token,
  carrierId: 'carrier-a',
  chatId: '-1001',
  telegramUserId: '9001',
  messageId: '77',
};
const argumentsValue = { telegram_user_id: 9001, card_last6: '123456', action: 'deactivate' };
const row = {
  id: 'sbcf-1',
  tenantId: 'tenant-a',
  tokenHash: 'hashed-token',
  carrierId: 'carrier-a',
  chatId: '-1001',
  telegramUserId: '9001',
  messageId: '77',
  toolName: 'octane_card_action',
  arguments: argumentsValue,
  argumentsHash: 'exact-arguments-hash',
  status: 'consumed',
  expiresAt: new Date(Date.now() + 60_000),
  resolvedAt: new Date(),
  resolvedUpdateId: '500',
  createdAt: new Date(),
};

async function buildApp() {
  const app = Fastify({ logger: false });
  errorHandlerPlugin(app);
  app.decorate('supportBotGatewayAuth', async () => undefined);
  await app.register(supportBotConfirmationRoutes);
  return app;
}

describe('durable support-bot confirmation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findChat.mockResolvedValue({ enabled: true, carrierId: 'carrier-a' });
    mocks.resolveCaller.mockResolvedValue({ role: 'owner', registration: {} });
    mocks.create.mockResolvedValue({ ...row, status: 'pending', resolvedAt: null });
  });

  it('stores only a hashed token and binds the exact actor/tool arguments', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/confirmations',
      payload: { ...baseBody, toolName: 'octane_card_action', arguments: argumentsValue },
    });
    await app.close();

    expect(response.statusCode).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      expect.objectContaining({
        carrierId: 'carrier-a',
        chatId: '-1001',
        telegramUserId: '9001',
        messageId: '77',
        toolName: 'octane_card_action',
        arguments: argumentsValue,
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        argumentsHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(mocks.create.mock.calls[0]?.[1]?.tokenHash).not.toBe(token);
  });

  it('rejects actor substitution and role escalation before persistence', async () => {
    const app = await buildApp();
    const actorMismatch = await app.inject({
      method: 'POST',
      url: '/support-bot/confirmations',
      payload: {
        ...baseBody,
        toolName: 'octane_card_action',
        arguments: { ...argumentsValue, telegram_user_id: 9002 },
      },
    });
    mocks.resolveCaller.mockResolvedValue({ role: 'driver', registration: {} });
    const roleEscalation = await app.inject({
      method: 'POST',
      url: '/support-bot/confirmations',
      payload: { ...baseBody, toolName: 'octane_money_code', arguments: { telegram_user_id: 9001 } },
    });
    await app.close();

    expect(actorMismatch.statusCode).toBe(403);
    expect(roleEscalation.statusCode).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a tap bound to another actor, chat, carrier, or Telegram message', async () => {
    mocks.resolve.mockResolvedValue({ kind: 'scope_mismatch' });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/confirmations/resolve',
      payload: { ...baseBody, updateId: '500', decision: 'confirm' },
    });
    await app.close();

    expect(response.statusCode).toBe(403);
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-a' }),
      expect.objectContaining({
        carrierId: 'carrier-a',
        chatId: '-1001',
        telegramUserId: '9001',
        messageId: '77',
        updateId: '500',
        decision: 'confirm',
        tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
  });

  it('returns the same immutable action and turn id on safe duplicate replay', async () => {
    mocks.resolve.mockResolvedValue({ kind: 'replay', confirmation: row });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/confirmations/resolve',
      payload: { ...baseBody, updateId: '501', decision: 'confirm' },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      confirmed: true,
      confirmationId: 'sbcf-1',
      toolName: 'octane_card_action',
      arguments: argumentsValue,
      argumentsHash: 'exact-arguments-hash',
      turnId: 'confirmation:sbcf-1',
    });
  });

  it.each([
    ['expired', 410],
    ['already_resolved', 409],
    ['not_found', 404],
  ] as const)('maps %s confirmations to a fail-closed response', async (kind, statusCode) => {
    mocks.resolve.mockResolvedValue({ kind });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/confirmations/resolve',
      payload: { ...baseBody, updateId: '502', decision: 'confirm' },
    });
    await app.close();
    expect(response.statusCode).toBe(statusCode);
  });
});
