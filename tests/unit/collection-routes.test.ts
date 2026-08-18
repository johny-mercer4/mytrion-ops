/**
 * Collection desk routes — department RBAC and the pagination caps that keep 9k array
 * reports from dumping the table.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/collectionCaseRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/collectionCaseRepo.js')>();
  return {
    ...actual,
    collectionCaseRepo: {
      list: vi.fn(),
      findById: vi.fn(),
      listInvoices: vi.fn(),
    },
  };
});

vi.mock('../../src/repos/arrayReportRepo.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/repos/arrayReportRepo.js')>();
  return {
    ...actual,
    arrayReportRepo: {
      list: vi.fn(),
      findById: vi.fn(),
      facets: vi.fn(),
    },
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { arrayReportRepo } from '../../src/repos/arrayReportRepo.js';
import { collectionCaseRepo } from '../../src/repos/collectionCaseRepo.js';

const listCases = vi.mocked(collectionCaseRepo.list);
const getCase = vi.mocked(collectionCaseRepo.findById);
const listInvoices = vi.mocked(collectionCaseRepo.listInvoices);
const listReports = vi.mocked(arrayReportRepo.list);
const getReport = vi.mocked(arrayReportRepo.findById);
const facets = vi.mocked(arrayReportRepo.facets);

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
  listCases.mockResolvedValue({ items: [], total: 0, aggregates: { open: 0, closed: 0, remainingDebt: '0', byStage: {} } });
  getCase.mockResolvedValue(undefined);
  listInvoices.mockResolvedValue({ items: [], total: 0 });
  listReports.mockResolvedValue({ items: [], total: 0, aggregates: { total: 0, needsDob: 0, withAgency: 0 } });
  getReport.mockResolvedValue(undefined);
  facets.mockResolvedValue({ periods: [], accountStatuses: [], agencies: [] });
});

async function workerToken(profile: string, tenantId = DEFAULT_TENANT_ID): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'admin-1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

describe('auth boundary', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/collection/cases' });
    expect(res.statusCode).toBe(401);
    expect(listCases).not.toHaveBeenCalled();
  });

  it('REFUSES a verification-only worker — Collection is not theirs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases',
      headers: bearer(await workerToken('Verification')),
    });
    expect(res.statusCode).toBe(403);
    expect(listCases).not.toHaveBeenCalled();
  });

  it('admits a Collection worker', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(200);
    expect(listCases).toHaveBeenCalled();
  });

  it('admits an admin on every Collection read', async () => {
    const token = bearer(await adminToken());
    const paths = [
      '/v1/collection/cases',
      '/v1/collection/array-reports',
      '/v1/collection/array-reports/facets',
    ];
    for (const url of paths) {
      const res = await app.inject({ method: 'GET', url, headers: token });
      expect(res.statusCode, url).toBe(200);
    }
  });
});

describe('pagination caps', () => {
  it('rejects an unbounded array-reports page', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/array-reports?limit=9258',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(listReports).not.toHaveBeenCalled();
  });

  it('rejects array-reports limit above 100', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/array-reports?limit=101',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(listReports).not.toHaveBeenCalled();
  });

  it('rejects a cases page above the board cap', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases?limit=501',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(listCases).not.toHaveBeenCalled();
  });

  it('rejects an invoices page above 200', async () => {
    getCase.mockResolvedValue({
      id: 'cc_1',
      carrierId: '5776662',
      status: 'open',
      collectionStage: 'intake',
      totalDebtAmount: '100.00',
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases/cc_1/invoices?limit=201',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(400);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it('forwards a legal invoices page to the repo', async () => {
    getCase.mockResolvedValue({
      id: 'cc_1',
      carrierId: '5776662',
      status: 'open',
      collectionStage: 'intake',
      totalDebtAmount: '100.00',
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases/cc_1/invoices?limit=50&offset=100',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(200);
    expect(listInvoices).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      'cc_1',
      expect.objectContaining({ limit: 50, offset: 100 }),
    );
  });

  it('forwards a legal array page to the repo', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/array-reports?limit=50&offset=100&reportPeriod=Aug%202026',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(200);
    expect(listReports).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      expect.objectContaining({ limit: 50, offset: 100, reportPeriod: 'Aug 2026' }),
    );
  });
});

describe('detail wiring', () => {
  it('404s an unknown case before listing invoices', async () => {
    getCase.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases/cc_missing/invoices',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(404);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it('returns a case the repo found', async () => {
    getCase.mockResolvedValue({
      id: 'cc_1',
      carrierId: '5776662',
      status: 'open',
      collectionStage: 'with_agency',
      totalDebtAmount: '100.00',
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/collection/cases/cc_1',
      headers: bearer(await workerToken('Collection')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ case: expect.objectContaining({ id: 'cc_1' }) });
  });
});
