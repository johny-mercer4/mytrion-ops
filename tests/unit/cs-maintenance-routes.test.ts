/**
 * /v1/cs/maintenance — department gate, the no-Zoho guarantee, and the write path.
 *
 * The load-bearing test here is `makes ZERO Zoho calls`: the whole point of migrating the module into
 * Postgres is that the tab no longer depends on Zoho, and nothing about a passing list response
 * would reveal a stray Zoho round-trip creeping back in.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: {
    getRecord: vi.fn(async () => null),
    listRecords: vi.fn(async () => ({ rows: [], moreRecords: false })),
    searchRecords: vi.fn(async () => ({ rows: [], moreRecords: false })),
    updateRecord: vi.fn(async () => 'ok'),
    insertRecord: vi.fn(async () => 'new-id'),
    deleteRecord: vi.fn(async () => undefined),
    getModuleFields: vi.fn(async () => []),
  },
}));
vi.mock('../../src/integrations/zohoCrm.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/integrations/zohoCrm.js')>();
  return {
    ...mod,
    runCoql: vi.fn(async () => ({ rows: [], count: 0, moreRecords: false })),
    zohoCrm: Object.assign(Object.create(Object.getPrototypeOf(mod.zohoCrm)), mod.zohoCrm, {
      runCoql: vi.fn(async () => ({ rows: [], count: 0, moreRecords: false })),
      runCoqlAll: vi.fn(async () => ({ rows: [], truncated: false, pages: 1 })),
      listActiveUsers: vi.fn(async () => []),
    }),
  };
});
vi.mock('../../src/repos/maintenanceCaseRepo.js', () => ({
  maintenanceCaseRepo: {
    listPage: vi.fn(async () => ({ rows: [], page: 1, perPage: 24, total: 0, hasMore: false })),
    facets: vi.fn(async () => ({
      total: 0,
      byStatus: {},
      byCaseType: {},
      byPaymentStatus: {},
      totalAmount: 0,
    })),
    getById: vi.fn(async () => undefined),
    insert: vi.fn(async (row: Record<string, unknown>) => ({ id: 'mtc_created', ...row })),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    distinctOwners: vi.fn(async () => []),
    distinctPicklistValues: vi.fn(async () => []),
    countAll: vi.fn(async () => 0),
  },
}));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});
vi.mock('../../src/integrations/dwhCompanies.js', () => ({
  searchCompanies: vi.fn(async () => [
    { carrierId: '5000001', companyName: 'ACME HAULING LLC', isActive: true, paymentTerms: 'Prepay' },
  ]),
}));

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { zohoCrm } from '../../src/integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { maintenanceCaseRepo } from '../../src/repos/maintenanceCaseRepo.js';

const repo = vi.mocked(maintenanceCaseRepo, true);
const records = vi.mocked(zohoCrmRecords, true);
const crm = vi.mocked(zohoCrm, true);
const audited = vi.mocked(auditFromContext);

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
  repo.listPage.mockResolvedValue({ rows: [], page: 1, perPage: 24, total: 0, hasMore: false });
  repo.facets.mockResolvedValue({
    total: 0,
    byStatus: {},
    byCaseType: {},
    byPaymentStatus: {},
    totalAmount: 0,
  });
  repo.getById.mockResolvedValue(undefined);
  repo.distinctOwners.mockResolvedValue([]);
  repo.distinctPicklistValues.mockResolvedValue([]);
});

async function workerToken(profile: string, zohoRole?: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale claim — re-derived from the profile at verify
    worker: {
      zohoUserId: '42',
      userName: 'Test CS Agent',
      profile,
      ...(zohoRole ? { zohoRole } : {}),
    },
  });
}

const csAgent = () => workerToken('Customer Retention', 'Customer Service Agent');
const salesAgent = () => workerToken('Sales Agent', 'Sales');

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

/** Every Zoho entry point this route file could possibly reach. */
function zohoCallCount(): number {
  const fns = [
    records.getRecord,
    records.listRecords,
    records.searchRecords,
    records.getModuleFields,
    records.insertRecord,
    records.updateRecord,
    crm.runCoql,
    crm.runCoqlAll,
    crm.listActiveUsers,
  ];
  return fns.reduce((n, fn) => n + fn.mock.calls.length, 0);
}

