/**
 * Manager EFS Console — the four things that must not regress.
 *
 *  1. **Writes are inert.** `FF_MANAGER_EFS_WRITES_ENABLED` is off and no action key is armed, so
 *     no action may reach servercrm. This suite asserts the serverCrm client is NEVER called from
 *     an action route — not that a nice message came back. These are money-moving endpoints that
 *     have never been sent to EFS; the gate is the whole safety story right now.
 *  2. **Carrier scope.** A carrier with no `octane.dim_company` row is refused with 404 before any
 *     vendor traffic. This is what keeps the console a client tool rather than a general EFS proxy.
 *  3. **Window ceilings.** EFS 400s on an over-wide range rather than clamping, so 7d/90d are
 *     enforced here, before the call.
 *  4. **Money codes are redacted.** An unredeemed code is a bearer instrument; the digits must
 *     never leave the server. See modules/manager/efsConsole/redact.ts.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
  process.env.SERVER_CRM_URL = 'https://servercrm.test';
  process.env.SERVER_CRM_KEY = 'test-crm-key';
  // The console's own gate, explicitly off — this is the default and the suite depends on it.
  process.env.FF_MANAGER_EFS_WRITES_ENABLED = '0';
  process.env.MANAGER_EFS_LIVE_ACTIONS = '';
});

vi.mock('../../src/integrations/serverCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/serverCrm.js')>();
  return {
    ...mod,
    serverCrm: { get: vi.fn(async () => ({ success: true })), post: vi.fn(async () => ({ success: true })) },
  };
});
vi.mock('../../src/integrations/dwh.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/dwh.js')>();
  return { ...mod, dwh: { ...mod.dwh, query: vi.fn(async () => []) } };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { dwh } from '../../src/integrations/dwh.js';
import { serverCrm } from '../../src/integrations/serverCrm.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { EFS_ACTIONS } from '../../src/modules/manager/efsConsole/actions.js';
import { EFS_FETCHERS } from '../../src/modules/manager/efsConsole/fetchers.js';
import { redactMoneyCodes } from '../../src/modules/manager/efsConsole/redact.js';

const crm = vi.mocked(serverCrm) as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const dwhQuery = vi.mocked(dwh.query);

/** dim_company row shape the roster reads. */
const CLIENT_ROW = {
  carrier_id: '5724546',
  company_name: 'ENERGY TRUCKING LLC',
  contract_id: '901',
  is_active: 1,
  is_debtor: false,
  is_loc_suspended: false,
  total_active_cards: 37,
  total_produced_cards: 40,
  credit_limit: '5000',
  debt_amount: '0',
  agent: 'Diana Rose',
  tier_name: 'Gold',
  last_transaction_date: new Date('2026-08-05T00:00:00Z'),
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
  crm.get.mockResolvedValue({ success: true });
  crm.post.mockResolvedValue({ success: true });
  // Default: the carrier IS a client.
  dwhQuery.mockResolvedValue([CLIENT_ROW] as never);
});

async function token(profile = 'Management'): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: '42', userName: 'Robiya', profile },
  });
}
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('the console is management-gated', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/manager/efs/clients' });
    expect(res.statusCode).toBe(401);
    expect(crm.get).not.toHaveBeenCalled();
  });

  it('refuses a non-manager and never reaches EFS', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/parent.snapshot',
      headers: bearer(await token('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(crm.get).not.toHaveBeenCalled();
  });
});

