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
    setZohoUserLink: vi.fn(),
    clearZohoUserLink: vi.fn(),
    setPhotoFileId: vi.fn(),
    findByZohoUserId: vi.fn(),
  },
}));

vi.mock('../../src/modules/hr/hrPersonOverview.js', () => ({
  buildHrPersonOverview: vi.fn(),
}));

vi.mock('../../src/modules/files/fileService.js', () => ({
  storeFile: vi.fn(),
  deleteFile: vi.fn(async () => undefined),
  presignFile: vi.fn(),
}));

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: {
    listActiveUsers: vi.fn(async () => []),
    getUserById: vi.fn(),
  },
}));

vi.mock('../../src/modules/hr/hrEmployeeSync.js', () => ({
  syncHrEmployeesFromZoho: vi.fn(async () => ({
    fetched: 0,
    inserted: 0,
    updated: 0,
    relinkedManagers: 0,
    relinkedAttendancePunches: 0,
    errors: [],
  })),
}));

vi.mock('../../src/modules/hr/hrOrgStructure.js', () => ({
  buildHrOrgStructure: vi.fn(async () => ({
    departments: [],
    employees: [],
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
import { zohoCrm } from '../../src/integrations/zohoCrm.js';
import { deleteFile, presignFile, storeFile } from '../../src/modules/files/fileService.js';
import { buildHrPersonOverview } from '../../src/modules/hr/hrPersonOverview.js';
import { syncHrEmployeesFromZoho } from '../../src/modules/hr/hrEmployeeSync.js';
import { buildHrOrgStructure } from '../../src/modules/hr/hrOrgStructure.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import type { HrEmployee } from '../../src/db/schema/hr_employees.js';

const repo = vi.mocked(hrEmployeeRepo);
const storeFileMock = vi.mocked(storeFile);
const deleteFileMock = vi.mocked(deleteFile);
const presignFileMock = vi.mocked(presignFile);
const overviewMock = vi.mocked(buildHrPersonOverview);
const syncMock = vi.mocked(syncHrEmployeesFromZoho);
const orgMock = vi.mocked(buildHrOrgStructure);
const crmMock = vi.mocked(zohoCrm);

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
  repo.setZohoUserLink.mockResolvedValue(undefined);
  repo.clearZohoUserLink.mockResolvedValue(undefined);
  crmMock.listActiveUsers.mockResolvedValue([]);
  crmMock.getUserById.mockResolvedValue(null);
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
    telegramUsername: null,
    photoFileId: null,
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
    faceId: null,
    reportingTo: null,
    reportingToZohoId: null,
    /** The id-based manager link + canvas position the org chart drags onto — unset by default. */
    reportingToEmployeeId: null,
    canvasX: null,
    canvasY: null,
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

  it('GET /hr/employees allows ANY internal worker — the directory is company-wide', async () => {
    // The org opened the people directory to all staff (read-only): every internal worker may look up
    // colleagues, departments and the org chart. Management stays gated (requireHrManage), and a
    // customer / unauthenticated caller is still refused.
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('Sales Rep')),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  it('GET /hr/employees allows a worker holding the hr department', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ items: [], total: 0 });
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  /**
   * The reported bug, end to end: the managed database was asleep, and the UI said the feature was
   * broken. Asserted through `app.inject` rather than against the classifier alone, because the two
   * halves failed independently — the pattern was missing AND the message was buried in `cause`, so a
   * unit test of either half could pass while a real request still 500'd.
   */
  it('reports a sleeping database as a retryable 503, not a 500', async () => {
    // Exactly how it arrives: Drizzle's wrapper, whose own message says only that a query failed.
    repo.list.mockRejectedValueOnce(
      new Error('Failed query: select "id" from "hr_employees" where "tenant_id" = $1\nparams: octane', {
        cause: new Error('the database system is starting up'),
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('HR Manager')),
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().error).toMatchObject({ code: 'DB_UNAVAILABLE' });
    // The client is told it is worth trying again; a bare 500 tells it the opposite.
    expect(res.headers['retry-after']).toBe('5');
    // And the query text — table and column names — must not travel to the browser.
    expect(res.payload).not.toContain('hr_employees');
  });

  it('still reports a genuine failure as a 500, without leaking the query', async () => {
    repo.list.mockRejectedValueOnce(
      new Error('Failed query: select "id" from "hr_employees"', {
        cause: new Error('relation "hr_employees" does not exist'),
      }),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees',
      headers: bearer(await workerToken('HR Manager')),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    expect(res.headers['retry-after']).toBeUndefined();
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

describe('HR employees — Zoho user linking', () => {
  it('refuses a non-admin HR reader', async () => {
    const token = await workerToken('HR', 'hr-link-reader');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/employees/hre_1/zoho-user',
      headers: bearer(token),
      payload: { zohoUserId: 'crm_1' },
    });
    expect(res.statusCode).toBe(403);
    expect(repo.setZohoUserLink).not.toHaveBeenCalled();
  });

  it('validates and links an active Zoho user for an Administrator', async () => {
    const row = employeeRow({
      zohoUserId: 'crm_1',
      zohoUserIdSource: 'manual',
      zohoUserLinkedAt: new Date('2026-07-30T00:00:00.000Z'),
    });
    crmMock.getUserById.mockResolvedValue({
      zohoUserId: 'crm_1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      profile: 'Standard',
      role: 'Employee',
      isOnline: false,
    });
    repo.setZohoUserLink.mockResolvedValue(row);
    const token = await workerToken('Administrator', 'hr-link-admin');
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/employees/hre_1/zoho-user',
      headers: bearer(token),
      payload: { zohoUserId: 'crm_1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'hre_1', zohoUserId: 'crm_1' });
    expect(repo.setZohoUserLink).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: DEFAULT_TENANT_ID }),
      'hre_1',
      'crm_1',
      'manual',
    );
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
    syncMock.mockResolvedValue({
      fetched: 2,
      inserted: 1,
      updated: 1,
      relinkedManagers: 0,
      relinkedAttendancePunches: 0,
      errors: [],
    });
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
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ designations: ['Engineer', 'Manager'] });
  });

  it('GET /hr/org-structure returns both node levels from tables', async () => {
    orgMock.mockResolvedValue({
      departments: [
        {
          id: 'hrd_1',
          name: 'Operations',
          code: 'OPS',
          leadName: null,
          parentId: null,
          description: null,
          icon: null,
          iconColor: null,
          canvasX: null,
          canvasY: null,
          employeeCount: 2,
          activeEmployeeCount: 2,
        },
      ],
      employees: [
        {
          id: 'hre_1',
          firstName: 'Ada',
          lastName: 'Lovelace',
          designation: 'Engineer',
          status: 'Active',
          departmentId: 'hrd_1',
          reportingToEmployeeId: null,
          photoFileId: null,
          canvasX: null,
          canvasY: null,
        },
      ],
      departmentCount: 1,
      employeeLinkedCount: 2,
      employeeUnlinkedCount: 0,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/org-structure',
      headers: bearer(await workerToken('HR Manager')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ departmentCount: 1, employeeLinkedCount: 2 });
    expect(orgMock).toHaveBeenCalledTimes(1);
  });
});

/**
 * Employee avatars: upload / replace / clear, and the read link.
 *
 * The point of these is the ORDER and the GATE. An avatar write must not be reachable by an HR reader,
 * a replace must not leave the old object behind, and a read must never turn a caller-supplied file id
 * into bytes — the id has to come off the employee row.
 */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('HR employees — photo', () => {
  beforeEach(() => {
    storeFileMock.mockResolvedValue({
      fileId: 'file_new',
      name: 'employee-hre_1.png',
      mime: 'image/png',
      sizeBytes: 68,
      url: 'https://dropbox.example/temp/new',
      expiresAt: '2026-08-06T04:00:00.000Z',
    });
  });

  it('refuses an upload from a non-admin HR reader', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('HR', 'hr-photo-reader')),
      payload: { dataUrl: PNG_DATA_URL },
    });
    expect(res.statusCode).toBe(403);
    expect(storeFileMock).not.toHaveBeenCalled();
    expect(repo.setPhotoFileId).not.toHaveBeenCalled();
  });

  it('rejects a body that is not an image data URL', async () => {
    repo.getById.mockResolvedValue(employeeRow());
    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('Administrator', 'hr-photo-admin')),
      payload: { dataUrl: 'https://evil.example/avatar.png' },
    });
    expect(res.statusCode).toBe(400);
    expect(storeFileMock).not.toHaveBeenCalled();
  });

  it('stores the bytes under the hr department and points the row at the new file', async () => {
    repo.getById.mockResolvedValue(employeeRow());
    repo.setPhotoFileId.mockResolvedValue(employeeRow({ photoFileId: 'file_new' }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('Administrator', 'hr-photo-admin')),
      payload: { dataUrl: PNG_DATA_URL },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'hre_1', photoFileId: 'file_new' });
    // The Zoho URL is provenance only and must never reach the browser again.
    expect(res.json()).not.toHaveProperty('photoUrl');
    expect(storeFileMock).toHaveBeenCalledTimes(1);
    const stored = storeFileMock.mock.calls[0]![1];
    expect(stored).toMatchObject({ kind: 'upload', mime: 'image/png', department: 'hr' });
    expect(stored.buffer.length).toBeGreaterThan(0);
    expect(repo.setPhotoFileId).toHaveBeenCalledWith(expect.anything(), 'hre_1', 'file_new');
    // Nothing to clean up on a first upload.
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it('deletes the previous object when replacing, and only after the row is repointed', async () => {
    repo.getById.mockResolvedValue(employeeRow({ photoFileId: 'file_old' }));
    repo.setPhotoFileId.mockResolvedValue(employeeRow({ photoFileId: 'file_new' }));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('Administrator', 'hr-photo-admin')),
      payload: { dataUrl: PNG_DATA_URL },
    });

    expect(res.statusCode).toBe(200);
    expect(deleteFileMock).toHaveBeenCalledWith(expect.anything(), 'file_old');
    // Repoint BEFORE cleanup: the reverse order strands the employee on a deleted file if the store
    // fails, which renders as a permanently broken avatar.
    const repointOrder = repo.setPhotoFileId.mock.invocationCallOrder[0]!;
    expect(deleteFileMock.mock.invocationCallOrder[0]!).toBeGreaterThan(repointOrder);
  });

  it('still succeeds when cleaning up the replaced object fails', async () => {
    repo.getById.mockResolvedValue(employeeRow({ photoFileId: 'file_old' }));
    repo.setPhotoFileId.mockResolvedValue(employeeRow({ photoFileId: 'file_new' }));
    deleteFileMock.mockRejectedValueOnce(new Error('dropbox down'));

    const res = await app.inject({
      method: 'POST',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('Administrator', 'hr-photo-admin')),
      payload: { dataUrl: PNG_DATA_URL },
    });

    // The user's action landed; an orphaned object is not their problem.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ photoFileId: 'file_new' });
  });

  it('DELETE clears the row and removes the object', async () => {
    repo.getById.mockResolvedValue(employeeRow({ photoFileId: 'file_old' }));
    repo.setPhotoFileId.mockResolvedValue(employeeRow({ photoFileId: null }));

    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('Administrator', 'hr-photo-admin')),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ photoFileId: null });
    expect(repo.setPhotoFileId).toHaveBeenCalledWith(expect.anything(), 'hre_1', null);
    expect(deleteFileMock).toHaveBeenCalledWith(expect.anything(), 'file_old');
  });

  it('DELETE is a no-op when there is no photo', async () => {
    repo.getById.mockResolvedValue(employeeRow({ photoFileId: null }));
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/hr/employees/hre_1/photo',
      headers: bearer(await workerToken('Administrator', 'hr-photo-admin')),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.setPhotoFileId).not.toHaveBeenCalled();
    expect(deleteFileMock).not.toHaveBeenCalled();
  });

  it('presigns the link for any HR reader, using the id from the ROW', async () => {
    repo.getById.mockResolvedValue(employeeRow({ photoFileId: 'file_old' }));
    presignFileMock.mockResolvedValue({
      file: {} as never,
      url: 'https://dropbox.example/temp/abc',
      expiresAt: '2026-08-06T04:00:00.000Z',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/hre_1/photo-link',
      headers: bearer(await workerToken('HR', 'hr-photo-reader')),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      url: 'https://dropbox.example/temp/abc',
      expiresAt: '2026-08-06T04:00:00.000Z',
    });
    expect(presignFileMock).toHaveBeenCalledWith(expect.anything(), 'file_old');
  });

  it('404s the link when the employee has no photo, without presigning anything', async () => {
    repo.getById.mockResolvedValue(employeeRow({ photoFileId: null }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/hre_1/photo-link',
      headers: bearer(await workerToken('HR', 'hr-photo-reader')),
    });
    expect(res.statusCode).toBe(404);
    expect(presignFileMock).not.toHaveBeenCalled();
  });

  it('lets ANY internal worker resolve a photo link — directory is company-wide', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/hre_1/photo-link',
      headers: bearer(await workerToken('Sales Rep', 'sales-photo-peek')),
    });
    // Not 403: the HR-grant gate is gone for reads. (Any 404 here is only the fixture having no photo.)
    expect(res.statusCode).not.toBe(403);
  });
});