describe('department gate', () => {
  it('403s a session without customer-service access', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance',
      headers: auth(await salesAgent()),
    });
    expect(res.statusCode).toBe(403);
  });

  it('200s a CS session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
  });

  it('401s with no token at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/cs/maintenance' });
    expect(res.statusCode).toBe(401);
  });
});

describe('reads never touch Zoho', () => {
  const reads = [
    '/v1/cs/maintenance',
    '/v1/cs/maintenance?search=5000001&status=In%20Process&dateFrom=2026-01-01&dateTo=2026-07-30',
    '/v1/cs/maintenance/stats',
    '/v1/cs/maintenance/meta',
  ];

  for (const url of reads) {
    it(`${url} → Postgres only`, async () => {
      const res = await app.inject({ method: 'GET', url, headers: auth(await csAgent()) });
      expect(res.statusCode).toBe(200);
      expect(zohoCallCount()).toBe(0);
    });
  }
});

describe('list query', () => {
  it('passes search, picklist arrays and the date window through to the repo', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance?search=acme&status=In%20Process,Completed&caseType=PMs&dateFrom=2026-01-01&dateTo=2026-07-30&sort=amount&dir=asc&page=2&perPage=48',
      headers: auth(await csAgent()),
    });
    expect(repo.listPage).toHaveBeenCalledWith(
      expect.objectContaining({
        search: 'acme',
        status: ['In Process', 'Completed'],
        caseType: ['PMs'],
        dateFrom: '2026-01-01',
        dateTo: '2026-07-30',
        sort: 'amount',
        dir: 'asc',
        page: 2,
        perPage: 48,
      }),
    );
  });

  it('computes facets over the SAME filters as the page', async () => {
    await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance?search=acme&status=Completed',
      headers: auth(await csAgent()),
    });
    expect(repo.facets).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'acme', status: ['Completed'] }),
    );
  });

  it('400s an inverted date window instead of silently returning nothing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance?dateFrom=2026-07-30&dateTo=2026-01-01',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(400);
  });

  it('400s a perPage above the card cap', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance?perPage=5000',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('meta', () => {
  it('unions the canonical picklist with values present in the data', async () => {
    // A legacy value on a migrated record must stay selectable even though Zoho no longer offers it.
    repo.distinctPicklistValues.mockResolvedValue(['Legacy Status']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/meta',
      headers: auth(await csAgent()),
    });
    const body = res.json() as { statusOptions: string[] };
    expect(body.statusOptions).toContain('In Process');
    expect(body.statusOptions).toContain('Legacy Status');
    // Canonical order first, no duplicates.
    expect(body.statusOptions.indexOf('In Process')).toBeLessThan(
      body.statusOptions.indexOf('Legacy Status'),
    );
    expect(new Set(body.statusOptions).size).toBe(body.statusOptions.length);
  });
});

