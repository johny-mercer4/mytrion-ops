import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.TELEGRAM_CARRIER_BOT_TOKEN = 'test-bot-token';
  process.env.TELEGRAM_CARRIER_BOT_USERNAME = 'octane_test_bot';
});

vi.mock('../../src/db/client.js', () => ({
  db: {
    transaction: async <T>(fn: (tx: object) => Promise<T>): Promise<T> => fn({}),
  },
}));

vi.mock('../../src/repos/carrierInvitationRepo.js', () => ({
  carrierInvitationRepo: {
    create: vi.fn(),
    findById: vi.fn(),
    findLiveDriverByCard: vi.fn(),
    listPendingDriverInvitesByCarrier: vi.fn(async () => []),
    markRedeemed: vi.fn(),
  },
}));

vi.mock('../../src/repos/registeredMiniAppCompanyRepo.js', () => ({
  registeredMiniAppCompanyRepo: {
    findByTelegramUserId: vi.fn(),
    list: vi.fn(async () => []),
    listDriversByCarrier: vi.fn(async () => []),
    upsert: vi.fn(),
  },
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/integrations/telegramCarrierBot.js', () => ({
  verifyTelegramInitData: vi.fn(() => ({ ok: true, fields: {} })),
  parseInitDataUser: vi.fn(() => ({ id: 123456, username: 'fleet_owner' })),
  signTelegramInitData: vi.fn(() => 'signed-init-data'),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { carrierInvitationRepo } from '../../src/repos/carrierInvitationRepo.js';
import { registeredMiniAppCompanyRepo } from '../../src/repos/registeredMiniAppCompanyRepo.js';

const inviteRepo = vi.mocked(carrierInvitationRepo);
const registrationRepo = vi.mocked(registeredMiniAppCompanyRepo);

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
});

function inviteRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'inv_1',
    tenantId: DEFAULT_TENANT_ID,
    profile: 'owner' as const,
    carrierId: '5758544',
    applicationId: 'APP-9',
    companyName: 'Acme Transport LLC',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    cardId: null,
    driverName: null,
    companyType: 'fleet-manager' as const,
    cardCount: 3,
    status: 'pending' as const,
    redeemedCarrierUserId: null,
    expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function registrationRow(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 'rma_1',
    tenantId: DEFAULT_TENANT_ID,
    invitationId: 'inv_1',
    profile: 'owner' as const,
    telegramUserId: '123456',
    telegramChatId: null,
    telegramUsername: 'fleet_owner',
    carrierId: '5758544',
    applicationId: 'APP-9',
    companyName: 'Acme Transport LLC',
    agentName: 'Rep Riley',
    agentZohoUserId: '777',
    cardId: null,
    driverName: null,
    companyType: 'fleet-manager' as const,
    cardCount: 3,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('carrier mini-app redeem flow', () => {
  it('restores a registered mini-app session from Telegram identity without an invite link', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/session',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        profile: 'owner',
        carrierId: '5758544',
        agentName: 'Rep Riley',
      },
    });
  });

  it('restores the sales agent from the original invite for older registrations with null agent fields', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ agentName: null, agentZohoUserId: null }),
    );
    inviteRepo.findById.mockResolvedValueOnce(inviteRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/session',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        agentName: 'Rep Riley',
      },
    });
  });

  it('rejects owner-operator access to fleet-owner driver management endpoints', async () => {
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ companyType: 'owner-operator', cardCount: 1 }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/driver-invites',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed', cardId: 'card_1', driverName: 'James Reyes' },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: { code: 'NOT_A_REGISTERED_OWNER' },
    });
  });

  it('rejects rebinding an already-registered Telegram account to another carrier', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_conflict', carrierId: '999000' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(
      registrationRow({ carrierId: '5758544', applicationId: 'APP-9' }),
    );

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_conflict/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(409);
    expect(inviteRepo.markRedeemed).not.toHaveBeenCalled();
    expect(res.json()).toMatchObject({
      error: { code: 'TELEGRAM_ALREADY_REGISTERED' },
    });
  });

  it('returns alreadyRegistered for the same Telegram user reopening the same logical registration', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_reopen' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());
    inviteRepo.markRedeemed.mockResolvedValueOnce(undefined);

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_reopen/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      alreadyRegistered: true,
      registration: {
        id: 'rma_1',
        profile: 'owner',
        carrierId: '5758544',
      },
    });
    expect(registrationRepo.upsert).not.toHaveBeenCalled();
  });

  it('returns alreadyRegistered for the same Telegram user reopening a redeemed invite after it expires', async () => {
    inviteRepo.findById.mockResolvedValueOnce(
      inviteRow({
        id: 'inv_redeemed_expired',
        status: 'redeemed',
        expiresAt: new Date(Date.now() - 60_000),
      }),
    );
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_redeemed_expired/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      alreadyRegistered: true,
      registration: {
        id: 'rma_1',
        profile: 'owner',
        carrierId: '5758544',
      },
    });
    expect(inviteRepo.markRedeemed).not.toHaveBeenCalled();
    expect(registrationRepo.upsert).not.toHaveBeenCalled();
  });

  it('persists and returns the company sales agent on a fresh redeem', async () => {
    inviteRepo.findById.mockResolvedValueOnce(inviteRow({ id: 'inv_agent' }));
    registrationRepo.findByTelegramUserId.mockResolvedValueOnce(undefined);
    inviteRepo.markRedeemed.mockResolvedValueOnce(inviteRow({ id: 'inv_agent', status: 'redeemed' }));
    registrationRepo.upsert.mockResolvedValueOnce(registrationRow());

    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations/inv_agent/redeem',
      headers: { 'content-type': 'application/json' },
      payload: { initData: 'signed' },
    });

    expect(res.statusCode).toBe(201);
    expect(registrationRepo.upsert).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        invitationId: 'inv_agent',
        agentName: 'Rep Riley',
        agentZohoUserId: '777',
      }),
      expect.anything(),
    );
    expect(res.json()).toMatchObject({
      registration: {
        id: 'rma_1',
        agentName: 'Rep Riley',
      },
    });
  });
});
