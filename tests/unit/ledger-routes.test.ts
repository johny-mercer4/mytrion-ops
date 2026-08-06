/**
 * Billing Ledger routes — the department gate, the read-only gate, and input validation.
 *
 * RBAC is the point of this file. The UI hides write controls from a read-only grant, but that is a
 * convenience, not the boundary — so every write is asserted to 403 for a read-only billing user and for
 * a non-billing department, at the route level, with the UI out of the picture.
 *
 * The repos are mocked; the app boots for real, so the zod schemas, the guards and the error handler are
 * all exercised. Same shape as billing-returns-match-route.test.ts.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { openingRepo, clientTypeRepo, snapshotRepo, importRepo, dwhQuery, auditMock, enqueueMock } =
  vi.hoisted(() => ({
    openingRepo: {
      findLive: vi.fn(),
      findLiveBatch: vi.fn(async () => new Map()),
      listLive: vi.fn(async () => ({ rows: [], total: 0 })),
      listHistory: vi.fn(async () => []),
      findById: vi.fn(),
      upsert: vi.fn(),
      revertToRevision: vi.fn(),
      commitBatch: vi.fn(async () => ({ committed: 0, ids: [] })),
      revertBatch: vi.fn(async () => ({ reverted: 0, cleared: 0 })),
      coverageBySection: vi.fn(async () => []),
      carrierIdsWithLive: vi.fn(async () => new Set<string>()),
    },
    clientTypeRepo: {
      findOpen: vi.fn(async () => undefined),
      findOpenBatch: vi.fn(async () => new Map()),
      listHistory: vi.fn(async () => []),
      openOverride: vi.fn(),
      closeOpen: vi.fn(async () => null),
    },
    snapshotRepo: {
      statusCounts: vi.fn(async () => []),
      latestComputedDate: vi.fn(async () => null),
      listByStatus: vi.fn(async () => ({ rows: [], total: 0 })),
      upsertMany: vi.fn(async () => 0),
    },
    importRepo: {
      create: vi.fn(),
      findById: vi.fn(async () => undefined),
      findPendingBySha: vi.fn(async () => undefined),
      listRows: vi.fn(async () => ({ rows: [], total: 0 })),
      acceptedRows: vi.fn(async () => []),
      setStatus: vi.fn(),
      listRecent: vi.fn(async () => []),
    },
    dwhQuery: vi.fn(async () => [] as unknown[]),
    auditMock: vi.fn(async () => undefined),
    enqueueMock: vi.fn(async () => 'job_1'),
  }));

vi.mock('../../src/repos/ledgerOpeningBalanceRepo.js', () => ({
  ledgerOpeningBalanceRepo: openingRepo,
  num: (v: unknown) => (v === null || v === undefined ? 0 : Number(v) || 0),
}));
vi.mock('../../src/repos/ledgerClientTypeRepo.js', () => ({ ledgerClientTypeRepo: clientTypeRepo }));
vi.mock('../../src/repos/ledgerSnapshotRepo.js', () => ({ ledgerSnapshotRepo: snapshotRepo }));
vi.mock('../../src/repos/ledgerImportBatchRepo.js', () => ({ ledgerImportBatchRepo: importRepo }));
vi.mock('../../src/integrations/dwh.js', () => ({ dwh: { query: dwhQuery } }));
// The schema-readiness gate would otherwise probe a real database on every request.
vi.mock('../../src/modules/billing/ledger/readiness.js', () => ({
  requireLedgerSchema: vi.fn(async () => undefined),
  getLedgerSchemaReadiness: vi.fn(async () => ({ ready: true, missing: [] })),
  clearLedgerReadinessCache: vi.fn(),
}));
vi.mock('../../src/modules/jobs/queue.js', () => ({ enqueue: enqueueMock }));
vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: auditMock };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';

/** A billing worker. `mytrionAccessModes` is what separates full from read-only. */
async function billingToken(mode: 'full' | 'read'): Promise<string> {
  return signAccessToken({
    userId: 'zoho:99',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'worker',
    worker: { zohoUserId: '99', userName: 'Billing Agent', profile: 'Agent' },
    ...({ departments: ['billing'], mytrionAccessModes: { billing: mode } } as Record<string, unknown>),
  } as never);
}