describe('writes are inert', () => {
  it.each(EFS_ACTIONS.map((a) => a.key))('never sends %s to servercrm', async (key) => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/manager/efs/actions/${key}`,
      headers: bearer(await token()),
      // Deliberately a plausible money-moving body. It must not matter.
      payload: { carrierId: '5724546', contractId: '901', amount: 500, refNum: 'TEST-1' },
    });
    // Either the schema rejects it (400) or it previews (200). Never an execution.
    expect([200, 400]).toContain(res.statusCode);
    expect(crm.post).not.toHaveBeenCalled();
  });

  it('previews a valid action instead of executing it', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/efs/actions/funding.topup',
      headers: bearer(await token()),
      payload: { carrierId: '5724546', contractId: '901', amount: 500, refNum: 'TP-1' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { preview: Record<string, unknown> };
    expect(body.preview.executed).toBe(false);
    expect(body.preview.reason).toBe('writes_disabled');
    expect(body.preview.wouldCall).toBe('POST /api/efs/console/actions/topup');
    expect(body.preview.wouldSend).toMatchObject({ amount: 500, refNum: 'TP-1' });
    expect(crm.post).not.toHaveBeenCalled();
  });

  it('still validates the body while inert — a bad payload is a 400, not a cheerful preview', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/efs/actions/funding.topup',
      headers: bearer(await token()),
      payload: { carrierId: '5724546', contractId: '901', amount: -500, refNum: 'TP-1' },
    });
    expect(res.statusCode).toBe(400);
    expect(crm.post).not.toHaveBeenCalled();
  });

  it('reports writes disabled through /capabilities, with no action live', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/capabilities',
      headers: bearer(await token()),
    });
    const body = res.json() as {
      writes: { mode: string; liveActions: string[] };
      actions: Array<{ live: boolean }>;
    };
    expect(body.writes.mode).toBe('disabled');
    expect(body.writes.liveActions).toEqual([]);
    expect(body.actions.every((a) => a.live === false)).toBe(true);
  });
});

describe('carrier scope', () => {
  it('refuses a carrier with no dim_company row, before any vendor call', async () => {
    dwhQuery.mockResolvedValue([] as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/carrier.snapshot?carrierId=9999999',
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error?.message ?? res.body).toContain('not an Octane client');
    expect(crm.get).not.toHaveBeenCalled();
  });

  it('applies the same gate to writes', async () => {
    dwhQuery.mockResolvedValue([] as never);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/efs/actions/cards.pin',
      headers: bearer(await token()),
      payload: { carrierId: '9999999', cardNumber: '123', pin: '1234' },
    });
    expect(res.statusCode).toBe(404);
    expect(crm.post).not.toHaveBeenCalled();
  });

  it('lets a real client through to the vendor', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/carrier.snapshot?carrierId=5724546',
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(200);
    expect(crm.get).toHaveBeenCalledWith('/api/efs/console/fetchers/carrier/5724546/snapshot', {});
  });
});

describe('window ceilings are enforced before the call', () => {
  it('refuses an 8-day range on a 7-day endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/carrier.transactions?carrierId=5724546&from=2026-08-01T00:00:00Z&to=2026-08-09T00:00:00Z',
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(400);
    expect(crm.get).not.toHaveBeenCalled();
  });

  it('accepts a 7-day range on the same endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/carrier.transactions?carrierId=5724546&from=2026-08-01T00:00:00Z&to=2026-08-08T00:00:00Z',
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(200);
    expect(crm.get).toHaveBeenCalled();
  });

  it('refuses a 91-day range on a 90-day endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/loads.byCarrier?carrierId=5724546&from=2026-05-01T00:00:00Z&to=2026-07-31T00:00:00Z',
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(400);
    expect(crm.get).not.toHaveBeenCalled();
  });
});

describe('endpoints known to be broken upstream', () => {
  /*
   * Probed live on 2026-08-06. All five fail inside EFS's SOAP stack with an ADBException, so they
   * are refused here with a 503 naming the exact upstream error rather than costing a round trip
   * and surfacing as a generic 502. They stay in the catalog because they are part of the vendor
   * surface and will presumably be fixed; the health flag is how the UI knows not to offer them.
   */
  const BROKEN = [
    'carrier.rejects',
    'carrier.locationsSearch',
    'carrier.geoPrices',
    'carrier.interstatePrices',
    'carrier.orderCards',
  ];

  it('flags exactly the endpoints verified broken against prod', () => {
    expect(EFS_FETCHERS.filter((f) => f.health === 'broken').map((f) => f.key).sort()).toEqual(
      [...BROKEN].sort(),
    );
    for (const key of BROKEN) {
      expect(EFS_FETCHERS.find((f) => f.key === key)?.brokenReason).toMatch(/ADBException/);
    }
  });

  it.each(BROKEN)('refuses %s without spending a vendor round trip', async (key) => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/manager/efs/fetch/${key}?carrierId=5724546&orderId=1`,
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(503);
    expect(crm.get).not.toHaveBeenCalled();
  });

  it('refuses carrier.rejects with a specific reason rather than a spinner then a 502', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/efs/fetch/carrier.rejects?carrierId=5724546',
      headers: bearer(await token()),
    });
    expect(res.statusCode).toBe(503);
    expect(res.body).toContain('ADBException');
    expect(crm.get).not.toHaveBeenCalled();
  });
});

