/**
 * Comms routing administration (/v1/comms/admin) — the HTTP contract the Mytrion Admin screen calls.
 *
 * Route-level rather than repo-level, because what this surface can get wrong is not SQL: it is the
 * gate (one row here redirects every escalation in the company), the shape the screen depends on, and
 * whether a write is audited. Repos are mocked so none of that needs a database.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.API_KEY = 'test-secret-key';
});

vi.mock('../../src/repos/commsDepartmentRepo.js', () => ({
  commsDepartmentRepo: {
    list: vi.fn(async () => []),
    listPool: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    upsertConfig: vi.fn(),
    upsertPoolMember: vi.fn(),
    updatePoolMember: vi.fn(),
    removePoolMember: vi.fn(async () => true),
  },
}));

vi.mock('../../src/repos/commsCatalogRepo.js', () => ({
  commsCatalogRepo: { list: vi.fn(async () => []), byCode: vi.fn(), updateByCode: vi.fn() },
}));

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: { listAllForMapping: vi.fn(async () => []), findByZohoUserId: vi.fn() },
}));

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  // `list` feeds the HR-driven department section; `listIdsLedBy` marks a candidate as a department lead.
  hrDepartmentRepo: { list: vi.fn(async () => []), listIdsLedBy: vi.fn(async () => []) },
}));

vi.mock('../../src/modules/audit/auditLogger.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/modules/audit/auditLogger.js')>();
  return { ...mod, audit: vi.fn(async () => undefined), auditFromContext: vi.fn(async () => undefined) };
});

import { buildApp } from '../../src/app.js';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { signAccessToken } from '../../src/modules/auth/jwt.js';
import { commsCatalogRepo } from '../../src/repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../src/repos/commsDepartmentRepo.js';
import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import type { MytrionDepartmentAgent, MytrionDepartmentConfig, MytrionTicketType } from '../../src/db/schema/index.js';

const depts = vi.mocked(commsDepartmentRepo);
const catalog = vi.mocked(commsCatalogRepo);
const hr = vi.mocked(hrEmployeeRepo);
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
  depts.list.mockResolvedValue([]);
  depts.listPool.mockResolvedValue([]);
  catalog.list.mockResolvedValue([]);
  hr.listAllForMapping.mockResolvedValue([]);
  vi.mocked(hrDepartmentRepo.list).mockResolvedValue([]);
});

/** `allDepartmentAccess` is derived from the profile, so the token carries a profile, not a flag. */
async function tokenFor(opts: { profile: string; role?: 'admin' | 'worker' }): Promise<string> {
  return signAccessToken({
    userId: 'zoho:42',
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: opts.role ?? 'worker',
    worker: { zohoUserId: '42', userName: 'Test Worker', profile: opts.profile },
  });
}

const bearer = (t: string): Record<string, string> => ({ authorization: `Bearer ${t}` });
const apiKey = (): Record<string, string> => ({ 'x-api-key': 'test-secret-key' });

function configRow(over: Partial<MytrionDepartmentConfig> = {}): MytrionDepartmentConfig {
  return {
    id: 'mdcf_1',
    tenantId: DEFAULT_TENANT_ID,
    department: 'customer-service',
    hrDepartmentId: null,
    label: null,
    ticketAssignmentStrategy: 'round_robin',
    requireOnline: true,
    defaultAssigneeZohoUserId: null,
    managerZohoUserId: null,
    managerName: null,
    acceptsTickets: true,
    acceptsEscalations: true,
    slaHoursOverride: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  };
}

function seat(over: Partial<MytrionDepartmentAgent> = {}): MytrionDepartmentAgent {
  return {
    id: 'mda_1',
    tenantId: DEFAULT_TENANT_ID,
    department: 'c-level',
    zohoUserId: '111',
    displayName: 'Sardor',
    roleTitle: 'CEO',
    active: true,
    acceptsNew: true,
    maxOpen: null,
    sortOrder: 0,
    lastAssignedAt: null,
    assignedCount: 0,
    addedByZohoUserId: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  };
}

