import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { TenantContext } from '../../src/types/tenantContext.js';
import type { HrEmployeeRow } from '../../src/repos/hrEmployeeRepo.js';

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    listByReportingTo: vi.fn(),
    listByDepartmentIds: vi.fn(),
    list: vi.fn(),
  },
}));

vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: {
    listIdsLedBy: vi.fn(),
  },
}));

import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import {
  assertCanViewEmployeeAttendance,
  canViewAllAttendance,
  resolveAttendanceTeam,
} from '../../src/modules/hr/attendance/teamScope.js';
import { RBACError } from '../../src/lib/errors.js';

const employees = vi.mocked(hrEmployeeRepo);
const depts = vi.mocked(hrDepartmentRepo);

function ctx(overrides: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:1',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['hr'],
    allDepartmentAccess: false,
    requestId: 'test',
    ...overrides,
  };
}

function emp(id: string, name: string, extra: Partial<HrEmployeeRow> = {}): HrEmployeeRow {
  const [firstName, lastName = 'X'] = name.split(' ');
  return {
    id,
    tenantId: DEFAULT_TENANT_ID,
    zohoRecordId: null,
    employeeId: id,
    firstName: firstName ?? 'A',
    lastName,
    email: null,
    departmentId: null,
    department: null,
    departmentZohoId: null,
    designation: null,
    location: null,
    status: 'Active',
    role: null,
    dateOfJoining: null,
    mobile: null,
    faceId: null,
    telegramUsername: null,
    reportingTo: null,
    reportingToZohoId: null,
    reportingToEmployeeId: null,
    photoUrl: null,
    photoFileId: null,
    zohoUserId: null,
    zohoUserIdSource: null,
    zohoUserLinkedAt: null,
    canvasX: null,
    canvasY: null,
    source: 'manual',
    lastSyncedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  employees.listByReportingTo.mockResolvedValue([]);
  employees.listByDepartmentIds.mockResolvedValue([]);
  employees.list.mockResolvedValue([]);
  depts.listIdsLedBy.mockResolvedValue([]);
});

describe('canViewAllAttendance', () => {
  it('allows Administrator via allDepartmentAccess', () => {
    expect(canViewAllAttendance(ctx({ allDepartmentAccess: true }))).toBe(true);
  });

  it('allows HR Manager profile', () => {
    expect(canViewAllAttendance(ctx({ profiles: ['HR Manager'] }))).toBe(true);
  });

  it('denies a plain HR reader / department manager', () => {
    expect(canViewAllAttendance(ctx({ profiles: ['Sales Manager'] }))).toBe(false);
  });
});

describe('resolveAttendanceTeam', () => {
  it('direct = reportees only; all = reportees ∪ dept members for a manager', async () => {
    const report = emp('hre_r', 'Rep One', { reportingToEmployeeId: 'hre_me' });
    const member = emp('hre_m', 'Mem Two', { departmentId: 'hrd_1' });
    employees.listByReportingTo.mockResolvedValue([report]);
    depts.listIdsLedBy.mockResolvedValue(['hrd_1']);
    employees.listByDepartmentIds.mockResolvedValue([member, report]);

    const direct = await resolveAttendanceTeam(ctx(), 'hre_me', 'direct');
    expect(direct.directCount).toBe(1);
    expect(direct.items.map((i) => i.employee.id)).toEqual(['hre_r']);

    const all = await resolveAttendanceTeam(ctx(), 'hre_me', 'all');
    expect(all.allCount).toBe(2);
    expect(all.items.map((i) => i.employee.id).sort()).toEqual(['hre_m', 'hre_r']);
  });

  it('HR Manager All lists the org directory', async () => {
    const a = emp('hre_a', 'Ann Admin');
    const b = emp('hre_b', 'Bob Worker');
    employees.list.mockResolvedValue([a, b, emp('hre_me', 'Me Self')]);
    employees.listByReportingTo.mockResolvedValue([]);

    const all = await resolveAttendanceTeam(
      ctx({ profiles: ['HR Manager'] }),
      'hre_me',
      'all',
    );
    expect(all.canViewAll).toBe(true);
    expect(all.allCount).toBe(2);
    expect(all.items.every((i) => i.employee.id !== 'hre_me')).toBe(true);
  });
});

describe('assertCanViewEmployeeAttendance', () => {
  it('allows self and team members; blocks outsiders for managers', async () => {
    const report = emp('hre_r', 'Rep One');
    employees.listByReportingTo.mockResolvedValue([report]);
    depts.listIdsLedBy.mockResolvedValue([]);
    employees.listByDepartmentIds.mockResolvedValue([]);

    await expect(assertCanViewEmployeeAttendance(ctx(), 'hre_me', 'hre_me')).resolves.toBeUndefined();
    await expect(assertCanViewEmployeeAttendance(ctx(), 'hre_me', 'hre_r')).resolves.toBeUndefined();
    await expect(assertCanViewEmployeeAttendance(ctx(), 'hre_me', 'hre_x')).rejects.toBeInstanceOf(
      RBACError,
    );
  });
});
