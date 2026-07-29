/**
 * Mytrion HR department routes (/v1/hr/departments*) — RBAC + migrate sync gate.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    getById: vi.fn(async () => undefined),
    createManual: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/modules/hr/hrDepartmentSync.js', () => ({
  syncHrDepartmentsFromZoho: vi.fn(async () => ({
    fetched: 0,
    inserted: 0,
    updated: 0,
    errors: [],
  })),
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { syncHrDepartmentsFromZoho } from '../../src/modules/hr/hrDepartmentSync.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import type { HrDepartment } from '../../src/db/schema/hr_departments.js';

const repo = vi.mocked(hrDepartmentRepo);
const syncMock = vi.mocked(syncHrDepartmentsFromZoho);

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
  repo.list.mockResolvedValue([]);
  repo.count.mockResolvedValue(0);
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

function deptRow(overrides: Partial<HrDepartment> = {}): HrDepartment {
  return {
    id: 'hrd_1',
    tenantId: DEFAULT_TENANT_ID,
    zohoRecordId: null,
    name: 'Marketing',
    code: 'MKT',
    description: null,
    icon: null,
    iconColor: null,
    canvasX: null,
    canvasY: null,
    mailAlias: null,
    leadName: null,
    leadZohoId: null,
    leadEmail: null,
    parentName: null,
    parentZohoId: null,
    parentId: null,
    source: 'manual',
    rawFields: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    ...overrides,
  };
}

describe('HR departments — auth', () => {
  it('GET refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/hr/departments' });
    expect(res.statusCode).toBe(401);
  });

  it('GET REFUSES a sales worker — the department table is not company-wide', async () => {
    // This previously asserted 200, which pinned a hole open: the route checked only
    // `audience === 'internal'`, so any signed-in worker could read every department along with its
    // lead name and lead email. The employees route was tightened to require the `hr` department grant;
    // this half had been left behind, so the two ends of the same tab disagreed about who may read it.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/departments',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(403);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('GET allows a worker holding the hr department', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/departments',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], total: 0 });
  });

  it('POST create refuses a non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/departments',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { name: 'Marketing' },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.createManual).not.toHaveBeenCalled();
  });

  it('POST sync refuses a non-admin', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/departments/sync',
      headers: bearer(await workerToken('Sales Rep')),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe('HR departments — admin', () => {
  it('Administrator can create', async () => {
    repo.createManual.mockResolvedValue(deptRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/departments',
      headers: bearer(await workerToken('Administrator')),
      payload: { name: 'Marketing', code: 'MKT' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'hrd_1', name: 'Marketing' });
  });

  it('Administrator can sync from Zoho', async () => {
    syncMock.mockResolvedValue({ fetched: 22, inserted: 22, updated: 0, errors: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/departments/sync',
      headers: bearer(await workerToken('Administrator')),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fetched: 22, inserted: 22 });
  });
});
