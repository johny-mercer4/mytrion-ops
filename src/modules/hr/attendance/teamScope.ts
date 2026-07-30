/**
 * Who may view whose attendance: department managers (team) vs HR Manager / Admin (org-wide).
 */
import { RBACError } from '../../../lib/errors.js';
import { hrDepartmentRepo } from '../../../repos/hrDepartmentRepo.js';
import { hrEmployeeRepo, type HrEmployeeRow } from '../../../repos/hrEmployeeRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';

export type AttendanceTeamScope = 'direct' | 'all';
export type AttendanceTeamRelation = 'direct_report' | 'dept_member' | 'org';

export interface AttendanceTeamMember {
  employee: HrEmployeeRow;
  relation: AttendanceTeamRelation;
}

/** Administrator / CEO / elevated, or Zoho profile "HR Manager". */
export function canViewAllAttendance(ctx: TenantContext): boolean {
  if (ctx.allDepartmentAccess || ctx.bypassRbac || ctx.role === 'admin') return true;
  const profiles = ctx.profiles ?? [];
  return profiles.some((p) => {
    const n = p.trim().toLowerCase();
    return n === 'hr manager' || n.includes('hr manager');
  });
}

function nameMatches(q: string, emp: HrEmployeeRow): boolean {
  if (!q) return true;
  const hay = `${emp.firstName} ${emp.lastName} ${emp.email ?? ''} ${emp.employeeId ?? ''}`.toLowerCase();
  return hay.includes(q);
}

/**
 * Resolve the viewer's team for attendance.
 * - direct: reporting_to_employee_id = me
 * - all (manager): direct ∪ members of departments I lead
 * - all (HR Manager / Admin): entire Active directory
 * Self is never included (My Data is separate).
 */
export async function resolveAttendanceTeam(
  ctx: TenantContext,
  selfEmployeeId: string,
  scope: AttendanceTeamScope,
  q = '',
): Promise<{
  canViewAll: boolean;
  directCount: number;
  allCount: number;
  items: AttendanceTeamMember[];
}> {
  const canViewAll = canViewAllAttendance(ctx);
  const query = q.trim().toLowerCase();

  // Elevated viewers may have no linked employee row — skip reportee / lead lookups.
  const directs = selfEmployeeId
    ? await hrEmployeeRepo.listByReportingTo(ctx, selfEmployeeId, { status: 'Active' })
    : [];
  const directIds = new Set(directs.map((e) => e.id));

  const ledDeptIds = selfEmployeeId
    ? await hrDepartmentRepo.listIdsLedBy(ctx, selfEmployeeId)
    : [];
  const deptMembers = await hrEmployeeRepo.listByDepartmentIds(ctx, ledDeptIds, {
    status: 'Active',
  });

  const managerAllMap = new Map<string, AttendanceTeamMember>();
  for (const e of directs) {
    if (e.id === selfEmployeeId) continue;
    managerAllMap.set(e.id, { employee: e, relation: 'direct_report' });
  }
  for (const e of deptMembers) {
    if (e.id === selfEmployeeId) continue;
    if (managerAllMap.has(e.id)) continue;
    managerAllMap.set(e.id, {
      employee: e,
      relation: directIds.has(e.id) ? 'direct_report' : 'dept_member',
    });
  }

  let orgItems: AttendanceTeamMember[] = [];
  if (canViewAll) {
    const everyone = await hrEmployeeRepo.list(ctx, { status: 'Active', limit: 500 });
    orgItems = everyone
      .filter((e) => e.id !== selfEmployeeId)
      .map((e) => ({
        employee: e,
        relation: (directIds.has(e.id) ? 'direct_report' : 'org') as AttendanceTeamRelation,
      }));
  }

  const directItems: AttendanceTeamMember[] = directs
    .filter((e) => e.id !== selfEmployeeId)
    .map((e) => ({ employee: e, relation: 'direct_report' as const }));

  const allItems = canViewAll ? orgItems : [...managerAllMap.values()];
  allItems.sort((a, b) => {
    const ln = a.employee.lastName.localeCompare(b.employee.lastName);
    return ln !== 0 ? ln : a.employee.firstName.localeCompare(b.employee.firstName);
  });

  const pool = scope === 'direct' ? directItems : allItems;
  const items = pool.filter((m) => nameMatches(query, m.employee));

  return {
    canViewAll,
    directCount: directItems.length,
    allCount: allItems.length,
    items,
  };
}

/** Throw if the caller may not open this employee's attendance summary. */
export async function assertCanViewEmployeeAttendance(
  ctx: TenantContext,
  selfEmployeeId: string,
  targetEmployeeId: string,
): Promise<void> {
  if (targetEmployeeId === selfEmployeeId) return;
  if (canViewAllAttendance(ctx)) return;
  const team = await resolveAttendanceTeam(ctx, selfEmployeeId, 'all');
  if (team.items.some((m) => m.employee.id === targetEmployeeId)) return;
  throw new RBACError('You can only view attendance for your team');
}

/**
 * Shift assignment scope.
 *
 * HR Manager/Admin may assign anyone. A regular department manager may assign direct reports and
 * members of departments they lead, but not themselves or an unrelated employee. Kept separate
 * from the view assertion so a manager cannot turn "My Data" access into a self-assignment write.
 */
export async function assertCanAssignEmployeeShift(
  ctx: TenantContext,
  selfEmployeeId: string,
  targetEmployeeId: string,
): Promise<void> {
  if (canViewAllAttendance(ctx)) return;
  if (targetEmployeeId === selfEmployeeId) {
    throw new RBACError('Department managers cannot assign their own shift');
  }
  const team = await resolveAttendanceTeam(ctx, selfEmployeeId, 'all');
  if (team.items.some((member) => member.employee.id === targetEmployeeId)) return;
  throw new RBACError('You can only assign shifts to employees in your managed team');
}
