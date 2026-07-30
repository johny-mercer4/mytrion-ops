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

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { fetchCarrierInvoices, fetchCarrierPayments } from '../../src/modules/finance/financeCarrier.js';
import { fetchFinanceClientDetail, fetchFinanceClients } from '../../src/modules/finance/financeClients.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const clientsMock = vi.mocked(fetchFinanceClients);
const detailMock = vi.mocked(fetchFinanceClientDetail);
const invoicesMock = vi.mocked(fetchCarrierInvoices);
const paymentsMock = vi.mocked(fetchCarrierPayments);
const allMocks = [clientsMock, detailMock, invoicesMock, paymentsMock];

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
    worker: { zohoUserId: '42', userName: 'Robiya', profile },
  });
}
const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

const ROUTES = [
  '/v1/finance/clients',
  '/v1/finance/clients/5776662',
  '/v1/finance/clients/5776662/invoices',
  '/v1/finance/clients/5776662/payments',
  '/v1/finance/clients/5776662/transactions',
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