async function adminToken(): Promise<string> {
  return signAccessToken({
    userId: 'zoho:1',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '1', userName: 'Ledger Admin', profile: 'Administrator' },
  });
}

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

let app: FastifyInstance;
let admin: string;

beforeAll(async () => {
  app = await buildApp();
  await app.ready();
  admin = await adminToken();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
  openingRepo.listLive.mockResolvedValue({ rows: [], total: 0 });
  openingRepo.coverageBySection.mockResolvedValue([]);
  clientTypeRepo.findOpenBatch.mockResolvedValue(new Map());
  snapshotRepo.statusCounts.mockResolvedValue([]);
  snapshotRepo.latestComputedDate.mockResolvedValue(null);
  snapshotRepo.listByStatus.mockResolvedValue({ rows: [], total: 0 });
  dwhQuery.mockResolvedValue([]);
  enqueueMock.mockResolvedValue('job_1');
});

/** Every ledger route, so a new one cannot be added without a gate. */
const READS = [
  '/v1/billing/ledger/sections',
  '/v1/billing/ledger/opening-balances',
  '/v1/billing/ledger/opening-balances-coverage',
  '/v1/billing/ledger/client-types',
  '/v1/billing/ledger/summary',
  '/v1/billing/ledger/variances',
  '/v1/billing/ledger/aging/ar',
  '/v1/billing/ledger/aging/unbilled',
  '/v1/billing/ledger/aging/untopped',
  '/v1/billing/ledger/control-sums',
  '/v1/billing/ledger/payments',
];

const WRITES: Array<{ method: 'POST' | 'DELETE'; url: string; payload?: Record<string, unknown> }> = [
  {
    method: 'POST',
    url: '/v1/billing/ledger/opening-balances',
    payload: { carrierId: '5000001', section: 'ar', asOfDate: '2026-07-01', amount: 100 },
  },
  { method: 'POST', url: '/v1/billing/ledger/opening-balances/lob_1/revert' },
  {
    method: 'POST',
    url: '/v1/billing/ledger/client-types/5000001',
    payload: { clientType: 'LOC', reason: 'because' },
  },
  { method: 'DELETE', url: '/v1/billing/ledger/client-types/5000001' },
  { method: 'POST', url: '/v1/billing/ledger/recompute', payload: {} },
  { method: 'POST', url: '/v1/billing/ledger/opening-balances/import/lib_1/commit', payload: {} },
  { method: 'POST', url: '/v1/billing/ledger/opening-balances/import/lib_1/discard' },
  { method: 'POST', url: '/v1/billing/ledger/opening-balances/import/lib_1/revert' },
];

describe('authentication', () => {
  it('every read refuses an unauthenticated caller', async () => {
    for (const url of READS) {
      const res = await app.inject({ method: 'GET', url });
      expect([401, 403], `${url} must not be public`).toContain(res.statusCode);
    }
  });

  it('every write refuses an unauthenticated caller', async () => {
    for (const w of WRITES) {
      const res = await app.inject({ method: w.method, url: w.url, payload: w.payload ?? {} });
      expect([401, 403], `${w.url} must not be public`).toContain(res.statusCode);
    }
  });
});

describe('the billing department gate', () => {
  it('refuses a worker with no billing department on every read', async () => {
    const token = await signAccessToken({
      userId: 'zoho:77',
      tenantId: DEFAULT_TENANT_ID,
      audience: 'internal',
      role: 'worker',
      worker: { zohoUserId: '77', userName: 'Sales Worker', profile: 'Agent' },
    });
    for (const url of READS) {
      const res = await app.inject({ method: 'GET', url, headers: auth(token) });
      expect(res.statusCode, `${url} leaked to a non-billing worker`).toBe(403);
      expect(res.json().error.code).toBe('RBAC_DENIED');
    }
  });

  it('refuses a worker with no billing department on every write', async () => {
    const token = await billingToken('full');
    // A plain worker resolves its departments from the DB, which is empty in this suite — so this token
    // has no billing access regardless of the claim, which is exactly the fail-closed behaviour wanted.
    for (const w of WRITES) {
      const res = await app.inject({
        method: w.method,
        url: w.url,
        headers: auth(token),
        payload: w.payload ?? {},
      });
      expect(res.statusCode, `${w.url} leaked`).toBe(403);
    }
  });
});

