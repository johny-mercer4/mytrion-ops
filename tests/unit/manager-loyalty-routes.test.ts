/**
 * Manager Mytrion → Loyalty Program route (/v1/manager/loyalty/clients) — authorization.
 *
 * This is the one Manager read that is NOT owner-scoped: it returns EVERY carrier in the warehouse
 * with its fuel volume, across all agents. The `management` department gate is therefore the only
 * thing standing between a sales rep and the whole company book, so it gets its own regression suite
 * (CLAUDE.md rule 9). A 403 must also mean the DWH was never touched — not just that the body was
 * withheld after the query ran.
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

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchAllClients } from '../../src/integrations/dwhClientRoster.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const rosterMock = vi.mocked(fetchAllClients);

const SAMPLE = {
  carrierId: '5794015',
  companyName: 'KBUFF TRUCKING LTD',
  contact: 'Saimurod Makhmadiev',
  agentName: 'Diana Rose',
  phone: '3033195965',
  producedCards: 230,
  activeCards: 85,
  moneyCode: '3680',
  dot: '2959232',
  isLocSuspended: false,
  computedIsActive: true,
  computedDebt: 60493.31,
  computedDebtDays: 98,
  cycleGallons: 2712.5,
  gallonsThisMonth: 93171.08,
  activeCardsThisMonth: 70,
  transactionsThisMonth: 902,
  gallonsPrevMonth: 117186.96,
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

const LOYALTY_URL = '/v1/manager/loyalty/clients';

describe('loyalty roster is management-gated', () => {
  it('refuses an unauthenticated caller and never reads the DWH', async () => {
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL });
    expect(res.statusCode).toBe(401);
    expect(rosterMock).not.toHaveBeenCalled();
  });

  it('refuses a worker without the management department', async () => {
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

  it('allows a management worker and returns the roster envelope', async () => {
    rosterMock.mockResolvedValue([SAMPLE]);
    const token = await workerToken('Management');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { total: number; fetchedAt: string; clients: Record<string, unknown>[] };
    expect(body.total).toBe(1);
    expect(typeof body.fetchedAt).toBe('string');
    expect(rosterMock).toHaveBeenCalledTimes(1);
    // fetchAllClients takes NO arguments — there is no caller-controlled scope to tamper with.
    expect(rosterMock).toHaveBeenCalledWith();
  });
});

describe('header elevation cannot open the loyalty roster', () => {
  const attacks: Array<[string, Record<string, string>]> = [
    ['x-department-access: management', { 'x-department-access': 'management' }],
    ['x-all-departments: true', { 'x-all-departments': 'true' }],
    [
      'both headers at once',
      { 'x-department-access': 'management', 'x-all-departments': 'true' },
    ],
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
    const token = await workerToken('Management');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    const row = (res.json() as { clients: Record<string, unknown>[] }).clients[0]!;

    // Present: exactly the tier inputs the board renders.
    expect(Object.keys(row).sort()).toEqual(
      [
        'activeCards',
        'activeCardsThisMonth',
        'agentName',
        'carrierId',
        'companyName',
        'computedIsActive',
        'cycleGallons',
        'gallonsPrevMonth',
        'gallonsThisMonth',
      ].sort(),
    );
    // Absent: financial / PII columns that belong to Data Center → Clients, not the loyalty board.
    for (const leaked of ['computedDebt', 'computedDebtDays', 'phone', 'dot', 'moneyCode', 'contact']) {
      expect(row).not.toHaveProperty(leaked);
    }
  });

  it('orders by the tier gallons basis, heaviest first', async () => {
    rosterMock.mockResolvedValue([
      { ...SAMPLE, carrierId: 'a', companyName: 'Small', gallonsThisMonth: 100, cycleGallons: 0 },
      { ...SAMPLE, carrierId: 'b', companyName: 'Biggest', gallonsThisMonth: 9000, cycleGallons: 0 },
      // No pumps this month → the cycle figure is the basis, so this sorts between the two.
      { ...SAMPLE, carrierId: 'c', companyName: 'Cycle only', gallonsThisMonth: 0, cycleGallons: 4000 },
    ]);
    const token = await workerToken('Management');
    const res = await app.inject({ method: 'GET', url: LOYALTY_URL, headers: bearer(token) });
    const rows = (res.json() as { clients: { carrierId: string }[] }).clients;
    expect(rows.map((r) => r.carrierId)).toEqual(['b', 'c', 'a']);
  });
});
