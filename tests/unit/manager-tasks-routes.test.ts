/**
 * Manager Tasks — `/v1/manager/:department/*`, the ONE task-CRUD path for every desk.
 *
 * Two invariants this suite exists to hold:
 *
 *  1. **Sales is not special.** `/manager/sales/tasks*` used to be re-implemented in
 *     salesKpi.routes.ts. Fastify prefers a static segment over a param, so that copy shadowed the
 *     generic route and the Sales desk ran different code — including a PATCH that never checked
 *     the task belonged to the desk. Sales must now behave exactly like Billing.
 *  2. **Type codes are desk-scoped.** A code scoped to another department must be refused even
 *     though it exists in the catalog; shared codes (`department: null`) must be accepted anywhere.
 *     Without this, a Billing form can file a Collection type under Billing and every per-desk
 *     report built on `task_type` quietly goes wrong.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/workerTaskRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/workerTaskRepo.js')>();
  return {
    ...mod,
    workerTaskRepo: {
      ...mod.workerTaskRepo,
      listTypes: vi.fn(),
      isTypeAllowed: vi.fn(),
      list: vi.fn(),
      countMatching: vi.fn(),
      deskCounts: vi.fn(),
      countByStatusForDepartment: vi.fn(),
      openLoadByAssignee: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      listEvents: vi.fn(),
    },
  };
});
vi.mock('../../src/modules/manager/departmentAssignees.js', async (importOriginal) => {
  const mod =
    await importOriginal<typeof import('../../src/modules/manager/departmentAssignees.js')>();
  return {
    ...mod,
    listDepartmentAssignees: vi.fn(async () => []),
    assertDepartmentAssignee: vi.fn(async () => undefined),
  };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { assertDepartmentAssignee } from '../../src/modules/manager/departmentAssignees.js';
import { workerTaskRepo } from '../../src/repos/workerTaskRepo.js';

const repo = vi.mocked(workerTaskRepo);
const assertAssignee = vi.mocked(assertDepartmentAssignee);

/**
 * The catalog as prod holds it after migration 0104: shared codes plus per-desk ones. The mocked
 * `isTypeAllowed` resolves against this so the test asserts the ROUTE's scoping decision, not a
 * hand-written boolean.
 */
const CATALOG: Array<{ code: string; department: string | null }> = [
  { code: 'general', department: null },
  { code: 'follow_up', department: null },
  { code: 'quote', department: 'sales' },
  { code: 'invoice_issue', department: 'billing' },
  { code: 'agency_filing', department: 'collection' },
];

function task(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-08-06T10:00:00.000Z');
  return {
    id: 'mwt_1',
    tenantId: DEFAULT_TENANT_ID,
    assigneeZohoUserId: '77',
    createdByUserId: 'zoho:42',
    source: 'manager',
    webhookKeyId: null,
    idempotencyKey: null,
    payloadHash: null,
    externalId: null,
    department: 'sales',
    taskType: 'general',
    subject: 'Call the carrier back',
    description: null,
    content: null,
    priority: 'normal',
    status: 'open',
    deadlineAt: null,
    completedAt: null,
    cancelledAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

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
  repo.isTypeAllowed.mockImplementation(async (_ctx, department, code) =>
    CATALOG.some((t) => t.code === code && (t.department === null || t.department === department)),
  );
  repo.listTypes.mockResolvedValue([]);
  repo.list.mockResolvedValue([]);
  repo.countMatching.mockResolvedValue(0);
  // One FILTER scan now answers both the desk-wide status counts and the filter-matching total.
  repo.deskCounts.mockResolvedValue({
    counts: { open: 0, in_progress: 0, completed: 0, cancelled: 0 },
    matching: 0,
  });
  repo.openLoadByAssignee.mockResolvedValue([]);
  assertAssignee.mockResolvedValue(undefined);
});

async function managerToken(profile = 'Management'): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: 'admin',
    worker: { zohoUserId: '42', userName: 'CI Test Admin', profile },
  });
}
const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

const DEPARTMENTS = ['sales', 'billing', 'collection', 'customer-service'] as const;

