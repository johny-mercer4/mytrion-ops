/**
 * Mytrion HR employee routes (/v1/hr/employees*) — RBAC + sync gate.
 * Reads: any authenticated internal worker. Writes + Zoho sync: Mytrion Admin only.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    getById: vi.fn(async () => undefined),
    createManual: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    listDesignationPicklist: vi.fn(async () => []),
  },
}));

vi.mock('../../src/modules/hr/hrEmployeeSync.js', () => ({
  syncHrEmployeesFromZoho: vi.fn(async () => ({
    fetched: 0,
    inserted: 0,
    updated: 0,
    errors: [],
  })),
}));

vi.mock('../../src/modules/hr/hrOrgStructure.js', () => ({
  buildHrOrgStructure: vi.fn(async () => ({
    roots: [],
    departmentCount: 0,
    employeeLinkedCount: 0,
    employeeUnlinkedCount: 0,
  })),
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { syncHrEmployeesFromZoho } from '../../src/modules/hr/hrEmployeeSync.js';
import { buildHrOrgStructure } from '../../src/modules/hr/hrOrgStructure.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import type { HrEmployee } from '../../src/db/schema/hr_employees.js';

const repo = vi.mocked(hrEmployeeRepo);
const syncMock = vi.mocked(syncHrEmployeesFromZoho);
const orgMock = vi.mocked(buildHrOrgStructure);

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
  repo.getById.mockResolvedValue(undefined);
  repo.delete.mockResolvedValue(true);
});

async function workerToken(profile: string, zohoUserId = '42'): Promise<string> {
  return signAccessToken({
    userId: `zoho:${zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale — re-derived from profile
    worker: { zohoUserId, userName: 'Test Worker', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

function employeeRow(overrides: Partial<HrEmployee> = {}): HrEmployee {
  return {
    id: 'hre_1',
    tenantId: DEFAULT_TENANT_ID,
    zohoRecordId: null,
    // The Zoho CRM login this employee IS — the HR RBAC anchor, unresolved by default.
    zohoUserId: null,
    zohoUserIdSource: null,
    zohoUserLinkedAt: null,
    employeeId: 'HRM01',
    firstName: 'Ada',
    lastName: 'Lovelace',
    email: 'ada@example.com',
    departmentId: 'hrd_1',
    department: 'Engineering',
    departmentZohoId: null,
    designation: 'Engineer',
    location: 'Remote',
    status: 'Active',
    role: 'Staff',
    dateOfJoining: '2020-01-01',
    mobile: null,
    reportingTo: null,
    reportingToZohoId: null,
    photoUrl: null,
    source: 'manual',
    rawFields: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-07-28T00:00:00.000Z'),
    updatedAt: new Date('2026-07-28T00:00:00.000Z'),
    ...overrides,
  };
}

describe('HR employees — auth', () => {
  it('GET /hr/employees refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/hr/employees' });
    expect(res.statusCode).toBe(401);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('GET /hr/employees allows an internal sales worker to read', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], total: 0 });
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  it('POST create refuses a non-admin worker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('Sales Rep')),
      payload: { firstName: 'Ada', lastName: 'Lovelace' },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.createManual).not.toHaveBeenCalled();
  });

  it('POST sync refuses a non-admin worker', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/sync',
      headers: bearer(await workerToken('Sales Rep')),
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(syncMock).not.toHaveBeenCalled();
  });
});

describe('HR employees — admin writes', () => {
  it('Administrator can create an employee', async () => {
    repo.createManual.mockResolvedValue(employeeRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('Administrator')),
      payload: { firstName: 'Ada', lastName: 'Lovelace', employeeId: 'HRM01' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'hre_1', firstName: 'Ada', source: 'manual' });
    expect(repo.createManual).toHaveBeenCalledTimes(1);
  });

  it('Administrator can sync from Zoho', async () => {
    syncMock.mockResolvedValue({ fetched: 2, inserted: 1, updated: 1, errors: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/sync',
      headers: bearer(await workerToken('Administrator')),
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ fetched: 2, inserted: 1, updated: 1 });
    expect(syncMock).toHaveBeenCalledTimes(1);
  });

  it('Administrator can delete', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/hr/employees/hre_1',
      headers: bearer(await workerToken('Administrator')),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.delete).toHaveBeenCalled();
  });

  it('PATCH returns 404 when missing', async () => {
    repo.update.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/employees/missing',
      headers: bearer(await workerToken('Administrator')),
      payload: { firstName: 'X' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /hr/meta/designations returns the picklist', async () => {
    repo.listDesignationPicklist.mockResolvedValue(['Engineer', 'Manager']);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/meta/designations',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ designations: ['Engineer', 'Manager'] });
  });

  it('GET /hr/org-structure returns the tree from tables', async () => {
    orgMock.mockResolvedValue({
      roots: [
        {
          id: 'hrd_1',
          name: 'Operations',
          code: 'OPS',
          leadName: null,
          parentId: null,
          employeeCount: 2,
          activeEmployeeCount: 2,
          children: [],
        },
      ],
      departmentCount: 1,
      employeeLinkedCount: 2,
      employeeUnlinkedCount: 0,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/org-structure',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ departmentCount: 1, employeeLinkedCount: 2 });
    expect(orgMock).toHaveBeenCalledTimes(1);
  });
});
