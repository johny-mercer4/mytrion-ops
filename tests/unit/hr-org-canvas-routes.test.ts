/**
 * Org-canvas writes (`PATCH /v1/hr/org/position`, `PATCH /v1/hr/org/reparent`).
 *
 * Two things are worth pinning here. First the gate: dragging a node RESHAPES the org chart and moves
 * people between departments, so it has to sit behind the same Mytrion-Admin check as editing a record
 * — a read-only HR user must not be able to do it by calling the endpoint directly. Second the cycle
 * guard: dropping a department onto its own descendant produces a ring with no root, and the canvas
 * layout then drops that whole branch off screen, which looks exactly like losing data.
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
    listDesignationPicklist: vi.fn(async () => []),
    setCanvasPosition: vi.fn(async () => true),
    setManager: vi.fn(),
    setDepartment: vi.fn(),
  },
}));

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: {
    list: vi.fn(async () => []),
    count: vi.fn(async () => 0),
    getById: vi.fn(async () => undefined),
    setCanvasPosition: vi.fn(async () => true),
    setParent: vi.fn(),
  },
}));

vi.mock('../../src/modules/hr/orgReparent.js', () => ({
  departmentWouldCycle: vi.fn(async () => false),
  employeeWouldCycle: vi.fn(async () => false),
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
  return {
    ...mod,
    audit: vi.fn(async () => undefined),
    auditFromContext: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { departmentWouldCycle, employeeWouldCycle } from '../../src/modules/hr/orgReparent.js';
import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';

const empRepo = vi.mocked(hrEmployeeRepo);
const deptRepo = vi.mocked(hrDepartmentRepo);
const deptCycle = vi.mocked(departmentWouldCycle);
const empCycle = vi.mocked(employeeWouldCycle);

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
  empRepo.setCanvasPosition.mockResolvedValue(true);
  deptRepo.setCanvasPosition.mockResolvedValue(true);
  deptCycle.mockResolvedValue(false);
  empCycle.mockResolvedValue(false);
});

async function workerToken(profile: string): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin', // stale — re-derived from profile
    worker: { zohoUserId: '42', userName: 'Test Worker', profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });

/** Only the fields the routes actually read back. */
const deptRow = {
  id: 'hrd_2',
  name: 'Operations',
  parentId: null,
} as unknown as Awaited<ReturnType<typeof hrDepartmentRepo.setParent>>;

const empRow = {
  id: 'hre_1',
  firstName: 'Ada',
  lastName: 'Lovelace',
} as unknown as Awaited<ReturnType<typeof hrEmployeeRepo.setManager>>;

describe('org canvas — the gate', () => {
  it('position refuses an unauthenticated caller', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/position',
      payload: { kind: 'department', id: 'hrd_1', position: { x: 10, y: 20 } },
    });
    expect(res.statusCode).toBe(401);
    expect(deptRepo.setCanvasPosition).not.toHaveBeenCalled();
  });

  it('position refuses an HR reader who is not a Mytrion Admin', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/position',
      headers: bearer(await workerToken('HR Manager')),
      payload: { kind: 'department', id: 'hrd_1', position: { x: 10, y: 20 } },
    });
    expect(res.statusCode).toBe(403);
    expect(deptRepo.setCanvasPosition).not.toHaveBeenCalled();
  });

  it('reparent refuses an HR reader who is not a Mytrion Admin', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('HR Manager')),
      payload: { kind: 'employee', id: 'hre_1', parentId: 'hrd_1', parentKind: 'department' },
    });
    expect(res.statusCode).toBe(403);
    expect(empRepo.setDepartment).not.toHaveBeenCalled();
  });
});

