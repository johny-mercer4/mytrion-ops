import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

const { assertOwned, audit, listRows, renderReport } = vi.hoisted(() => ({
  assertOwned: vi.fn(),
  audit: vi.fn(async () => undefined),
  listRows: vi.fn(),
  renderReport: vi.fn(),
}));

vi.mock('../../src/modules/tools/serverCrmScope.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/modules/tools/serverCrmScope.js')>();
  return { ...original, assertCarrierOwned: assertOwned };
});
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...original, auditFromContext: audit };
});
vi.mock('../../src/modules/carrier/cardLookupReport.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/modules/carrier/cardLookupReport.js')>();
  return {
    ...original,
    listCardLookupRows: listRows,
    renderCardLookupReport: renderReport,
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { RBACError } from '../../src/lib/errors.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

const rows = [{
  cardId: '1001',
  cardNumber: '708305******7378',
  unit: '995',
  driverId: '995',
  driverName: 'Driver One',
  xRef: '',
  status: 'Active',
  override: 'No',
}];

let app: FastifyInstance;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());

async function token(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: '42', userName: 'Sales Agent', profile },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  assertOwned.mockResolvedValue(undefined);
  listRows.mockResolvedValue(rows);
  renderReport.mockResolvedValue({
    bytes: Buffer.from('%PDF'),
    contentType: 'application/pdf',
    fileName: 'Octane_Card_Lookup_2026-08-03.pdf',
    rows: 1,
  });
});

describe('Sales Card Lookup routes', () => {
  it('requires authentication and Sales access', async () => {
    const anonymous = await app.inject({
      method: 'GET',
      url: '/v1/sales/cards?carrierId=5762018',
    });
    const billingToken = await token('Billing Rep');
    const billing = await app.inject({
      method: 'GET',
      url: '/v1/sales/cards?carrierId=5762018',
      headers: { authorization: `Bearer ${billingToken}` },
    });

    expect(anonymous.statusCode).toBe(401);
    expect(billing.statusCode).toBe(403);
    expect(assertOwned).not.toHaveBeenCalled();
  });

  it('rejects an unowned carrier before loading its cards', async () => {
    assertOwned.mockRejectedValue(new RBACError('Carrier is outside your client list.'));
    const salesToken = await token('Sales Rep');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sales/cards?carrierId=5762018',
      headers: { authorization: `Bearer ${salesToken}` },
    });

    expect(response.statusCode).toBe(403);
    expect(listRows).not.toHaveBeenCalled();
  });

  it('returns the masked live roster for an owned carrier', async () => {
    const salesToken = await token('Sales Rep');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sales/cards?carrierId=5762018',
      headers: { authorization: `Bearer ${salesToken}` },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ rows });
    expect(assertOwned).toHaveBeenCalledWith(expect.anything(), '5762018');
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('streams and audits the generated report', async () => {
    const salesToken = await token('Sales Rep');
    const response = await app.inject({
      method: 'GET',
      url: '/v1/sales/cards/report?carrierId=5762018&companyName=ONZMOVE%20INC&format=pdf',
      headers: { authorization: `Bearer ${salesToken}` },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(renderReport).toHaveBeenCalledWith(rows, 'ONZMOVE INC', 'pdf');
    expect(audit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'sales.card_lookup_report.download',
        resourceId: '5762018',
      }),
    );
  });
});