function reasonRow(over: Partial<MytrionTicketType> = {}): MytrionTicketType {
  return {
    id: 'mtty_1',
    tenantId: DEFAULT_TENANT_ID,
    code: 'ESC-01',
    label: 'Problem with the client',
    kind: 'escalation_reason',
    targetDepartment: null,
    group: 'Escalation Reason',
    defaultPriority: null,
    slaHours: null,
    defaultAssigneeZohoUserId: null,
    requestable: false,
    requiresCarrier: false,
    requiresCard: false,
    automationKey: null,
    active: true,
    sortOrder: 1,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...over,
  };
}

describe('comms admin — the gate', () => {
  it('refuses unauthenticated', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/comms/admin/routing' });
    expect(res.statusCode).toBe(401);
  });

  it('REFUSES an ordinary worker — one row here redirects every escalation in the company', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Sales Agent' })),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.message).toMatch(/all-department/i);
  });

  it('refuses a department HEAD too — holding one department is not enough', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Customer Service Head' })),
    });
    expect(res.statusCode).toBe(403);
  });

  it('allows an all-department admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.statusCode).toBe(200);
  });

  it('every write is gated the same way, not just the read', async () => {
    const worker = bearer(await tokenFor({ profile: 'Sales Agent' }));
    for (const [method, url, body] of [
      ['PATCH', '/v1/comms/admin/departments/billing', { managerZohoUserId: '88' }],
      ['POST', '/v1/comms/admin/departments/c-level/pool', { zohoUserId: '111' }],
      ['PATCH', '/v1/comms/admin/departments/c-level/pool/111', { active: false }],
      ['DELETE', '/v1/comms/admin/departments/c-level/pool/111', undefined],
      ['PATCH', '/v1/comms/admin/escalation-reasons/ESC-01', { defaultAssigneeZohoUserId: '77' }],
    ] as const) {
      const res = await app.inject({ method, url, headers: worker, ...(body ? { payload: body } : {}) });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect(depts.upsertConfig).not.toHaveBeenCalled();
    expect(depts.upsertPoolMember).not.toHaveBeenCalled();
    expect(catalog.updateByCode).not.toHaveBeenCalled();
  });
});

