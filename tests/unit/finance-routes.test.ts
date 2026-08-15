/**
 * Finance Mytrion routes (/v1/finance/*) — authorization.
 *
 * These expose company-wide financial data: every carrier's outstanding balance, their CMP invoices,
 * and our own payment ledger. None of it is owner-scoped, so the `finance` department gate is the
 * only thing between a sales rep and the whole receivables book. A 403 must also mean the warehouse
 * was never queried — not just that the body was withheld after the fact.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/modules/finance/financeClients.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/finance/financeClients.js')>();
  return { ...mod, fetchFinanceClients: vi.fn(async () => []), fetchFinanceClientDetail: vi.fn(async () => null) };
});
vi.mock('../../src/modules/finance/financeCarrier.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/finance/financeCarrier.js')>();
  return {
    ...mod,
    fetchCarrierInvoices: vi.fn(async () => ({ invoices: [], totalOutstanding: 0, openCount: 0 })),
    fetchCarrierPayments: vi.fn(async () => ({ payments: [], totalAmount: 0 })),
  };
});
// The EFS readers go out to servercrm → EFS SOAP. Mocked so a 403 test can never bill a real call,
// and so "the warehouse was never queried" also means "EFS was never called".
vi.mock('../../src/modules/finance/financeEfs.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/finance/financeEfs.js')>();
  const window = { from: '2026-07-05T00:00:00.000Z', to: '2026-08-04T00:00:00.000Z', days: 30 };
  return {
    ...mod,
    fetchEfsSnapshot: vi.fn(async () => ({
      carrierId: '5776662',
      totalBalance: 0,
      contracts: [],
      cards: [],
      cardCount: 0,
      cardDetailError: null,
      fetchedAt: window.to,
    })),
    fetchEfsLoads: vi.fn(async () => ({
      window,
      summary: { total: 0, topupCount: 0, topupAmount: 0, sweepCount: 0, sweepAmount: 0, net: 0 },
      loads: [],
    })),
    fetchCarrierMoneyCodes: vi.fn(async () => ({
      window,
      status: 'ALL' as const,
      summary: {
        total: 0,
        openCount: 0,
        openAmount: 0,
        usedCount: 0,
        usedAmount: 0,
        partialCount: 0,
        partialAmount: 0,
        voidedCount: 0,
        feeTotal: 0,
      },
      codes: [],
    })),
    fetchMoneyCodeDetail: vi.fn(async () => ({
      id: '164407678',
      codeLast4: '5748',
      status: 'ACTIVE',
      amount: 0,
      amountUsed: 0,
      uses: [],
      firstUseAt: null,
      voided: false,
      voidedAt: null,
    })),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchCarrierInvoices, fetchCarrierPayments } from '../../src/modules/finance/financeCarrier.js';
import { fetchFinanceClientDetail, fetchFinanceClients } from '../../src/modules/finance/financeClients.js';
import {
  fetchCarrierMoneyCodes,
  fetchEfsLoads,
  fetchEfsSnapshot,
  fetchMoneyCodeDetail,
} from '../../src/modules/finance/financeEfs.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const clientsMock = vi.mocked(fetchFinanceClients);
const detailMock = vi.mocked(fetchFinanceClientDetail);
const invoicesMock = vi.mocked(fetchCarrierInvoices);
const paymentsMock = vi.mocked(fetchCarrierPayments);
const efsMock = vi.mocked(fetchEfsSnapshot);
const loadsMock = vi.mocked(fetchEfsLoads);
const moneyCodesMock = vi.mocked(fetchCarrierMoneyCodes);
const codeDetailMock = vi.mocked(fetchMoneyCodeDetail);
const allMocks = [
  clientsMock,
  detailMock,
  invoicesMock,
  paymentsMock,
  efsMock,
  loadsMock,
  moneyCodesMock,
  codeDetailMock,
];

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
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: { zohoUserId: '42', userName: 'CI Test Admin', profile },
  });
}
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

const ROUTES = [
  '/v1/finance/clients',
  '/v1/finance/clients/5776662',
  '/v1/finance/clients/5776662/invoices',
  '/v1/finance/clients/5776662/payments',
  '/v1/finance/clients/5776662/transactions',
  // Live EFS reads: balances, fund movements and money codes. Same gate, and a 403 must land before
  // any EFS call — these cost real vendor round-trips, not just a warehouse scan.
  '/v1/finance/clients/5776662/efs',
  '/v1/finance/clients/5776662/efs/loads',
  '/v1/finance/clients/5776662/money-codes',
  '/v1/finance/money-codes/164407678',
];

describe('every finance route is department-gated', () => {
  for (const url of ROUTES) {
    it(`${url} refuses an unauthenticated caller`, async () => {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
      for (const m of allMocks) expect(m).not.toHaveBeenCalled();
    });

    it(`${url} refuses a sales rep`, async () => {
      const res = await app.inject({ method: 'GET', url, headers: bearer(await workerToken('Sales Rep')) });
      expect(res.statusCode).toBe(403);
      for (const m of allMocks) expect(m).not.toHaveBeenCalled();
    });
  }

  it('a finance worker may read the roster', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ total: 0 });
    expect(clientsMock).toHaveBeenCalledTimes(1);
  });
});

describe('header elevation cannot open the receivables book', () => {
  const attacks: Array<[string, Record<string, string>]> = [
    ['x-department-access: finance', { 'x-department-access': 'finance' }],
    ['x-all-departments: true', { 'x-all-departments': 'true' }],
    ['both at once', { 'x-department-access': 'finance', 'x-all-departments': 'true' }],
  ];
  for (const [label, headers] of attacks) {
    it(`a verified sales rep asserting ${label} is still refused`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/finance/clients',
        headers: { ...bearer(await workerToken('Sales Rep')), ...headers },
      });
      expect(res.statusCode).toBe(403);
      expect(clientsMock).not.toHaveBeenCalled();
    });
  }
});

describe('carrierId is validated before it reaches a query', () => {
  for (const bad of ['abc', "1' or '1'='1", '../../etc', '']) {
    it(`rejects carrierId ${JSON.stringify(bad)}`, async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/finance/clients/${encodeURIComponent(bad)}/invoices`,
        headers: bearer(await workerToken('Finance')),
      });
      // Non-numeric ids are refused (400) or never route (404) — either way, no query runs.
      expect([400, 404]).toContain(res.statusCode);
      expect(invoicesMock).not.toHaveBeenCalled();
    });
  }

  it('a numeric carrierId reaches the reader', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5776662/invoices',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(invoicesMock).toHaveBeenCalledWith('5776662', undefined);
  });

  it('an unknown carrier detail is a 404, not an empty 200', async () => {
    detailMock.mockResolvedValue(null);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/9999999',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('payments read is carrier-scoped', () => {
  it('passes exactly the requested carrier to the ledger reader', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5794015/payments?limit=50',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(paymentsMock).toHaveBeenCalledWith('5794015', 50);
  });
});

describe('EFS reads', () => {
  it('a finance worker gets the carrier snapshot', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/efs',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(efsMock).toHaveBeenCalledWith('5816754');
  });

  it('passes the window through to the loads reader', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/efs/loads?days=7',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(loadsMock).toHaveBeenCalledWith('5816754', 7);
  });

  /**
   * EFS 400s on a window wider than 90 days. Refusing it here means the failure is a validation
   * message about our own contract rather than a vendor SOAP fault surfaced as a broken tab — and
   * it costs no upstream call at all.
   */
  it('refuses a window wider than EFS allows, without calling out', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/efs/loads?days=365',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(400);
    expect(loadsMock).not.toHaveBeenCalled();
  });

  it('forwards a custom from/to range to the loads reader', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/efs/loads?from=2026-06-01&to=2026-06-30',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(loadsMock).toHaveBeenCalledWith('5816754', { from: '2026-06-01', to: '2026-06-30' });
  });

  it('forwards a custom range on money codes alongside the status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/money-codes?from=2026-06-01&to=2026-06-30&status=OPEN',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(moneyCodesMock).toHaveBeenCalledWith(
      '5816754',
      { from: '2026-06-01', to: '2026-06-30' },
      'OPEN',
    );
  });

  it('refuses half a range rather than silently falling back to the default window', async () => {
    for (const q of ['from=2026-06-01', 'to=2026-06-30']) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/finance/clients/5816754/efs/loads?${q}`,
        headers: bearer(await workerToken('Finance')),
      });
      expect(res.statusCode).toBe(400);
    }
    expect(loadsMock).not.toHaveBeenCalled();
  });

  /**
   * `.strict()` on the query schema. A typo'd param must 400, not be dropped and answered with the
   * default 30-day window — that is a wrong-but-successful read, the exact failure the
   * `finance.main_transactions` touchpoint was fixed for.
   */
  it('refuses an unknown window param instead of ignoring it', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/efs/loads?start=2026-06-01&end=2026-06-30',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(400);
    expect(loadsMock).not.toHaveBeenCalled();
  });

  it('rejects a malformed date before it reaches the reader', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/efs/loads?from=01-06-2026&to=30-06-2026',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(400);
    expect(loadsMock).not.toHaveBeenCalled();
  });

  it('defaults the money-code status to ALL and forwards an explicit one', async () => {
    const token = bearer(await workerToken('Finance'));
    const plain = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/money-codes',
      headers: token,
    });
    expect(plain.statusCode).toBe(200);
    expect(moneyCodesMock).toHaveBeenCalledWith('5816754', undefined, 'ALL');

    const open = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/money-codes?days=90&status=OPEN',
      headers: token,
    });
    expect(open.statusCode).toBe(200);
    expect(moneyCodesMock).toHaveBeenLastCalledWith('5816754', 90, 'OPEN');
  });

  it('rejects a status outside the EFS vocabulary rather than passing it upstream', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/clients/5816754/money-codes?status=WHATEVER',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(400);
    expect(moneyCodesMock).not.toHaveBeenCalled();
  });

  it('validates the money-code id before it reaches EFS', async () => {
    for (const bad of ['abc', '164407678x', "1' or '1'='1"]) {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/finance/money-codes/${encodeURIComponent(bad)}`,
        headers: bearer(await workerToken('Finance')),
      });
      expect([400, 404]).toContain(res.statusCode);
    }
    expect(codeDetailMock).not.toHaveBeenCalled();
  });

  /**
   * The response the browser gets must not contain a redeemable code. financeEfs strips it at the
   * reader; this asserts nothing downstream (a serializer, a spread) puts it back.
   */
  it('never serializes a full money code to the client', async () => {
    codeDetailMock.mockResolvedValue({
      id: '164407678',
      codeLast4: '5748',
      status: 'ACTIVE',
      amount: 32,
      amountUsed: 32,
      uses: [{ amount: 32, checkNumber: '1957688595', at: '2026-07-22T05:08:00.000-05:00' }],
      firstUseAt: '2026-07-22 05:08',
      voided: false,
      voidedAt: null,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/finance/money-codes/164407678',
      headers: bearer(await workerToken('Finance')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toMatch(/"(code|alphaCode)"\s*:/);
    expect(res.json()).toMatchObject({ codeLast4: '5748' });
  });
});