/**
 * The person panel routes. The directory is company-wide (read-only), so any internal worker may open
 * a colleague's panel — department, team, attendance, time off. Attendance inside it is still
 * team-scoped by the builder (`canView`), and management stays gated; customers are refused.
 */
describe('HR employees — person overview', () => {
  it('lets ANY internal worker resolve a Zoho sign-in — directory is company-wide', async () => {
    repo.findByZohoUserId.mockResolvedValue(employeeRow({ zohoUserId: '42' }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/by-zoho-user/42',
      headers: bearer(await workerToken('Sales Rep', 'sales-peek')),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.findByZohoUserId).toHaveBeenCalled();
  });

  it('404s a Zoho sign-in that has no employee record', async () => {
    repo.findByZohoUserId.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/by-zoho-user/999',
      headers: bearer(await workerToken('HR Manager', 'hr-overview-reader')),
    });
    expect(res.statusCode).toBe(404);
  });

  it('resolves a Zoho sign-in to the employee row', async () => {
    repo.findByZohoUserId.mockResolvedValue(employeeRow({ zohoUserId: '77' }));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/by-zoho-user/77',
      headers: bearer(await workerToken('HR Manager', 'hr-overview-reader')),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'hre_1', zohoUserId: '77' });
    expect(repo.findByZohoUserId).toHaveBeenCalledWith(expect.anything(), '77');
  });

  it('lets ANY internal worker read the overview — directory is company-wide', async () => {
    repo.getById.mockResolvedValue(employeeRow());
    overviewMock.mockResolvedValue({
      employee: employeeRow(),
      department: null,
      manager: null,
      team: { members: [], directReportCount: 0, ledDepartments: [] },
      attendance: { from: '2026-08-03', to: '2026-08-09', summary: null, canView: false },
      timeOff: { year: 2026, balances: [], requests: [] },
    } as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/hre_1/overview',
      headers: bearer(await workerToken('Sales Rep', 'sales-peek')),
    });
    expect(res.statusCode).toBe(200);
    expect(overviewMock).toHaveBeenCalled();
  });

  it('returns the assembled panel for an HR reader', async () => {
    repo.getById.mockResolvedValue(employeeRow());
    overviewMock.mockResolvedValue({
      employee: employeeRow(),
      department: null,
      manager: null,
      team: { members: [], directReportCount: 0, ledDepartments: [] },
      attendance: { from: '2026-08-03', to: '2026-08-09', summary: null, canView: false },
      timeOff: { year: 2026, balances: [], requests: [] },
    } as never);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/hre_1/overview?year=2026&weekOf=2026-08-05',
      headers: bearer(await workerToken('HR Manager', 'hr-overview-reader')),
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.employee).toMatchObject({ id: 'hre_1' });
    // Not a permission error — the block is simply marked unavailable for this viewer.
    expect(body.attendance).toMatchObject({ canView: false, summary: null });
    expect(overviewMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'hre_1' }), {
      year: 2026,
      weekOf: '2026-08-05',
    });
  });

  it('404s the overview for an unknown employee', async () => {
    repo.getById.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/hr/employees/nope/overview',
      headers: bearer(await workerToken('HR Manager', 'hr-overview-reader')),
    });
    expect(res.statusCode).toBe(404);
    expect(overviewMock).not.toHaveBeenCalled();
  });
});
