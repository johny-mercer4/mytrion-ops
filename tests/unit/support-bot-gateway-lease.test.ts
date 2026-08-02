import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideGatewayLease } from '../../src/modules/carrier/supportBotGatewayLeasePolicy.js';
import { errorHandlerPlugin } from '../../src/plugins/errorHandler.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const mocks = vi.hoisted(() => ({
  acquire: vi.fn(),
  release: vi.fn(),
  audit: vi.fn(async () => undefined),
}));

vi.mock('../../src/repos/supportBotGatewayLeaseRepo.js', () => ({
  supportBotGatewayLeaseRepo: { acquire: mocks.acquire, release: mocks.release },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: mocks.audit,
}));

const ctx: TenantContext = {
  tenantId: 'tenant-a',
  userId: 'support-bot-gateway',
  audience: 'customer',
  role: 'fleet_manager',
  scopes: [],
  departments: [],
  allDepartmentAccess: false,
  requestId: 'req-lease',
};
vi.mock('../../src/routes/v1/helpers.js', () => ({ requireContext: () => ctx }));

import { supportBotGatewayLeaseRoutes } from '../../src/routes/v1/supportBotGatewayLease.routes.js';

function lease(overrides: Record<string, unknown> = {}) {
  return {
    id: 'lease-1',
    tenantId: 'tenant-a',
    botIdentity: 'octane-bot',
    holderId: 'instance-a',
    fencingToken: 7,
    expiresAt: new Date('2026-07-31T12:01:00.000Z'),
    createdAt: new Date('2026-07-31T12:00:00.000Z'),
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    ...overrides,
  };
}

async function buildApp() {
  const app = Fastify({ logger: false });
  errorHandlerPlugin(app);
  app.decorate('supportBotGatewayAuth', async () => undefined);
  await app.register(supportBotGatewayLeaseRoutes);
  return app;
}

describe('gateway lease fencing policy', () => {
  const now = new Date('2026-07-31T12:00:30.000Z');

  it('keeps a second live holder in standby', () => {
    expect(decideGatewayLease(lease(), 'instance-b', now)).toEqual({
      acquired: false,
      changedHolder: false,
      fencingToken: 7,
    });
  });

  it('renews the same holder without changing its fencing token', () => {
    expect(decideGatewayLease(lease(), 'instance-a', now)).toEqual({
      acquired: true,
      changedHolder: false,
      fencingToken: 7,
    });
  });

  it('lets a standby take an expired lease with a higher fence', () => {
    expect(decideGatewayLease(
      lease({ expiresAt: new Date('2026-07-31T12:00:29.000Z') }),
      'instance-b',
      now,
    )).toEqual({ acquired: true, changedHolder: true, fencingToken: 8 });
  });
});

describe('gateway lease service routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the repository lease and audits only a leadership change', async () => {
    mocks.acquire.mockResolvedValue({ acquired: true, changedHolder: true, lease: lease() });
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/gateway-lease/acquire',
      payload: { botIdentity: 'octane-bot', holderId: 'instance-a', ttlSeconds: 45 },
    });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ acquired: true, fencingToken: 7 });
    expect(mocks.acquire).toHaveBeenCalledWith(ctx, {
      botIdentity: 'octane-bot',
      holderId: 'instance-a',
      ttlSeconds: 45,
    });
    expect(mocks.audit).toHaveBeenCalledWith(ctx, expect.objectContaining({
      action: 'support_bot.gateway_lease.acquire',
    }));
  });

  it('releases only the exact holder and fencing token', async () => {
    mocks.release.mockResolvedValue(true);
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/support-bot/gateway-lease/release',
      payload: { botIdentity: 'octane-bot', holderId: 'instance-a', fencingToken: 7 },
    });
    await app.close();

    expect(response.json()).toEqual({ released: true });
    expect(mocks.release).toHaveBeenCalledWith(ctx, {
      botIdentity: 'octane-bot',
      holderId: 'instance-a',
      fencingToken: 7,
    });
  });
});
