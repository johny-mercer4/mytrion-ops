/**
 * Escalation routing — the level-2/3/4 decisions, which are pure config reads.
 *
 * These are the assertions that keep "a NULL is unrouted, never a wildcard" true. Every one of them
 * would pass vacuously against a database with no config rows, which is exactly why the repos are mocked
 * and the returned config is explicit: a test that only proves "nothing routes when nothing is configured"
 * proves nothing about the case that matters.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/commsCatalogRepo.js', () => ({
  commsCatalogRepo: { byCode: vi.fn(), list: vi.fn() },
}));
vi.mock('../../src/repos/commsDepartmentRepo.js', () => ({
  commsDepartmentRepo: { get: vi.fn(), listPool: vi.fn() },
}));
vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: { findByZohoUserId: vi.fn() },
}));

import { commsCatalogRepo } from '../../src/repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../src/repos/commsDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import {
  C_LEVEL_DEPARTMENT,
  departmentOfWorker,
  resolveCLevel,
  resolveDepartmentManager,
  resolveHandOffTarget,
  resolveReason,
  resolveWorkerName,
} from '../../src/modules/comms/escalationRouting.js';
import type { MytrionDepartmentAgent, MytrionDepartmentConfig, MytrionTicketType } from '../../src/db/schema/index.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const ctx = {
  tenantId: 'octane',
  userId: 'zoho:42',
  userName: 'Ali',
  audience: 'internal',
  role: 'worker',
  scopes: [],
  departments: ['sales'],
  allDepartmentAccess: false,
  requestId: 'req_1',
} as TenantContext;

function reasonRow(over: Partial<MytrionTicketType> = {}): MytrionTicketType {
  return {
    id: 'mtty_1',
    tenantId: 'octane',
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

function configRow(over: Partial<MytrionDepartmentConfig> = {}): MytrionDepartmentConfig {
  return {
    id: 'mdcf_1',
    tenantId: 'octane',
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
    tenantId: 'octane',
    department: 'customer-service',
    zohoUserId: '77',
    displayName: 'Dilnoza',
    roleTitle: null,
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

beforeEach(() => {
  vi.mocked(commsCatalogRepo.byCode).mockReset();
  vi.mocked(commsDepartmentRepo.get).mockReset();
  vi.mocked(commsDepartmentRepo.listPool).mockReset();
  vi.mocked(hrEmployeeRepo.findByZohoUserId).mockReset();
});

describe('resolveReason — level 2 comes from the catalog row', () => {
  it('returns the configured fall-to user', async () => {
    vi.mocked(commsCatalogRepo.byCode).mockResolvedValue(
      reasonRow({ defaultAssigneeZohoUserId: '77' }),
    );
    const out = await resolveReason(ctx, 'ESC-01');
    expect(out.assigneeZohoUserId).toBe('77');
  });

  it('reports NULL as unrouted rather than substituting anything', async () => {
    vi.mocked(commsCatalogRepo.byCode).mockResolvedValue(reasonRow({ defaultAssigneeZohoUserId: null }));
    const out = await resolveReason(ctx, 'ESC-01');
    expect(out.assigneeZohoUserId).toBeNull();
  });

  it('treats a blank string as unrouted too — an empty routing key is not a routing key', async () => {
    vi.mocked(commsCatalogRepo.byCode).mockResolvedValue(reasonRow({ defaultAssigneeZohoUserId: '   ' }));
    const out = await resolveReason(ctx, 'ESC-01');
    expect(out.assigneeZohoUserId).toBeNull();
  });

  it('refuses an unknown code', async () => {
    vi.mocked(commsCatalogRepo.byCode).mockResolvedValue(undefined);
    await expect(resolveReason(ctx, 'NOPE')).rejects.toThrow(/Unknown escalation reason/i);
  });

  it('refuses a TICKET TYPE dressed up as a reason', async () => {
    vi.mocked(commsCatalogRepo.byCode).mockResolvedValue(
      reasonRow({ kind: 'ticket', code: 'C-7', targetDepartment: 'customer-service' }),
    );
    await expect(resolveReason(ctx, 'C-7')).rejects.toThrow(/Unknown escalation reason/i);
  });

  it('refuses a deactivated reason', async () => {
    vi.mocked(commsCatalogRepo.byCode).mockResolvedValue(
      reasonRow({ active: false, defaultAssigneeZohoUserId: '77' }),
    );
    await expect(resolveReason(ctx, 'ESC-01')).rejects.toThrow(/no longer available/i);
  });
});

describe('resolveDepartmentManager — level 3 comes from department config', () => {
  it('returns the configured manager and its snapshot name', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ managerZohoUserId: '88', managerName: 'Bekzod' }),
    );
    const out = await resolveDepartmentManager(ctx, 'customer-service');
    expect(out).toEqual({ zohoUserId: '88', name: 'Bekzod' });
  });

  it('a NULL manager is a skip, never a fallback to somebody', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(configRow({ managerZohoUserId: null }));
    const out = await resolveDepartmentManager(ctx, 'customer-service');
    expect(out.zohoUserId).toBeNull();
    expect(out.skipReason).toBe('no_manager');
  });

  it('a missing config row is a skip', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(undefined);
    const out = await resolveDepartmentManager(ctx, 'marketing');
    expect(out.zohoUserId).toBeNull();
    expect(out.skipReason).toBe('no_manager');
  });

  it('a null department resolves to a skip without even reading config', async () => {
    const out = await resolveDepartmentManager(ctx, null);
    expect(out.zohoUserId).toBeNull();
    expect(commsDepartmentRepo.get).not.toHaveBeenCalled();
  });

  it('NEVER consults hr_departments.lead_employee_id as a fallback', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(configRow({ managerZohoUserId: null }));
    await resolveDepartmentManager(ctx, 'customer-service');
    // The HR link is nullable and heuristic — a silent fallback through it could route a real escalation
    // to whoever happened to be linked. HR only ever SUGGESTS in the admin picker.
    expect(hrEmployeeRepo.findByZohoUserId).not.toHaveBeenCalled();
  });
});

describe('resolveCLevel — level 4 is validated against the pool', () => {
  it('accepts a member of the c-level pool and reports level 4', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([
      seat({ department: C_LEVEL_DEPARTMENT, zohoUserId: '111', displayName: 'Sardor', roleTitle: 'CEO' }),
      seat({ department: C_LEVEL_DEPARTMENT, zohoUserId: '222', displayName: 'Kamola', roleTitle: 'COO' }),
    ]);
    const out = await resolveCLevel(ctx, '222');
    expect(out).toMatchObject({
      zohoUserId: '222',
      name: 'Kamola',
      department: C_LEVEL_DEPARTMENT,
      level: 4,
      levelLabel: 'C-Level',
    });
  });

  it('refuses anyone not in the pool, and names the real options', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([
      seat({ department: C_LEVEL_DEPARTMENT, zohoUserId: '111', displayName: 'Sardor', roleTitle: 'CEO' }),
    ]);
    await expect(resolveCLevel(ctx, '31337')).rejects.toThrow(/not in the C-Level pool.*CEO \(Sardor\)/is);
  });

  it('an empty pool means level 4 is unavailable, and says how to fix it', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([]);
    await expect(resolveCLevel(ctx, '111')).rejects.toThrow(/No C-Level members are configured.*Mytrion Admin/is);
  });

  it('only reads ACTIVE seats — a deactivated CEO is not escalatable', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([]);
    await expect(resolveCLevel(ctx, '111')).rejects.toThrow();
    expect(commsDepartmentRepo.listPool).toHaveBeenCalledWith(ctx, {
      departments: [C_LEVEL_DEPARTMENT],
      activeOnly: true,
    });
  });
});

describe('resolveHandOffTarget — sideways, with an explicit roster check', () => {
  it('falls back to the department default assignee when nobody is named', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', defaultAssigneeZohoUserId: '99' }),
    );
    vi.mocked(hrEmployeeRepo.findByZohoUserId).mockResolvedValue(undefined);
    const out = await resolveHandOffTarget(ctx, 'billing');
    expect(out).toMatchObject({ zohoUserId: '99', department: 'billing' });
  });

  it('falls back to the manager when there is no default assignee', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', defaultAssigneeZohoUserId: null, managerZohoUserId: '88', managerName: 'Bekzod' }),
    );
    const out = await resolveHandOffTarget(ctx, 'billing');
    expect(out).toMatchObject({ zohoUserId: '88', name: 'Bekzod' });
  });

  it('refuses a department with neither configured', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', defaultAssigneeZohoUserId: null, managerZohoUserId: null }),
    );
    await expect(resolveHandOffTarget(ctx, 'billing')).rejects.toThrow(/no escalation assignee configured/i);
  });

  it('refuses a department that is not accepting escalations', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', acceptsEscalations: false, defaultAssigneeZohoUserId: '99' }),
    );
    await expect(resolveHandOffTarget(ctx, 'billing')).rejects.toThrow(/not accepting escalations/i);
  });

  it('refuses a department with no config row at all', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(undefined);
    await expect(resolveHandOffTarget(ctx, 'marketing')).rejects.toThrow(/no routing configuration/i);
  });

  it('a NAMED person must hold a pool seat in that department', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', defaultAssigneeZohoUserId: '99' }),
    );
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([
      seat({ department: 'billing', zohoUserId: '99', displayName: 'Nodira' }),
    ]);
    const out = await resolveHandOffTarget(ctx, 'billing', '99');
    expect(out.zohoUserId).toBe('99');
  });

  it('refuses a named person who is on no roster — "hand off to Billing" is not "assign to anyone"', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', defaultAssigneeZohoUserId: '99' }),
    );
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([
      seat({ department: 'billing', zohoUserId: '99' }),
    ]);
    await expect(resolveHandOffTarget(ctx, 'billing', '31337')).rejects.toThrow(
      /not on the billing escalation roster/i,
    );
  });

  it('accepts the configured manager even without a pool seat, using the config name and no HR call', async () => {
    vi.mocked(commsDepartmentRepo.get).mockResolvedValue(
      configRow({ department: 'billing', managerZohoUserId: '88', managerName: 'Bekzod' }),
    );
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([]);
    const out = await resolveHandOffTarget(ctx, 'billing', '88');
    expect(out).toMatchObject({ zohoUserId: '88', name: 'Bekzod', department: 'billing' });
    // The manager snapshot is already loaded, so there is no reason to go to HR for the same answer.
    expect(hrEmployeeRepo.findByZohoUserId).not.toHaveBeenCalled();
  });
});

describe('departmentOfWorker — the pool is the operational statement of who works where', () => {
  it('returns the pool seat department', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([
      seat({ department: 'customer-service', zohoUserId: '77' }),
    ]);
    expect(await departmentOfWorker(ctx, '77')).toBe('customer-service');
  });

  it('ignores a c-level seat — that is level 4, not somebody’s working department', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([
      seat({ department: C_LEVEL_DEPARTMENT, zohoUserId: '111', roleTitle: 'CEO' }),
    ]);
    expect(await departmentOfWorker(ctx, '111')).toBeNull();
  });

  it('returns null for someone on no pool, rather than guessing from HR', async () => {
    vi.mocked(commsDepartmentRepo.listPool).mockResolvedValue([]);
    expect(await departmentOfWorker(ctx, '77')).toBeNull();
    expect(hrEmployeeRepo.findByZohoUserId).not.toHaveBeenCalled();
  });
});

describe('resolveWorkerName — HR is a display-name source and nothing more', () => {
  it('prefers an explicit hint over any lookup', async () => {
    expect(await resolveWorkerName(ctx, '88', 'Bekzod')).toBe('Bekzod');
    expect(hrEmployeeRepo.findByZohoUserId).not.toHaveBeenCalled();
  });

  it('builds a full name from the HR row', async () => {
    vi.mocked(hrEmployeeRepo.findByZohoUserId).mockResolvedValue({
      firstName: 'Dilnoza',
      lastName: 'Karimova',
    } as never);
    expect(await resolveWorkerName(ctx, '77')).toBe('Dilnoza Karimova');
  });

  it('falls back to the id on an HR miss — a name gap must not break routing', async () => {
    vi.mocked(hrEmployeeRepo.findByZohoUserId).mockResolvedValue(undefined);
    expect(await resolveWorkerName(ctx, '77')).toBe('77');
  });

  it('falls back to the id when HR THROWS — same reason', async () => {
    vi.mocked(hrEmployeeRepo.findByZohoUserId).mockRejectedValue(new Error('hr down'));
    expect(await resolveWorkerName(ctx, '77')).toBe('77');
  });

  it('falls back to the id when the HR row has no usable name', async () => {
    vi.mocked(hrEmployeeRepo.findByZohoUserId).mockResolvedValue({
      firstName: '  ',
      lastName: null,
    } as never);
    expect(await resolveWorkerName(ctx, '77')).toBe('77');
  });
});