describe('money codes are redacted', () => {
  it('strips the digits from every code-bearing row, wherever it sits', () => {
    const out = redactMoneyCodes({
      success: true,
      data: [
        { codeId: 'c1', code: '9988776655', amount: 500 },
        { codeId: 'c2', alphaCode: 'ABCD1234', amount: 250 },
      ],
      raw: { nested: { deeper: [{ codeId: 'c3', moneyCode: '1112223334' }] } },
    }) as Record<string, unknown>;

    const json = JSON.stringify(out);
    expect(json).not.toContain('9988776655');
    expect(json).not.toContain('ABCD1234');
    expect(json).not.toContain('1112223334');
    // Last four survive for reconciliation; the safe handle survives untouched.
    expect(json).toContain('••••6655');
    expect(json).toContain('c1');
  });

  it('leaves payloads without codes alone', () => {
    const input = { success: true, data: [{ carrierId: '1', amount: 5 }] };
    expect(redactMoneyCodes(input)).toEqual(input);
  });

  it('wires redaction onto both money-code read paths', () => {
    for (const key of ['moneyCodes.list', 'moneyCodes.detail']) {
      expect(EFS_FETCHERS.find((f) => f.key === key)?.redact).toBeTypeOf('function');
    }
  });
});

describe('catalog integrity', () => {
  it('has unique fetcher and action keys', () => {
    const fKeys = EFS_FETCHERS.map((f) => f.key);
    const aKeys = EFS_ACTIONS.map((a) => a.key);
    expect(new Set(fKeys).size).toBe(fKeys.length);
    expect(new Set(aKeys).size).toBe(aKeys.length);
  });

  it('declares the full vendor action surface', () => {
    // The documented console exposes 30 writes. Audited against the LIVE `GET /api/efs/console`
    // catalog on 2026-08-06: 30/30 declared, zero undeclared, zero orphans. If servercrm grows one
    // and it is not declared here, it is unreachable AND ungated — this is the tripwire for that.
    expect(EFS_ACTIONS.length).toBe(30);
  });

  it('declares the full vendor READ surface', () => {
    // 14 parent + 36 carrier. Audited against the live catalog: every one of its 42 entries (some
    // written as globs like `locations/*` and `products|product-groups|prompt-types`) is covered.
    expect(EFS_FETCHERS.length).toBe(50);
    expect(EFS_FETCHERS.filter((f) => f.side === 'parent').length).toBe(14);
    expect(EFS_FETCHERS.filter((f) => f.side === 'carrier').length).toBe(36);
  });

  it('nests the price and location reads under locations/, where the vendor actually serves them', () => {
    // The bare paths 404. Probed both spellings on 2026-08-06 to settle the doc's `·` shorthand.
    for (const key of ['carrier.locationsSearch', 'carrier.geoPrices', 'carrier.interstatePrices']) {
      expect(EFS_FETCHERS.find((f) => f.key === key)?.path).toContain('/locations/');
    }
  });

  it('gives every action a UI home or an explicit null', () => {
    for (const action of EFS_ACTIONS) {
      expect(['cards', 'money-codes', null]).toContain(action.ui);
    }
  });

  it('marks every money-moving action as money or destructive, never plain write', () => {
    const funding = EFS_ACTIONS.filter((a) => a.group === 'funding' || a.group === 'smartpay');
    expect(funding.length).toBeGreaterThan(0);
    for (const action of funding) {
      expect(['money', 'destructive']).toContain(action.riskClass);
    }
  });

  it('gives every carrier-scoped fetcher a :carrierId placeholder', () => {
    for (const f of EFS_FETCHERS.filter((x) => x.side === 'carrier')) {
      expect(f.path).toContain(':carrierId');
    }
  });
});