describe('detail', () => {
  it('404s a missing case', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/mtc_nope',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a Zoho-shaped id — these rows are keyed on our own cuid2', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/9000000000000000010',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('create', () => {
  it('writes to Postgres, stamps the session user, and audits — with no Zoho call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      payload: { name: 'ACME TRUCKING', carrierId: '5000001', unitNumber: '012', totalAmount: 500.0 },
    });
    expect(res.statusCode).toBe(201);
    expect(zohoCallCount()).toBe(0);

    const written = repo.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      name: 'ACME TRUCKING',
      carrierId: '5000001',
      unitNumber: '012',
      source: 'mytrion',
      createdByUserId: 'zoho:42',
      createdByName: 'Test CS Agent',
    });
    // Money must land as a fixed-scale string — NUMERIC round-trips as text in drizzle.
    expect(written.totalAmount).toBe('500.00');

    expect(audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.maintenance.create', status: 'ok' }),
    );
  });

  it('applies both Zoho workflow rules on the way in', async () => {
    // The rule functions have their own unit tests; this pins the WIRING. Without it the route can
    // stop calling them and every suite still passes while new cases save with empty compensation —
    // no error, just bonus columns that never fill.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      // No company and no compensation — the two gaps the rules exist to close.
      payload: { name: 'ACME HAULING LLC', unitNumber: 'T-1042' },
    });
    expect(res.statusCode).toBe(201);

    const written = repo.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    // Rule 1 — "Compensation Prepopulation": 5 / 10 / 2.5 at NUMERIC scale.
    expect(written.completionCompensation).toBe('5.00');
    expect(written.leadCompensation).toBe('10.00');
    expect(written.halfCompletionCompensation).toBe('2.50');
    // Rule 2 — "UpdateCompanyForMaintenance": company from the name, carrier id from the exact DWH
    // match, and NO Zoho account created (the Deluge made one; we must not).
    expect(written.companyName).toBe('ACME HAULING LLC');
    expect(written.carrierId).toBe('5000001');
    expect(written.companyZohoId).toBeUndefined();
    expect(zohoCallCount()).toBe(0);
  });

  it('an explicit compensation survives the create rule', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      payload: { name: 'ACME HAULING LLC', completionCompensation: 7 },
    });
    expect(res.statusCode).toBe(201);
    const written = repo.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(written.completionCompensation).toBe('7.00');
    // …and the other two still get their defaults, unlike Zoho where one blank reset all three.
    expect(written.leadCompensation).toBe('10.00');
  });

  it('refills a compensation that an EDIT clears', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
      payload: { completionCompensation: '' },
    });
    expect(res.statusCode).toBe(200);
    const patch = repo.update.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(patch.completionCompensation).toBe('5.00');
    // An untouched compensation must not be resurrected on an unrelated edit.
    expect(patch).not.toHaveProperty('leadCompensation');
  });

  it('400s a create with no company name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      payload: { carrierId: '5000001' },
    });
    expect(res.statusCode).toBe(400);
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('400s an unknown field rather than silently dropping it', async () => {
    // Silently ignoring a misspelled key is how a save appears to work while changing nothing.
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      payload: { name: 'ACME', Carrier_Id: '5000001' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: expect.objectContaining({ code: 'VALIDATION_ERROR' }) });
    expect(repo.insert).not.toHaveBeenCalled();
  });

  it('refuses to write the Zoho record id or the provenance marker from the client', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      payload: { name: 'ACME', zohoRecordId: '9000000000000000010' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('update', () => {
  it('patches, stamps the editor, and audits', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
      payload: { status: 'Completed', caseCompletion: '2026-07-30' },
    });
    expect(res.statusCode).toBe(200);
    expect(zohoCallCount()).toBe(0);
    expect(repo.update).toHaveBeenCalledWith(
      'mtc_abc123',
      expect.objectContaining({
        status: 'Completed',
        caseCompletion: '2026-07-30',
        updatedByUserId: 'zoho:42',
        updatedByName: 'Test CS Agent',
      }),
    );
    expect(audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.maintenance.update' }),
    );
  });

  it('clears a field when sent an empty string', async () => {
    await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
      payload: { caseCompletion: '' },
    });
    expect(repo.update).toHaveBeenCalledWith(
      'mtc_abc123',
      expect.objectContaining({ caseCompletion: null }),
    );
  });

  it('404s when the row does not exist, and does not audit a no-op as ok', async () => {
    repo.update.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_gone',
      headers: auth(await csAgent()),
      payload: { status: 'Completed' },
    });
    expect(res.statusCode).toBe(404);
    expect(audited).not.toHaveBeenCalled();
  });
});

describe('company lookup (DWH)', () => {
  it('returns companies WITH their carrier id — that is the point of the lookup', async () => {
    // Selecting a company auto-fills the carrier id, so the id has to travel with each option. And
    // 49 company names map to more than one carrier, so a name alone could not identify the pick.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/lookup/companies?q=global',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      companies: [
        expect.objectContaining({ carrierId: '5000001', companyName: 'ACME HAULING LLC' }),
      ],
    });
  });

  it('400s a query too short to be worth a DWH round-trip', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/lookup/companies?q=a',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(400);
  });

  it('requires customer-service access like every other route here', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/lookup/companies?q=global',
      headers: auth(await salesAgent()),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('list payload', () => {
  it('never ships the raw jsonb blob', async () => {
    // `raw` was 41% of a 52KB page response and is read by nothing in the UI. The repo selects an
    // explicit column list to keep it out; this asserts the route cannot start leaking it again.
    repo.listPage.mockResolvedValueOnce({
      rows: [{ id: 'mtc_a', name: 'ACME' } as never],
      page: 1,
      perPage: 24,
      total: 1,
      hasMore: false,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
    });
    const body = res.json() as { rows: Array<Record<string, unknown>> };
    for (const row of body.rows) expect(row).not.toHaveProperty('raw');
  });
});

describe('there is no delete', () => {
  it('DELETE is not routed — total_amount feeds prepay math, so removal is not an agent action', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
  });
});
