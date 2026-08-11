/**
 * Marketing Mytrion → Loyalty Program route (/v1/marketing/loyalty/clients) — authorization.
 *
 * This read is NOT owner-scoped: it returns EVERY carrier in the warehouse with its fuel volume,
 * across all agents. The `marketing` department gate is therefore the only thing standing between a
 * sales rep and the whole company book, so it gets its own regression suite (CLAUDE.md rule 9). A 403
 * must also mean the DWH was never touched — not just that the body was withheld after the query ran.
 *
 * The route moved off `/v1/manager/*` and off the `management` department when Loyalty left the
 * Manager hub. `management` is now REFUSED here, which is the migration's actual behavioural claim
 * and is asserted below — an alias would have left it as a standing second key into this data.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/integrations/dwhClientRoster.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwhClientRoster.js')>();
  return { ...mod, fetchAllClients: vi.fn(async () => []) };
});
vi.mock('../../src/repos/loyaltyClientOverrideRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/loyaltyClientOverrideRepo.js')>();
  return {
    ...mod,
    loyaltyClientOverrideRepo: {
      ...mod.loyaltyClientOverrideRepo,
      list: vi.fn(async () => []),
      upsert: vi.fn(),
      remove: vi.fn(async () => false),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchAllClients } from '../../src/integrations/dwhClientRoster.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { loyaltyClientOverrideRepo } from '../../src/repos/loyaltyClientOverrideRepo.js';

const rosterMock = vi.mocked(fetchAllClients);
const overrideListMock = vi.mocked(loyaltyClientOverrideRepo.list);
const overrideUpsertMock = vi.mocked(loyaltyClientOverrideRepo.upsert);
const overrideRemoveMock = vi.mocked(loyaltyClientOverrideRepo.remove);

const SAMPLE = {
  carrierId: '5794015',
  companyName: 'KBUFF TRUCKING LTD',
  contact: 'Saimurod Makhmadiev',
  agentName: 'Diana Rose',
  phone: '3033195965',
  producedCards: 230,
  activeCards: 85,
  lastTierName: 'Gold',
  moneyCode: '3680',
  dot: '2959232',
  trucks: 1,
  isLocSuspended: false,
  computedIsActive: true,
  computedDebt: 60493.31,
  computedDebtDays: 98,
  cycleGallons: 2712.5,
  gallonsThisMonth: 93171.08,
  inNetworkGallonsThisMonth: 90000,
  activeCardsThisMonth: 70,
  transactionsThisMonth: 902,
  gallonsPrevMonth: 117186.96,
  inNetworkGallonsPrevMonth: 112000,
  activeCardsPrevMonth: 67,
};

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
  rosterMock.mockResolvedValue([]);
  overrideListMock.mockResolvedValue([]);
});

/** A verified worker session. `profile` drives the department grant (substring match). */
async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId, userName: 'Robiya', profile },
  });
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const LOYALTY_URL = '/v1/marketing/loyalty/clients';