describe('manager tasks are management-gated on every desk', () => {
  it('refuses an unauthenticated caller', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/manager/sales/tasks' });
    expect(res.statusCode).toBe(401);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it.each(DEPARTMENTS)('refuses a non-manager on the %s desk', async (department) => {
    const token = await managerToken('Sales Rep');
    const res = await app.inject({
      method: 'GET',
      url: `/v1/manager/${department}/tasks`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
    expect(repo.list).not.toHaveBeenCalled();
  });

  it('rejects an unknown department rather than listing every task', async () => {
    const token = await managerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/marketing/tasks',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(400);
    expect(repo.list).not.toHaveBeenCalled();
  });
});

describe('Sales goes through the same generic route as every other desk', () => {
  it.each(DEPARTMENTS)('scopes the %s list to that department', async (department) => {
    const token = await managerToken();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/manager/${department}/tasks`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    expect(repo.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ department }),
    );
  });

  it('returns desk-wide counts and an honest total alongside the page', async () => {
    repo.list.mockResolvedValue([task(), task({ id: 'mwt_2' })] as never);
    repo.deskCounts.mockResolvedValue({
      counts: { open: 12, in_progress: 5, completed: 20, cancelled: 0 },
      matching: 37,
    });
    repo.openLoadByAssignee.mockResolvedValue([]);
    const token = await managerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/sales/tasks?limit=2',
      headers: bearer(token),
    });
    const body = res.json();
    expect(body.tasks).toHaveLength(2);
    expect(body.counts).toEqual({ open: 12, in_progress: 5, completed: 20, cancelled: 0 });
    expect(body.pagination).toEqual({ limit: 2, offset: 0, total: 37, hasMore: true });
  });

  it('keeps the status counts desk-wide when a status filter is applied', async () => {
    // The board reads these to decide WHICH status to filter by. Narrowing them to the active
    // filter would zero every column but the one already selected.
    const token = await managerToken();
    await app.inject({
      method: 'GET',
      url: '/v1/manager/sales/tasks?status=open',
      headers: bearer(token),
    });
    expect(repo.list).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: 'open' }),
    );
    // deskCounts receives the department plus the filter; it ignores status/priority/search when
    // computing the per-status totals, which is what keeps the other columns non-zero.
    expect(repo.deskCounts).toHaveBeenCalledWith(
      expect.anything(),
      'sales',
      expect.objectContaining({ status: 'open' }),
    );
  });

  it('refuses to PATCH a task that belongs to another desk', async () => {
    // The removed Sales-only copy of this route skipped exactly this check.
    repo.findById.mockResolvedValue(task({ department: 'billing' }) as never);
    const token = await managerToken();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/manager/sales/tasks/mwt_1',
      headers: bearer(token),
      payload: { version: 1, status: 'completed' },
    });
    expect(res.statusCode).toBe(404);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('refuses to read events for a task on another desk', async () => {
    repo.findById.mockResolvedValue(task({ department: 'collection' }) as never);
    const token = await managerToken();
    const res = await app.inject({
      method: 'GET',
      url: '/v1/manager/sales/tasks/mwt_1/events',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(404);
    expect(repo.listEvents).not.toHaveBeenCalled();
  });
});

describe('task types are scoped to the desk', () => {
  it('asks the catalog for this department only', async () => {
    const token = await managerToken();
    await app.inject({
      method: 'GET',
      url: '/v1/manager/billing/tasks/types',
      headers: bearer(token),
    });
    expect(repo.listTypes).toHaveBeenCalledWith(expect.anything(), 'billing');
  });

  it('accepts a shared code on any desk', async () => {
    repo.create.mockResolvedValue(task({ department: 'billing', taskType: 'follow_up' }) as never);
    const token = await managerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/billing/tasks',
      headers: bearer(token),
      payload: { assigneeZohoUserId: '77', type: 'follow_up', subject: 'Chase the invoice' },
    });
    expect(res.statusCode).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ department: 'billing', taskType: 'follow_up' }),
    );
  });

  it("accepts a desk's own code", async () => {
    repo.create.mockResolvedValue(task({ taskType: 'quote' }) as never);
    const token = await managerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/sales/tasks',
      headers: bearer(token),
      payload: { assigneeZohoUserId: '77', type: 'quote', subject: 'Quote for ABC Trucking' },
    });
    expect(res.statusCode).toBe(201);
  });

  it("refuses another desk's code even though it exists in the catalog", async () => {
    const token = await managerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/billing/tasks',
      headers: bearer(token),
      payload: { assigneeZohoUserId: '77', type: 'agency_filing', subject: 'File it' },
    });
    expect(res.statusCode).toBe(404);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('refuses a foreign code on PATCH too, not just on create', async () => {
    repo.findById.mockResolvedValue(task() as never);
    const token = await managerToken();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/manager/sales/tasks/mwt_1',
      headers: bearer(token),
      payload: { version: 1, type: 'invoice_issue' },
    });
    expect(res.statusCode).toBe(404);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('assignee eligibility', () => {
  it('refuses an assignee who is not on the desk', async () => {
    assertAssignee.mockRejectedValue(new Error('NOT_FOUND_ASSIGNEE'));
    const token = await managerToken();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/manager/sales/tasks',
      headers: bearer(token),
      payload: { assigneeZohoUserId: 'nobody', type: 'general', subject: 'Do a thing' },
    });
    expect(res.statusCode).toBe(404);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('re-checks eligibility when a PATCH reassigns', async () => {
    repo.findById.mockResolvedValue(task() as never);
    assertAssignee.mockRejectedValue(new Error('NOT_FOUND_ASSIGNEE'));
    const token = await managerToken();
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/manager/sales/tasks/mwt_1',
      headers: bearer(token),
      payload: { version: 1, assigneeZohoUserId: 'nobody' },
    });
    expect(res.statusCode).toBe(404);
    expect(repo.update).not.toHaveBeenCalled();
  });
});