describe('org canvas — position', () => {
  // The route passes coordinates through verbatim; rounding to integers happens in the repo.
  it('an admin persists a dragged department position', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/position',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'department', id: 'hrd_1', position: { x: 12.4, y: -8.6 } },
    });
    expect(res.statusCode).toBe(200);
    expect(deptRepo.setCanvasPosition).toHaveBeenCalledWith(expect.anything(), 'hrd_1', {
      x: 12.4,
      y: -8.6,
    });
  });

  it('a null position hands the node back to the auto-layout', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/position',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'employee', id: 'hre_1', position: null },
    });
    expect(res.statusCode).toBe(200);
    expect(empRepo.setCanvasPosition).toHaveBeenCalledWith(expect.anything(), 'hre_1', null);
  });

  it('404s when the node is not in this tenant', async () => {
    deptRepo.setCanvasPosition.mockResolvedValue(false);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/position',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'department', id: 'hrd_other', position: { x: 1, y: 1 } },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a coordinate outside the bounded canvas', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/position',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'department', id: 'hrd_1', position: { x: 1e9, y: 0 } },
    });
    expect(res.statusCode).toBe(400);
    expect(deptRepo.setCanvasPosition).not.toHaveBeenCalled();
  });
});

describe('org canvas — reparent', () => {
  it('moves a sub-department under another department', async () => {
    deptRepo.setParent.mockResolvedValue(deptRow);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'department', id: 'hrd_2', parentId: 'hrd_1', parentKind: 'department' },
    });
    expect(res.statusCode).toBe(200);
    expect(deptRepo.setParent).toHaveBeenCalledWith(expect.anything(), 'hrd_2', 'hrd_1');
  });

  it('REFUSES a department drop that would create a cycle', async () => {
    deptCycle.mockResolvedValue(true);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'department', id: 'hrd_1', parentId: 'hrd_child', parentKind: 'department' },
    });
    expect(res.statusCode).toBe(400);
    expect(deptRepo.setParent).not.toHaveBeenCalled();
  });

  it('REFUSES a reporting line that would report to itself', async () => {
    empCycle.mockResolvedValue(true);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'employee', id: 'hre_1', parentId: 'hre_2', parentKind: 'employee' },
    });
    expect(res.statusCode).toBe(400);
    expect(empRepo.setManager).not.toHaveBeenCalled();
  });

  it('refuses to put a department under a PERSON', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'department', id: 'hrd_2', parentId: 'hre_1', parentKind: 'employee' },
    });
    expect(res.statusCode).toBe(400);
    expect(deptRepo.setParent).not.toHaveBeenCalled();
  });

  it('refuses a node dropped onto itself', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'employee', id: 'hre_1', parentId: 'hre_1', parentKind: 'employee' },
    });
    expect(res.statusCode).toBe(400);
    expect(empRepo.setManager).not.toHaveBeenCalled();
  });

  it('moves a person into a department', async () => {
    empRepo.setDepartment.mockResolvedValue(empRow);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'employee', id: 'hre_1', parentId: 'hrd_1', parentKind: 'department' },
    });
    expect(res.statusCode).toBe(200);
    // `true` = also detach the manager, so the node actually moves under the department it was
    // dropped on rather than staying under its manager.
    expect(empRepo.setDepartment).toHaveBeenCalledWith(expect.anything(), 'hre_1', 'hrd_1', true);
  });

  it('detaches a person from their manager on a null parent', async () => {
    empRepo.setManager.mockResolvedValue(empRow);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'employee', id: 'hre_1', parentId: null, parentKind: 'employee' },
    });
    expect(res.statusCode).toBe(200);
    expect(empRepo.setManager).toHaveBeenCalledWith(expect.anything(), 'hre_1', null);
    // No parent means nothing to walk, so the cycle guard must not be consulted at all.
    expect(empCycle).not.toHaveBeenCalled();
  });

  it('404s when the target row is not in this tenant', async () => {
    empRepo.setManager.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/hr/org/reparent',
      headers: bearer(await workerToken('Administrator')),
      payload: { kind: 'employee', id: 'hre_1', parentId: 'hre_other', parentKind: 'employee' },
    });
    expect(res.statusCode).toBe(404);
  });
});