describe('loyalty roster is marketing-gated', () => {
  it('refuses an unauthenticated caller and never reads the DWH', async () => {
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL });
    expect(res.statusCode).toBe(401);
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('refuses a worker without the marketing department', async () => {
    const token = await workerToken('Billing Clerk');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('refuses a sales rep — the company-wide book is not theirs to read', async () => {
    const token = await workerToken('Sales Rep');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('refuses a management worker — the roster moved out of the Manager hub', async () => {
    // The migration's actual behavioural claim. `management` used to be the key to this data and is
    // now just another department; if this ever goes green the old gate has been left in place.
    const token = await workerToken('Management');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(403);
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('allows a marketing worker and returns the roster envelope', async () => {
    rosterMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      total: number;
      fetchedAt: string;
      clients: Record<string, unknown>[];
    };
    expect(body.total).toBe(1);
    expect(typeof body.fetchedAt).toBe('string');
    expect(rosterMock).toHaveBeenCalledTimes(1);
    // The only argument is an internal cache-refresh flag — there is no owner scope to tamper with.
    expect(rosterMock).toHaveBeenCalledWith({ force: false });
  });

  it('forces the cached DWH snapshot only for an explicit Refresh', async () => {
    rosterMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Marketing');
    const res = await app.inject({
      method: 'GET',
      url: `${LOYALTY_URL}?refresh=1`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(rosterMock).toHaveBeenCalledWith({ force: true });
  });

  it('reports a DWH failure as a retryable 502 instead of a generic 500', async () => {
    rosterMock.mockRejectedValueOnce(new Error('statement timeout'));
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ error: { code: 'LOYALTY_DATA_UNAVAILABLE' } });
  });

  it('keeps the automatic loyalty roster available when override storage is unavailable', async () => {
    rosterMock.mockResolvedValue([SAMPLE]);
    overrideListMock.mockRejectedValueOnce(new Error('relation does not exist'));
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      clients: [{ carrierId: SAMPLE.carrierId, loyaltyOverride: null }],
    });
  });
});

describe('header elevation cannot open the loyalty roster', () => {
  const attacks: Array<[string, Record<string, string>]> = [
    ['x-department-access: marketing', { 'x-department-access': 'marketing' }],
    ['x-all-departments: true', { 'x-all-departments': 'true' }],
    ['both headers at once', { 'x-department-access': 'marketing', 'x-all-departments': 'true' }],
  ];

  for (const [label, headers] of attacks) {
    it(`a verified sales rep asserting ${label} is still refused`, async () => {
      const token = await workerToken('Sales Rep');
      const res = await app.inject({
        method: 'GET',
        url: LOYALTY_URL,
        headers: { ...bearer(token), ...headers },
      });
      expect(res.statusCode).toBe(403);
      expect(rosterMock).not.toHaveBeenCalled();
    });
  }
});

describe('the trimmed projection never leaks Clients-tab fields', () => {
  it('drops debt / phone / DOT / money-code from every row', async () => {
    rosterMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    const row = (res.json() as { clients: Record<string, unknown>[] }).clients[0]!;

    // Present: exactly the tier inputs the board renders.
    expect(Object.keys(row).sort()).toEqual(
      [
        'activeCards',
        // The MEMBERSHIP GATE: prev-month transacting cards, per the Loyalty Tiers v3 deck. Also the
        // fallback bucketer when `trucks` is unknown. A tier input, not a Clients-tab leak.
        'activeCardsPrevMonth',
        'activeCardsThisMonth',
        'agentName',
        'carrierId',
        'companyName',
        'computedIsActive',
        'cycleGallons',
        'gallonsPrevMonth',
        'gallonsThisMonth',
        'inNetworkGallonsPrevMonth',
        'inNetworkGallonsThisMonth',
        'lastTierName',
        'loyaltyOverride',
        // Declared trucks remain reference context; the track uses closed-month transacting cards.
        'trucks',
      ].sort(),
    );
    // Absent: financial / PII columns that belong to Data Center → Clients, not the loyalty board.
    for (const leaked of [
      'computedDebt',
      'computedDebtDays',
      'phone',
      'dot',
      'moneyCode',
      'contact',
    ]) {
      expect(row).not.toHaveProperty(leaked);
    }
  });

  it('orders by closed-month in-network tier gallons, heaviest first', async () => {
    rosterMock.mockResolvedValue([
      { ...SAMPLE, carrierId: 'a', companyName: 'Small', inNetworkGallonsPrevMonth: 100 },
      { ...SAMPLE, carrierId: 'b', companyName: 'Biggest', inNetworkGallonsPrevMonth: 9000 },
      { ...SAMPLE, carrierId: 'c', companyName: 'Medium', inNetworkGallonsPrevMonth: 4000 },
    ]);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    const rows = (res.json() as { clients: { carrierId: string }[] }).clients;
    expect(rows.map((r) => r.carrierId)).toEqual(['b', 'c', 'a']);
  });
});

describe('per-client loyalty controls', () => {
  const URL = '/v1/marketing/loyalty/clients/5794015/rewards';

  it('saves an audited reward checklist and Enterprise target for a marketing user', async () => {
    const updatedAt = new Date('2026-07-31T12:00:00Z');
    overrideUpsertMock.mockResolvedValue({
      id: 'lco_test',
      tenantId: DEFAULT_TENANT_ID,
      carrierId: '5794015',
      companyName: 'KBUFF TRUCKING LTD',
      enterpriseMode: 'volume_target',
      enterpriseGoldTargetGallons: '23000.00',
      enabledRewardIds: ['transaction_fee_waiver', 'loves_rebate'],
      note: 'Contract exception',
      updatedBy: 'Robiya',
      createdAt: updatedAt,
      updatedAt,
    });
    const token = await workerToken('Marketing');
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: bearer(token),
      payload: {
        companyName: 'KBUFF TRUCKING LTD',
        enterpriseMode: 'volume_target',
        enterpriseGoldTargetGallons: 23000,
        enabledRewardIds: ['transaction_fee_waiver', 'loves_rebate'],
        note: 'Contract exception',
      },
    });
    expect(res.statusCode).toBe(200);
    expect(overrideUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({
        carrierId: '5794015',
        enterpriseGoldTargetGallons: '23000.00',
        enabledRewardIds: ['transaction_fee_waiver', 'loves_rebate'],
      }),
    );
    expect(res.json()).toMatchObject({
      override: {
        carrierId: '5794015',
        enterpriseGoldTargetGallons: 23000,
        enabledRewardIds: ['transaction_fee_waiver', 'loves_rebate'],
      },
    });
  });

  it('resets the carrier to the automatic program', async () => {
    overrideRemoveMock.mockResolvedValue(true);
    const token = await workerToken('Marketing');
    const res = await app.inject({ method: 'DELETE', url: URL, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ removed: true });
  });

  it('rejects a volume target without a positive gallon target', async () => {
    const token = await workerToken('Marketing');
    const res = await app.inject({
      method: 'PATCH',
      url: URL,
      headers: bearer(token),
      payload: {
        companyName: 'KBUFF TRUCKING LTD',
        enterpriseMode: 'volume_target',
        enterpriseGoldTargetGallons: null,
        enabledRewardIds: null,
        note: null,
      },
    });
    expect(res.statusCode).toBe(400);
    expect(overrideUpsertMock).not.toHaveBeenCalled();
  });
});