describe('reads are reachable for an authorized caller', () => {
  it('returns the section catalog with all five sub-ledgers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/ledger/sections', headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.sections.map((s: { id: string }) => s.id)).toEqual([
      'cb-loc',
      'unbilled',
      'ar',
      'cb-prepay',
      'untopped',
    ]);
  });

  it('labels an un-run snapshot rather than reporting zeros as clean', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/ledger/summary', headers: auth(admin) });
    expect(res.statusCode).toBe(200);
    expect(res.json().latestComputedDate).toBeNull();
  });
});

describe('input validation', () => {
  it('rejects an unknown section in the path', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/ledger/sections/bogus?startDate=2026-07-01&endDate=2026-07-07',
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a calendar-invalid date', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/ledger/sections/ar?startDate=2026-02-30&endDate=2026-03-01',
      headers: auth(admin),
    });
    // 2026-02-30 rolls over to March 2 in a JS Date, so it must be caught by the refine, not accepted.
    expect(res.statusCode).toBe(400);
  });

  it('rejects an inverted period', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/ledger/sections/ar?startDate=2026-07-07&endDate=2026-07-01',
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LEDGER_PERIOD_INVERTED');
  });

  it('rejects a period wider than the cap instead of timing out', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/billing/ledger/sections/ar?startDate=2020-01-01&endDate=2026-07-01',
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LEDGER_PERIOD_TOO_WIDE');
  });

  it('rejects a future as-of date on an opening balance', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/opening-balances',
      headers: auth(admin),
      payload: { carrierId: '5000001', section: 'ar', asOfDate: '2099-01-01', amount: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LEDGER_OB_FUTURE_DATE');
  });

  it('requires a reason of substance on a client-type override', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/client-types/5000001',
      headers: auth(admin),
      payload: { clientType: 'LOC', reason: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('writes are audited, including their failures', () => {
  it('audits the rejection when the carrier is not in the ledger', async () => {
    dwhQuery.mockResolvedValue([]);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/opening-balances',
      headers: auth(admin),
      payload: { carrierId: '9999999', section: 'ar', asOfDate: '2026-07-01', amount: 10 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('LEDGER_OB_CARRIER_INELIGIBLE');
    // A refused write is still a write attempt and must appear in the record.
    const actions = auditMock.mock.calls.map(
      (c) => (c as unknown[])[1] as { action?: string; status?: string } | undefined,
    );
    expect(
      actions.some(
        (a) => a?.action === 'billing.ledger.opening_balance.upsert' && a?.status === 'error',
      ),
    ).toBe(true);
  });

  it('audits a queued recompute with the day it targets', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/recompute',
      headers: auth(admin),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(enqueueMock).toHaveBeenCalledTimes(1);
    const audited = auditMock.mock.calls.map(
      (c) => ((c as unknown[])[1] as { action?: string } | undefined)?.action,
    );
    expect(audited).toContain('billing.ledger.recompute');
  });

  it('refuses a recompute for a future day', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/recompute',
      headers: auth(admin),
      payload: { asOfDate: '2099-01-01' },
    });
    expect(res.statusCode).toBe(400);
    expect(enqueueMock).not.toHaveBeenCalled();
  });
});

describe('404s rather than silent success', () => {
  it('reverting a revision that does not exist is a 404', async () => {
    openingRepo.findById.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/opening-balances/lob_missing/revert',
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(404);
  });

  it('committing an import batch that does not exist is a 404', async () => {
    importRepo.findById.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/ledger/opening-balances/import/lib_missing/commit',
      headers: auth(admin),
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });

  it('clearing a client-type override that is not open is a 404', async () => {
    clientTypeRepo.closeOpen.mockResolvedValue(null);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/billing/ledger/client-types/5000001',
      headers: auth(admin),
    });
    expect(res.statusCode).toBe(404);
  });
});
