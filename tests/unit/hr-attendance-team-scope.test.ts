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

/**
 * Roster order is by FIRST name.
 *
 * It was last name, which reads as a phone book: you scan the attendance roster looking for "Shohruh",
 * not "Bekmurodov", and in this directory surname order buries every `Abdu*` prefix together at the top
 * so the first screen is one indistinguishable block.
 */
describe('roster ordering', () => {
  beforeEach(() => {
    employees.listByReportingTo.mockResolvedValue([]);
    employees.listByDepartmentIds.mockResolvedValue([]);
    depts.listIdsLedBy.mockResolvedValue([]);
  });

  const admin = () => ctx({ role: 'admin', allDepartmentAccess: true });

  it('sorts by first name, not surname', async () => {
    employees.list.mockResolvedValue([
      emp('e1', 'Zafar Abdug`apporov'),
      emp('e2', 'Abbos Yusupov'),
      emp('e3', 'Malika Karimova'),
    ]);
    const team = await resolveAttendanceTeam(admin(), '', 'all', '');
    expect(team.items.map((m) => m.employee.firstName)).toEqual(['Abbos', 'Malika', 'Zafar']);
  });

  /**
   * The directory really does hold both — Zoho imports arrive upper-cased, manual rows do not.
   *
   * What this pins is that the comparison is COLLATED, not codepoint order: `'Z' < 'a'` by codepoint,
   * so a raw `<` (or an uncollated SQL `order by`) bunches every shouting name ahead of the rest and
   * the list reads as unsorted. `localeCompare` is what prevents that.
   */
  it('interleaves UPPER-CASE names instead of clumping them first', async () => {
    /**
     * These three SHARE a first letter, which is what makes the test discriminate.
     *
     * My first attempt used `Alina / Bekzod / UMIDJON / ZAFAR` — all distinct initials, all capitalised,
     * so codepoint and collated order agree and the assertion held either way. The two only disagree
     * from the second character on: codepoint gives `UMIDJON Ulugbek Umar` ('M' 77 < 'l' 108), collation
     * gives `Ulugbek Umar UMIDJON`.
     */
    employees.list.mockResolvedValue([
      emp('e1', 'Umar Aliyev'),
      emp('e2', 'UMIDJON ABDUGAPPOROV'),
      emp('e3', 'Ulugbek Kravtsov'),
    ]);
    const team = await resolveAttendanceTeam(admin(), '', 'all', '');
    expect(team.items.map((m) => m.employee.firstName)).toEqual(['Ulugbek', 'Umar', 'UMIDJON']);
  });

  it('breaks a first-name tie on surname, then on id for stability', async () => {
    employees.list.mockResolvedValue([
      emp('e2', 'Abdulaziz Raximov'),
      // e3 BEFORE e1 on purpose. Array.prototype.sort is stable, so with the ids fed in ascending
      // order the tiebreaker makes no difference and the test would pass without it.
      emp('e3', 'Abdulaziz Abdurasulov'),
      emp('e1', 'Abdulaziz Abdurasulov'),
    ]);
    const team = await resolveAttendanceTeam(admin(), '', 'all', '');
    // Same name twice must not swap places between fetches, or the roster shuffles on every refresh.
    expect(team.items.map((m) => m.employee.id)).toEqual(['e1', 'e3', 'e2']);
  });

  it('orders the direct-reports pane the same way', async () => {
    employees.listByReportingTo.mockResolvedValue([
      emp('e1', 'Zafar Aliyev'),
      emp('e2', 'Abbos Yusupov'),
    ]);
    const team = await resolveAttendanceTeam(ctx(), 'self_1', 'direct', '');
    expect(team.items.map((m) => m.employee.firstName)).toEqual(['Abbos', 'Zafar']);
  });
});
