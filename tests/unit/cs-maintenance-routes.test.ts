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
    deleteById: vi.fn(async () => undefined),
    insert: vi.fn(async (row: Record<string, unknown>) => ({ id: 'mtc_created', ...row })),
    update: vi.fn(async (id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
    distinctOwners: vi.fn(async () => []),
    distinctPicklistValues: vi.fn(async () => []),
    countAll: vi.fn(async () => 0),
  },
}));
vi.mock('../../src/repos/maintenanceCaseHistoryRepo.js', () => ({
  maintenanceCaseHistoryRepo: {
    insert: vi.fn(async (row: Record<string, unknown>) => ({ id: 'mch_created', ...row })),
    listByCaseId: vi.fn(async () => []),
  },
}));
vi.mock('../../src/repos/maintenanceAttachmentRepo.js', () => ({
  maintenanceAttachmentRepo: {
    insert: vi.fn(async (row: Record<string, unknown>) => ({ id: 'mca_created', ...row })),
    listByCaseId: vi.fn(async () => []),
    getById: vi.fn(async () => undefined),
    delete: vi.fn(async (id: string) => ({ id })),
  },
}));
const storagePutMock = vi.fn(async (_key: string, _body: Buffer, _opts: { contentType: string }) => undefined);
const storagePresignGetMock = vi.fn(async (_key: string, _opts?: { filename?: string }) => ({
  url: 'https://example.test/signed',
  expiresAt: new Date(0),
}));
const storageDeleteMock = vi.fn(async (_key: string) => undefined);
vi.mock('../../src/modules/files/storage/index.js', () => ({
  getStorage: () => ({ put: storagePutMock, presignGet: storagePresignGetMock, delete: storageDeleteMock }),
  storageFor: () => ({ put: storagePutMock, presignGet: storagePresignGetMock, delete: storageDeleteMock }),
  maintenanceStorageProvider: () => 's3',
}));
// Storage isn't feature-flagged for Maintenance attachments — the route checks env directly
// (requireStorageConfigured). Defaults to "configured"; individual tests blank a field to hit the
// 503 path, same mutate-then-restore approach other suites in this repo use for `env`.
vi.mock('../../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...mod,
    env: {
      ...mod.env,
      S3_ENDPOINT: 'https://example.test',
      S3_ACCESS_KEY_ID: 'test-key',
      S3_SECRET_ACCESS_KEY: 'test-secret',
      S3_BUCKET: 'test-bucket',
    },
  };
});
// withGeneratedReferenceNumber's raw uniqueness-check query — same seam cs-maintenance-rules.test.ts
// stubs. `taken: false` so a generated candidate is always accepted on the first attempt. Real `db`
// (and everything else this module exports) stays intact: the app's own session/auth plumbing
// depends on it, and a bare `{ pg }` mock would silently blank that out for the WHOLE app.
vi.mock('../../src/db/client.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/db/client.js')>();
  return { ...mod, pg: vi.fn(async () => [{ taken: false }]) };
});
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
import { env } from '../../src/config/env.js';
import { zohoCrm } from '../../src/integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { maintenanceCaseRepo } from '../../src/repos/maintenanceCaseRepo.js';
import { maintenanceCaseHistoryRepo } from '../../src/repos/maintenanceCaseHistoryRepo.js';
import { maintenanceAttachmentRepo } from '../../src/repos/maintenanceAttachmentRepo.js';

const repo = vi.mocked(maintenanceCaseRepo, true);
const historyRepo = vi.mocked(maintenanceCaseHistoryRepo, true);
const attachmentRepo = vi.mocked(maintenanceAttachmentRepo, true);
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

  it('does NOT write a history row when the 404 check fails', async () => {
    repo.update.mockResolvedValueOnce(undefined);
    await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_gone',
      headers: auth(await csAgent()),
      payload: { status: 'Completed' },
    });
    expect(historyRepo.insert).not.toHaveBeenCalled();
  });
});