describe('GET /routing — the shape the screen depends on', () => {
  it('groups pool seats under their department and derives readiness server-side', async () => {
    depts.list.mockResolvedValue([
      configRow({ department: 'customer-service', managerZohoUserId: '88', managerName: 'Bekzod' }),
      configRow({ id: 'mdcf_2', department: 'billing', managerZohoUserId: null }),
      configRow({ id: 'mdcf_3', department: 'c-level', acceptsTickets: false }),
    ]);
    depts.listPool.mockResolvedValue([
      seat({ department: 'c-level', zohoUserId: '111', roleTitle: 'CEO' }),
      seat({ id: 'mda_2', department: 'c-level', zohoUserId: '222', roleTitle: 'COO', displayName: 'Kamola' }),
      seat({ id: 'mda_3', department: 'customer-service', zohoUserId: '77', roleTitle: null }),
    ]);
    catalog.list.mockResolvedValue([
      reasonRow({ code: 'ESC-01', defaultAssigneeZohoUserId: '77' }),
      reasonRow({ id: 'mtty_2', code: 'ESC-02', label: 'Question', defaultAssigneeZohoUserId: null }),
      // Inactive AND unrouted — must not be counted as a gap, because nobody can pick it anyway.
      reasonRow({ id: 'mtty_3', code: 'ESC-09', label: 'Old', active: false, defaultAssigneeZohoUserId: null }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const cs = body.departments.find((d: { department: string }) => d.department === 'customer-service');
    expect(cs.pool).toHaveLength(1);
    expect(cs.managerZohoUserId).toBe('88');

    expect(body.cLevel).toHaveLength(2);
    expect(body.cLevel.map((p: { roleTitle: string }) => p.roleTitle)).toEqual(['CEO', 'COO']);

    expect(body.readiness.unroutedReasons).toEqual(['ESC-02']);
    expect(body.readiness.departmentsMissingManager).toEqual(['billing']);
    expect(body.readiness.cLevelConfigured).toBe(true);
    expect(body.escalationReasons.find((r: { code: string }) => r.code === 'ESC-01').routed).toBe(true);
  });

  it('returns OUR OWN hr_departments, flags which are configured, and suggests a routing slug', async () => {
    vi.mocked(hrDepartmentRepo.list).mockResolvedValue([
      { id: 'hrd_cs', name: 'Customer Service', code: 'CS', parentId: null, leadEmployeeId: 'e1', leadName: 'Bekzod' },
      { id: 'hrd_bill', name: 'Billing & Accounting', code: null, parentId: null, leadEmployeeId: null, leadName: null },
      // A name that cannot become a valid queue-topic slug — must be surfaced as unconfigurable, not as a
      // broken row the admin can save.
      { id: 'hrd_bad', name: '3PL Ops', code: null, parentId: null, leadEmployeeId: null, leadName: null },
    ] as never);
    depts.list.mockResolvedValue([
      configRow({ department: 'customer-service', hrDepartmentId: 'hrd_cs', label: 'Old CS Name' }),
    ]);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const byId = new Map(body.hrDepartments.map((d: { id: string }) => [d.id, d]));
    expect(byId.get('hrd_cs')).toMatchObject({ suggestedSlug: 'customer-service', configured: true, leadEmployeeId: 'e1' });
    expect(byId.get('hrd_bill')).toMatchObject({ suggestedSlug: 'billing-accounting', configured: false });
    expect(byId.get('hrd_bad')).toMatchObject({ suggestedSlug: null, configured: false });

    // The LIVE HR name wins over the stored snapshot, so a rename in HR shows immediately.
    const cs = body.departments.find((d: { department: string }) => d.department === 'customer-service');
    expect(cs.label).toBe('Customer Service');
    expect(cs.unlinked).toBe(false);
  });

  it('an unlinked routing row is flagged so it can be mapped, and still renders', async () => {
    vi.mocked(hrDepartmentRepo.list).mockResolvedValue([]);
    depts.list.mockResolvedValue([configRow({ department: 'billing', hrDepartmentId: null, label: null })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    const row = res.json().departments[0];
    expect(row).toMatchObject({ department: 'billing', unlinked: true, label: 'billing' });
  });

  it('keeps the snapshot label when the HR department has since been deleted', async () => {
    vi.mocked(hrDepartmentRepo.list).mockResolvedValue([]);
    depts.list.mockResolvedValue([
      configRow({ department: 'retention', hrDepartmentId: 'hrd_gone', label: 'Retention Team' }),
    ]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    // Historical escalations still have to render as something.
    expect(res.json().departments[0].label).toBe('Retention Team');
  });

  it('degrades to an empty HR list rather than failing the whole screen', async () => {
    vi.mocked(hrDepartmentRepo.list).mockRejectedValue(new Error('hr down'));
    depts.list.mockResolvedValue([configRow()]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    // Without HR an admin can still see and fix the routing rows that already exist.
    expect(res.statusCode).toBe(200);
    expect(res.json().hrDepartments).toEqual([]);
    expect(res.json().departments).toHaveLength(1);
  });

  it('accepts an hrDepartmentId + label on a department patch', async () => {
    depts.get.mockResolvedValue(configRow());
    depts.upsertConfig.mockResolvedValue(configRow({ hrDepartmentId: 'hrd_cs', label: 'Customer Service' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/customer-service',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
      payload: { hrDepartmentId: 'hrd_cs', label: 'Customer Service' },
    });
    expect(res.statusCode).toBe(200);
    expect(depts.upsertConfig).toHaveBeenCalledWith(
      expect.anything(),
      'customer-service',
      expect.objectContaining({ hrDepartmentId: 'hrd_cs', label: 'Customer Service' }),
    );
  });

  it('reports cLevelConfigured false when every C-Level seat is deactivated', async () => {
    depts.list.mockResolvedValue([configRow({ department: 'c-level' })]);
    depts.listPool.mockResolvedValue([seat({ active: false })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.json().readiness.cLevelConfigured).toBe(false);
  });

  it('an inactive reason is not a readiness gap', async () => {
    catalog.list.mockResolvedValue([reasonRow({ active: false, defaultAssigneeZohoUserId: null })]);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/routing',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.json().readiness.unroutedReasons).toEqual([]);
  });
});

describe('GET /candidates — HR suggests, the config decides', () => {
  it('drops employees with no Zoho user id — that id IS the routing key', async () => {
    hr.listAllForMapping.mockResolvedValue([
      { id: 'e1', firstName: 'Dilnoza', lastName: 'K', email: 'd@x.com', zohoUserId: '77', department: 'Customer Service', designation: 'Agent', status: 'Active' },
      { id: 'e2', firstName: 'Unlinked', lastName: 'Person', email: 'u@x.com', zohoUserId: null, department: 'Sales', designation: null, status: 'Active' },
      { id: 'e3', firstName: 'Blank', lastName: 'Link', email: 'b@x.com', zohoUserId: '  ', department: 'Sales', designation: null, status: 'Active' },
    ] as never);

    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/candidates',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ zohoUserId: '77', name: 'Dilnoza K' });
  });

  it('searches across name, email, designation and department', async () => {
    hr.listAllForMapping.mockResolvedValue([
      { id: 'e1', firstName: 'A', lastName: 'One', email: 'a@x.com', zohoUserId: '1', department: 'Billing', designation: 'Accountant', status: 'Active' },
      { id: 'e2', firstName: 'B', lastName: 'Two', email: 'b@x.com', zohoUserId: '2', department: 'Sales', designation: 'Agent', status: 'Active' },
    ] as never);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/comms/admin/candidates?q=accountant',
      headers: bearer(await tokenFor({ profile: 'Administrator', role: 'admin' })),
    });
    expect(res.json().candidates.map((c: { zohoUserId: string }) => c.zohoUserId)).toEqual(['1']);
  });
});

describe('writes — validation and the audit trail', () => {
  const adminHeaders = async (): Promise<Record<string, string>> =>
    bearer(await tokenFor({ profile: 'Administrator', role: 'admin' }));

  it('a non-numeric Zoho id is refused before it can become a routing target', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/billing',
      headers: await adminHeaders(),
      payload: { managerZohoUserId: 'not-an-id' },
    });
    expect(res.statusCode).toBe(400);
    expect(depts.upsertConfig).not.toHaveBeenCalled();
  });

  it('a department slug that would break the WS queue topic is refused', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/Billing%20Team',
      headers: await adminHeaders(),
      payload: { acceptsEscalations: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('an empty patch is refused rather than writing an empty update', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/billing',
      headers: await adminHeaders(),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('setting a manager audits BEFORE and AFTER — "what was it before?" is the point of the row', async () => {
    depts.get.mockResolvedValue(configRow({ department: 'billing', managerZohoUserId: '55' }));
    depts.upsertConfig.mockResolvedValue(
      configRow({ department: 'billing', managerZohoUserId: '88', managerName: 'Bekzod' }),
    );
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/billing',
      headers: await adminHeaders(),
      payload: { managerZohoUserId: '88', managerName: 'Bekzod' },
    });
    expect(res.statusCode).toBe(200);
    expect(audited).toHaveBeenCalledTimes(1);
    const entry = audited.mock.calls[0]?.[1];
    expect(entry?.action).toBe('comms.admin.department.update');
    // `detail` is typed as Record<string, unknown> at the audit boundary, so narrow it here rather than
    // asserting the call signature is something it is not.
    const detail = entry?.detail as {
      before: { managerZohoUserId: string | null };
      after: { managerZohoUserId: string | null };
    };
    expect(detail.before.managerZohoUserId).toBe('55');
    expect(detail.after.managerZohoUserId).toBe('88');
  });

  it('explicit null clears a manager (unroutes level 3) rather than being ignored', async () => {
    depts.get.mockResolvedValue(configRow({ managerZohoUserId: '88' }));
    depts.upsertConfig.mockResolvedValue(configRow({ managerZohoUserId: null }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/billing',
      headers: await adminHeaders(),
      payload: { managerZohoUserId: null },
    });
    expect(res.statusCode).toBe(200);
    expect(depts.upsertConfig).toHaveBeenCalledWith(
      expect.anything(),
      'billing',
      expect.objectContaining({ managerZohoUserId: null }),
    );
  });

  it('a reason patch refuses a code that is a TICKET TYPE, not a reason', async () => {
    catalog.byCode.mockResolvedValue(reasonRow({ code: 'C-7', kind: 'ticket', targetDepartment: 'customer-service' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/escalation-reasons/C-7',
      headers: await adminHeaders(),
      payload: { defaultAssigneeZohoUserId: '77' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/ticket type, not an escalation reason/i);
    expect(catalog.updateByCode).not.toHaveBeenCalled();
  });

  it('a reason patch 404s an unknown code', async () => {
    catalog.byCode.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/escalation-reasons/NOPE',
      headers: await adminHeaders(),
      payload: { defaultAssigneeZohoUserId: '77' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('setting a reason assignee returns the routed flag the screen renders', async () => {
    catalog.byCode.mockResolvedValue(reasonRow({ defaultAssigneeZohoUserId: null }));
    catalog.updateByCode.mockResolvedValue(reasonRow({ defaultAssigneeZohoUserId: '77' }));
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/escalation-reasons/ESC-01',
      headers: await adminHeaders(),
      payload: { defaultAssigneeZohoUserId: '77' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().reason).toMatchObject({ code: 'ESC-01', routed: true, defaultAssigneeZohoUserId: '77' });
    expect(audited).toHaveBeenCalledTimes(1);
  });

  it('a pool upsert records the role title, which is what distinguishes CEO from COO', async () => {
    depts.upsertPoolMember.mockResolvedValue(seat({ roleTitle: 'COO', zohoUserId: '222' }));
    const res = await app.inject({
      method: 'POST',
      url: '/v1/comms/admin/departments/c-level/pool',
      headers: await adminHeaders(),
      payload: { zohoUserId: '222', displayName: 'Kamola', roleTitle: 'COO' },
    });
    expect(res.statusCode).toBe(200);
    expect(depts.upsertPoolMember).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ department: 'c-level', zohoUserId: '222', roleTitle: 'COO' }),
    );
    expect(audited).toHaveBeenCalledTimes(1);
  });

  it('patching a seat that is not in the pool 404s', async () => {
    depts.updatePoolMember.mockResolvedValue(undefined);
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/comms/admin/departments/c-level/pool/999',
      headers: await adminHeaders(),
      payload: { active: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('removing a seat that is not in the pool 404s', async () => {
    depts.removePoolMember.mockResolvedValue(false);
    const res = await app.inject({
      method: 'DELETE',
      url: '/v1/comms/admin/departments/c-level/pool/999',
      headers: await adminHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('an unverified API-key caller is accepted as bypass — server-to-server config still works', async () => {
    // The api-key path sets bypassRbac, which requireCommsAdmin honours. Asserted so the seeding path
    // used by scripts does not silently break when the gate is tightened.
    const res = await app.inject({ method: 'GET', url: '/v1/comms/admin/routing', headers: apiKey() });
    expect(res.statusCode).toBe(200);
  });
});
