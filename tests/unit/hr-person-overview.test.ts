/**
 * The HR person panel (`/hr/employees/:id/overview` + the Zoho-user lookup).
 *
 * What matters here is that the panel is a LENS, not a login: it must never widen what the caller can
 * see. Two things carry that — the HR department gate on the route, and the per-viewer attendance
 * decision that degrades one block instead of failing the page.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../src/repos/hrEmployeeRepo.js', () => ({
  hrEmployeeRepo: {
    getById: vi.fn(),
    findByZohoUserId: vi.fn(),
    listByReportingTo: vi.fn(async () => []),
    listByDepartmentIds: vi.fn(async () => []),
  },
}));
vi.mock('../../src/repos/hrDepartmentRepo.js', () => ({
  hrDepartmentRepo: { getById: vi.fn(), listIdsLedBy: vi.fn(async () => []) },
}));
vi.mock('../../src/repos/hrLeavePolicyRepo.js', () => ({
  hrLeavePolicyRepo: { balanceSummary: vi.fn(async () => []) },
}));
vi.mock('../../src/repos/hrLeaveRequestRepo.js', () => ({
  hrLeaveRequestRepo: { listMine: vi.fn(async () => []) },
}));
vi.mock('../../src/modules/hr/attendance/summary.js', () => ({
  buildAttendanceSummary: vi.fn(async () => ({ employeeId: 'hre_1', days: [] })),
}));
vi.mock('../../src/modules/hr/attendance/teamScope.js', () => ({
  canViewAllAttendance: vi.fn(() => true),
  assertCanViewEmployeeAttendance: vi.fn(async () => undefined),
}));

import { RBACError } from '../../src/lib/errors.js';
import { buildHrPersonOverview } from '../../src/modules/hr/hrPersonOverview.js';
import { buildAttendanceSummary } from '../../src/modules/hr/attendance/summary.js';
import {
  assertCanViewEmployeeAttendance,
  canViewAllAttendance,
} from '../../src/modules/hr/attendance/teamScope.js';
import { hrDepartmentRepo } from '../../src/repos/hrDepartmentRepo.js';
import { hrEmployeeRepo } from '../../src/repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const empRepo = vi.mocked(hrEmployeeRepo);
const deptRepo = vi.mocked(hrDepartmentRepo);
const summaryMock = vi.mocked(buildAttendanceSummary);
const canAllMock = vi.mocked(canViewAllAttendance);
const assertViewMock = vi.mocked(assertCanViewEmployeeAttendance);

const ctx = {
  tenantId: 't1',
  userId: 'zoho:viewer',
  audience: 'internal',
  role: 'admin',
  departments: ['hr'],
  allDepartmentAccess: true,
} as unknown as TenantContext;

function row(over: Record<string, unknown> = {}) {
  return {
    id: 'hre_1',
    firstName: 'Ada',
    lastName: 'Lovelace',
    designation: 'Engineer',
    department: 'Engineering',
    departmentId: 'hrd_1',
    reportingToEmployeeId: null,
    status: 'Active',
    photoFileId: null,
    ...over,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  empRepo.listByReportingTo.mockResolvedValue([]);
  empRepo.listByDepartmentIds.mockResolvedValue([]);
  deptRepo.listIdsLedBy.mockResolvedValue([]);
  deptRepo.getById.mockResolvedValue(undefined);
  canAllMock.mockReturnValue(true);
  summaryMock.mockResolvedValue({ employeeId: 'hre_1', days: [] } as never);
});

describe('buildHrPersonOverview', () => {
  it('includes the attendance week when the viewer may see it', async () => {
    empRepo.findByZohoUserId.mockResolvedValue(row({ id: 'hre_viewer' }));
    const out = await buildHrPersonOverview(ctx, row(), { year: 2026, weekOf: '2026-08-05' });

    expect(out.attendance.canView).toBe(true);
    expect(out.attendance.summary).not.toBeNull();
    // Monday–Sunday around the anchor, matching the attendance API's own week.
    expect(out.attendance.from).toBe('2026-08-03');
    expect(out.attendance.to).toBe('2026-08-09');
  });

  /**
   * The degrade-don't-fail rule. A manager can read a colleague's directory record but not their
   * check-ins; returning 403 for the whole panel made the page look broken instead of partly private.
   */
  it('omits attendance instead of throwing when the viewer may not see it', async () => {
    canAllMock.mockReturnValue(false);
    empRepo.findByZohoUserId.mockResolvedValue(row({ id: 'hre_viewer' }));
    assertViewMock.mockRejectedValue(new RBACError('nope'));

    const out = await buildHrPersonOverview(ctx, row(), { year: 2026 });

    expect(out.attendance.canView).toBe(false);
    expect(out.attendance.summary).toBeNull();
    expect(summaryMock).not.toHaveBeenCalled();
  });

  it('treats an unlinked viewer as unable to see attendance rather than erroring', async () => {
    canAllMock.mockReturnValue(false);
    empRepo.findByZohoUserId.mockResolvedValue(undefined);

    const out = await buildHrPersonOverview(ctx, row(), { year: 2026 });

    expect(out.attendance.canView).toBe(false);
    expect(assertViewMock).not.toHaveBeenCalled();
  });

  it('lets a real error through rather than silently hiding attendance', async () => {
    canAllMock.mockReturnValue(false);
    empRepo.findByZohoUserId.mockResolvedValue(row({ id: 'hre_viewer' }));
    assertViewMock.mockRejectedValue(new Error('database on fire'));

    await expect(buildHrPersonOverview(ctx, row(), { year: 2026 })).rejects.toThrow(
      'database on fire',
    );
  });

  /**
   * Someone can be both a direct report and a member of a department the subject leads. The stronger
   * relation has to win, and they must appear exactly once — a duplicated row is a React key collision
   * and reads as two different people.
   */
  it('dedupes the team and prefers the direct-report relation', async () => {
    empRepo.findByZohoUserId.mockResolvedValue(row({ id: 'hre_viewer' }));
    empRepo.listByReportingTo.mockResolvedValue([row({ id: 'hre_2', firstName: 'Grace' })]);
    deptRepo.listIdsLedBy.mockResolvedValue(['hrd_1']);
    empRepo.listByDepartmentIds.mockResolvedValue([
      row({ id: 'hre_2', firstName: 'Grace' }),
      row({ id: 'hre_3', firstName: 'Alan' }),
      // The subject leads the department they are in; they are not their own team member.
      row({ id: 'hre_1' }),
    ]);
    deptRepo.getById.mockResolvedValue({ id: 'hrd_1', name: 'Engineering' } as never);

    const out = await buildHrPersonOverview(ctx, row(), { year: 2026 });

    expect(out.team.members.map((m) => m.id)).toEqual(['hre_2', 'hre_3']);
    expect(out.team.members[0]!.relation).toBe('direct_report');
    expect(out.team.members[1]!.relation).toBe('department_member');
    expect(out.team.directReportCount).toBe(1);
    expect(out.team.ledDepartments).toEqual([{ id: 'hrd_1', name: 'Engineering' }]);
  });

  it('reports no department rather than inventing one', async () => {
    empRepo.findByZohoUserId.mockResolvedValue(row({ id: 'hre_viewer' }));
    const out = await buildHrPersonOverview(ctx, row({ departmentId: null }), { year: 2026 });
    expect(out.department).toBeNull();
  });
});