describe('Timeline History (CS feedback 2026-07-31)', () => {
  it('logs one "created" entry with every field the create actually set', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cs/maintenance',
      headers: auth(await csAgent()),
      payload: { name: 'ACME TRUCKING', carrierId: '5000001' },
    });
    expect(res.statusCode).toBe(201);
    expect(historyRepo.insert).toHaveBeenCalledTimes(1);
    const call = historyRepo.insert.mock.calls[0]?.[0] as { action: string; changes: unknown[] };
    expect(call.action).toBe('created');
    expect(call.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', from: null, to: 'ACME TRUCKING' }),
      ]),
    );
    // Server-resolved fields (compensation defaults, carrier id) are in the SAME entry, not a second one.
    expect(call.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'completionCompensation', to: '5.00' }),
      ]),
    );
  });

  it('logs one "updated" entry naming the field that changed, using the PRIOR row for "from"', async () => {
    repo.getById.mockResolvedValueOnce({ status: 'In Process' } as never);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
      payload: { status: 'Completed' },
    });
    expect(res.statusCode).toBe(200);
    const call = historyRepo.insert.mock.calls[0]?.[0] as {
      caseId: string;
      action: string;
      changes: unknown[];
    };
    expect(call.caseId).toBe('mtc_abc123');
    expect(call.action).toBe('updated');
    expect(call.changes).toEqual([
      { field: 'status', label: 'Status', from: 'In Process', to: 'Completed' },
    ]);
  });

  it('writes no history row for a no-op patch (nothing actually changed)', async () => {
    repo.getById.mockResolvedValueOnce({ status: 'Completed' } as never);
    await app.inject({
      method: 'PATCH',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
      payload: { status: 'Completed' },
    });
    expect(historyRepo.insert).not.toHaveBeenCalled();
  });

  it('GET history is a thin pass-through to the repo, gated the same as every other route here', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/mtc_abc123/history',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(historyRepo.listByCaseId).toHaveBeenCalledWith('mtc_abc123');
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

describe('delete (test-case cleanup only, 2026-08-19)', () => {
  it('deletes, audits with a snapshot, and makes no Zoho call', async () => {
    repo.deleteById.mockResolvedValueOnce({
      id: 'mtc_abc123',
      name: 'Test Co',
      companyName: 'Test Co',
      carrierId: '900001',
      caseType: 'Mechanical',
      totalAmount: '0.00',
      status: 'In Process',
    } as never);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'mtc_abc123', deleted: true });
    expect(zohoCallCount()).toBe(0);
    expect(repo.deleteById).toHaveBeenCalledWith('mtc_abc123');
    expect(audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'cs.maintenance.delete',
        detail: expect.objectContaining({ snapshot: expect.objectContaining({ carrierId: '900001' }) }),
      }),
    );
  });

  it('404s a delete for a case that does not exist, and does not audit a no-op as ok', async () => {
    repo.deleteById.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_missing',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
    expect(audited).not.toHaveBeenCalled();
  });

  it('gated the same as every other CS Maintenance route — no extra grant on top of department access', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123',
      headers: auth(await salesAgent()),
    });
    expect(res.statusCode).toBe(403);
    expect(repo.deleteById).not.toHaveBeenCalled();
  });
});

