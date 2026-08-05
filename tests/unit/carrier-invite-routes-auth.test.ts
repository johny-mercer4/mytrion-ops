import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.DWH_DATABASE_URL = 'postgres://dwh-test/stub';
  process.env.TELEGRAM_CARRIER_BOT_USERNAME = 'octane_test_bot';
});

vi.mock('../../src/integrations/dwhClientRoster.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhClientRoster.js')>();
  return {
    ...mod,
    fetchAgentClients: vi.fn(async () => []),
    isCarrierOwned: vi.fn(async () => false),
  };
});

vi.mock('../../src/integrations/dwhCards.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhCards.js')>();
  return {
    ...mod,
    countDwhCards: vi.fn(async () => 1),
    listDwhCards: vi.fn(async () => []),
  };
});

vi.mock('../../src/repos/carrierInvitationRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/carrierInvitationRepo.js')>();
  return {
    ...mod,
    carrierInvitationRepo: {
      ...mod.carrierInvitationRepo,
      create: vi.fn(async (_ctx, input) => ({
        id: 'inv_test',
        tenantId: 'octane',
        profile: input.profile,
        carrierId: input.carrierId ?? null,
        applicationId: input.applicationId ?? null,
        companyName: input.companyName ?? null,
        cardId: input.cardId ?? null,
        driverName: input.driverName ?? null,
        companyType: input.companyType ?? null,
        cardCount: input.cardCount ?? null,
        agentName: input.agentName ?? null,
        agentZohoUserId: input.agentZohoUserId ?? null,
        status: 'pending',
        redeemedCarrierUserId: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  };
});

vi.mock('../../src/repos/salesAgentMiniAppRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/salesAgentMiniAppRepo.js')>();
  return {
    ...mod,
    salesAgentMiniAppRepo: {
      ...mod.salesAgentMiniAppRepo,
      createInvitation: vi.fn(async (ctx, input) => ({
        id: 'sai_test',
        tenantId: ctx.tenantId,
        zohoUserId: input.zohoUserId,
        agentName: input.agentName,
        requestedCarrierId: input.requestedCarrierId ?? null,
        status: 'pending' as const,
        redeemedTelegramUserId: null,
        expiresAt: new Date(Date.now() + 30 * 60_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
    },
  };
});

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

vi.mock('../../src/modules/auth/actAsDirectory.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/auth/actAsDirectory.js')>();
  return {
    ...mod,
    resolveActAsTarget: vi.fn(async (id: string) =>
      id === '999'
        ? {
            zohoUserId: '999',
            name: 'Frank Harrison',
            email: null,
            profile: 'Sales Agent',
            role: null,
          }
        : null,
    ),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { listDwhCards } from '../../src/integrations/dwhCards.js';
import {
  fetchAgentClients,
  isCarrierOwned,
  type AgentClientRow,
} from '../../src/integrations/dwhClientRoster.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { carrierInvitationRepo } from '../../src/repos/carrierInvitationRepo.js';
import { salesAgentMiniAppRepo } from '../../src/repos/salesAgentMiniAppRepo.js';

const clientsMock = vi.mocked(fetchAgentClients);
const carrierOwnedMock = vi.mocked(isCarrierOwned);
const listDwhCardsMock = vi.mocked(listDwhCards);
const createInviteMock = vi.mocked(carrierInvitationRepo.create);
const createAgentInviteMock = vi.mocked(salesAgentMiniAppRepo.createInvitation);

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
  clientsMock.mockResolvedValue([]);
  carrierOwnedMock.mockResolvedValue(false);
});

async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function activeClient(overrides: Partial<AgentClientRow> = {}): AgentClientRow {
  return {
    carrierId: '123',
    companyName: 'Acme Trucking',
    contact: 'Jane Doe',
    agentName: 'Robiya',
    phone: '555-0100',
    producedCards: 1,
    activeCards: 1,
    lastTierName: 'Silver',
    moneyCode: 'MC-1',
    dot: '12345',
    trucks: 1,
    isLocSuspended: false,
    computedIsActive: true,
    computedDebt: 0,
    computedDebtDays: 0,
    cycleGallons: 1200,
    gallonsThisMonth: 500,
    inNetworkGallonsThisMonth: 480,
    activeCardsThisMonth: 1,
    transactionsThisMonth: 40,
    gallonsPrevMonth: 450,
    inNetworkGallonsPrevMonth: 425,
    activeCardsPrevMonth: 1,
    ...overrides,
  };
}

describe('carrier registration links — Sales write scope + View-as', () => {
  it('refuses a non-Sales worker before checking or creating an invite', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations',
      headers: bearer(await workerToken('Billing Clerk')),
      payload: { profile: 'owner', carrier_id: '123' },
    });
    expect(res.statusCode).toBe(403);
    expect(clientsMock).not.toHaveBeenCalled();
    expect(createInviteMock).not.toHaveBeenCalled();
  });

  it('applies Admin View-as and blocks the target agent from inviting a debtor', async () => {
    clientsMock.mockResolvedValue([
      activeClient({ agentName: 'Frank Harrison', computedDebt: 500, computedDebtDays: 3 }),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations',
      headers: {
        ...bearer(await workerToken('Administrator', '1')),
        'x-act-as-zoho-user-id': '999',
      },
      payload: { profile: 'owner', carrier_id: '123' },
    });
    expect(res.statusCode).toBe(409);
    expect(clientsMock).toHaveBeenCalledWith('999', 'Frank Harrison', {
      force: true,
      allowStaleOnError: false,
    });
    expect(createInviteMock).not.toHaveBeenCalled();
  });

  it('applies Admin View-as to carrier reads instead of keeping the admin bypass', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/carrier-users/dwh-cards?carrier_id=987',
      headers: {
        ...bearer(await workerToken('Administrator', '1')),
        'x-act-as-zoho-user-id': '999',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(carrierOwnedMock).toHaveBeenCalledWith('999', 'Frank Harrison', '987');
    expect(listDwhCardsMock).not.toHaveBeenCalled();
  });

  it('ignores spoofed metadata for a Sales worker and stores verified attribution', async () => {
    clientsMock.mockResolvedValue([activeClient()]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier-invitations',
      headers: bearer(await workerToken('Sales Rep')),
      payload: {
        profile: 'owner',
        carrier_id: '123',
        company_name: 'Spoofed Company',
        agent_name: 'Spoofed Agent',
        agent_zoho_user_id: '999',
        ttl_hours: 720,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    expect(createInviteMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        carrierId: '123',
        companyName: 'Acme Trucking',
        agentName: 'Robiya',
        agentZohoUserId: '42',
      }),
    );
    expect(createInviteMock.mock.calls.at(-1)?.[1]).not.toHaveProperty('ttlHours');
  });

  it('creates a self-registration launch for an active company in the Sales agent roster', async () => {
    clientsMock.mockResolvedValue([
      activeClient({ computedDebt: 500, computedDebtDays: 3 }),
    ]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/sales-agent-invitations',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { carrier_id: '123' },
    });

    expect(res.statusCode, res.body).toBe(201);
    expect(createAgentInviteMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:42', userName: 'Robiya' }),
      expect.objectContaining({
        zohoUserId: '42',
        agentName: 'Robiya',
        requestedCarrierId: '123',
      }),
    );
  });

  it('requires Admin View before an administrator can create a Sales-agent self-registration', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/sales-agent-invitations',
      headers: bearer(await workerToken('Administrator', '1')),
      payload: {},
    });

    expect(res.statusCode).toBe(403);
    expect(createAgentInviteMock).not.toHaveBeenCalled();
  });

  it('uses the verified Admin View target identity for Sales-agent registration', async () => {
    clientsMock.mockResolvedValue([activeClient({ agentName: 'Frank Harrison' })]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/carrier/mini-app/sales-agent-invitations',
      headers: {
        ...bearer(await workerToken('Administrator', '1')),
        'x-act-as-zoho-user-id': '999',
      },
      payload: { carrier_id: '123' },
    });

    expect(res.statusCode, res.body).toBe(201);
    expect(createAgentInviteMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'zoho:999', userName: 'Frank Harrison' }),
      expect.objectContaining({ zohoUserId: '999', agentName: 'Frank Harrison' }),
    );
  });
});