describe('Attachments (CS feedback 2026-07-31)', () => {
  function multipartUpload(caseId: string) {
    const boundary = '----testboundary';
    const body =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="invoice.pdf"\r\n' +
      'Content-Type: application/pdf\r\n\r\n' +
      'fake pdf bytes\r\n' +
      `--${boundary}--\r\n`;
    return app.inject({
      method: 'POST',
      url: `/v1/cs/maintenance/${caseId}/attachments`,
      headers: {
        ...auth(csAgentToken),
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });
  }

  let csAgentToken: string;
  beforeEach(async () => {
    csAgentToken = await csAgent();
    repo.getById.mockResolvedValue({ id: 'mtc_abc123' } as never);
  });

  it('uploads to storage, stores metadata, and audits', async () => {
    const res = await multipartUpload('mtc_abc123');
    expect(res.statusCode).toBe(201);
    expect(storagePutMock).toHaveBeenCalledTimes(1);
    const call = storagePutMock.mock.calls[0];
    if (!call) throw new Error('storage.put was not called');
    const [key, buf, opts] = call;
    expect(key).toMatch(/^maintenance\/mtc_abc123\/.+-invoice\.pdf$/);
    expect(opts.contentType).toBe('application/pdf');
    expect(Buffer.isBuffer(buf)).toBe(true);

    const inserted = attachmentRepo.insert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      caseId: 'mtc_abc123',
      fileName: 'invoice.pdf',
      mime: 'application/pdf',
      storageProvider: 's3',
    });
    expect(audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.maintenance.attachment_upload', status: 'ok' }),
    );
  });

  it('404s when the case does not exist', async () => {
    repo.getById.mockResolvedValue(undefined);
    const res = await multipartUpload('mtc_gone');
    expect(res.statusCode).toBe(404);
    expect(storagePutMock).not.toHaveBeenCalled();
  });

  it('503s with a clear message when storage is not configured, instead of an opaque 500', async () => {
    const original = env.S3_ACCESS_KEY_ID;
    (env as { S3_ACCESS_KEY_ID: string }).S3_ACCESS_KEY_ID = '';
    try {
      const res = await multipartUpload('mtc_abc123');
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: expect.objectContaining({ code: 'STORAGE_NOT_CONFIGURED' }) });
      expect(storagePutMock).not.toHaveBeenCalled();
    } finally {
      (env as { S3_ACCESS_KEY_ID: string }).S3_ACCESS_KEY_ID = original;
    }
  });

  it('lists whatever the repo returns for the case', async () => {
    attachmentRepo.listByCaseId.mockResolvedValueOnce([
      { id: 'mca_1', caseId: 'mtc_abc123', fileName: 'invoice.pdf' } as never,
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/mtc_abc123/attachments',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ attachments: [{ id: 'mca_1', caseId: 'mtc_abc123', fileName: 'invoice.pdf' }] });
  });

  it('download presigns a URL for an attachment that belongs to the case', async () => {
    attachmentRepo.getById.mockResolvedValueOnce({
      id: 'mca_1',
      caseId: 'mtc_abc123',
      fileName: 'invoice.pdf',
      s3Key: 'maintenance/mtc_abc123/abc-invoice.pdf',
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_1/download',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(storagePresignGetMock).toHaveBeenCalledWith(
      'maintenance/mtc_abc123/abc-invoice.pdf',
      expect.objectContaining({ filename: 'invoice.pdf' }),
    );
    expect(res.json()).toMatchObject({ id: 'mca_1', name: 'invoice.pdf', url: 'https://example.test/signed' });
  });

  it('404s a download for an attachment id that does not exist', async () => {
    attachmentRepo.getById.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_gone/download',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s a download whose attachment belongs to a DIFFERENT case — never leak by guessing an id", async () => {
    attachmentRepo.getById.mockResolvedValueOnce({
      id: 'mca_1',
      caseId: 'mtc_other_case',
      fileName: 'invoice.pdf',
      s3Key: 'maintenance/mtc_other_case/abc-invoice.pdf',
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_1/download',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
    expect(storagePresignGetMock).not.toHaveBeenCalled();
  });

  it('deletes the metadata row and the storage object, and audits', async () => {
    attachmentRepo.getById.mockResolvedValueOnce({
      id: 'mca_1',
      caseId: 'mtc_abc123',
      fileName: 'invoice.pdf',
      s3Key: 'maintenance/mtc_abc123/abc-invoice.pdf',
    } as never);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_1',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: 'mca_1', deleted: true });
    expect(attachmentRepo.delete).toHaveBeenCalledWith('mca_1');
    expect(storageDeleteMock).toHaveBeenCalledWith('maintenance/mtc_abc123/abc-invoice.pdf');
    expect(audited).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'cs.maintenance.attachment_delete', status: 'ok' }),
    );
  });

  it('404s a delete for an attachment id that does not exist', async () => {
    attachmentRepo.getById.mockResolvedValueOnce(undefined);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_gone',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
    expect(attachmentRepo.delete).not.toHaveBeenCalled();
  });

  it("404s a delete whose attachment belongs to a DIFFERENT case — never delete by guessing an id", async () => {
    attachmentRepo.getById.mockResolvedValueOnce({
      id: 'mca_1',
      caseId: 'mtc_other_case',
      fileName: 'invoice.pdf',
      s3Key: 'maintenance/mtc_other_case/abc-invoice.pdf',
    } as never);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_1',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(404);
    expect(attachmentRepo.delete).not.toHaveBeenCalled();
    expect(storageDeleteMock).not.toHaveBeenCalled();
  });

  it('still deletes the metadata row even if the storage delete fails (orphaned blob, not a broken reference)', async () => {
    attachmentRepo.getById.mockResolvedValueOnce({
      id: 'mca_1',
      caseId: 'mtc_abc123',
      fileName: 'invoice.pdf',
      s3Key: 'maintenance/mtc_abc123/abc-invoice.pdf',
    } as never);
    storageDeleteMock.mockRejectedValueOnce(new Error('object store unreachable'));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_1',
      headers: auth(await csAgent()),
    });
    expect(res.statusCode).toBe(200);
    expect(attachmentRepo.delete).toHaveBeenCalledWith('mca_1');
  });

  it('503s a delete with a clear message when storage is not configured', async () => {
    const original = env.S3_ACCESS_KEY_ID;
    (env as { S3_ACCESS_KEY_ID: string }).S3_ACCESS_KEY_ID = '';
    try {
      const res = await app.inject({
        method: 'DELETE',
        url: '/v1/cs/maintenance/mtc_abc123/attachments/mca_1',
        headers: auth(await csAgent()),
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: expect.objectContaining({ code: 'STORAGE_NOT_CONFIGURED' }) });
      expect(attachmentRepo.delete).not.toHaveBeenCalled();
    } finally {
      (env as { S3_ACCESS_KEY_ID: string }).S3_ACCESS_KEY_ID = original;
    }
  });
});
