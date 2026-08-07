/**
 * One employee, seen whole: who they are, the department they sit in, the team around them, their
 * attendance week, and their time off.
 *
 * This is what the HR "View as" picker opens. It is deliberately a READ-ONLY projection assembled in
 * one round trip rather than five: the panel shows all five blocks at once, and five separate fetches
 * would paint it in pieces and make every open five times as slow.
 *
 * IT IS NOT IMPERSONATION. The caller stays themselves — their context, their audit trail, their
 * permissions. Nothing here re-resolves identity, so a viewer can never see more through this panel
 * than the boundary below already allows them to see through the ordinary HR routes.
 */
import { RBACError } from '../../lib/errors.js';
import { hrDepartmentRepo } from '../../repos/hrDepartmentRepo.js';
import { hrEmployeeRepo, type HrEmployeeRow } from '../../repos/hrEmployeeRepo.js';
import { hrLeavePolicyRepo, type LeaveBalanceRow } from '../../repos/hrLeavePolicyRepo.js';
import { hrLeaveRequestRepo } from '../../repos/hrLeaveRequestRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import {
  assertCanViewEmployeeAttendance,
  canViewAllAttendance,
} from './attendance/teamScope.js';
import { buildAttendanceSummary, type AttendanceSummary } from './attendance/summary.js';
import { uzbDateString, weekRangeContaining } from './attendance/uzbTime.js';

/** A colleague as the panel lists them — the directory row trimmed to what a roster line shows. */
export interface PersonTeamMember {
  id: string;
  firstName: string;
  lastName: string;
  designation: string | null;
  department: string | null;
  status: string;
  photoFileId: string | null;
  /**
   * How they are connected to the subject. A person can be both a direct report and a member of a
   * department the subject leads; `direct_report` wins, because that is the stronger relationship.
   */
  relation: 'direct_report' | 'department_member';
}

export interface HrPersonOverview {
  employee: HrEmployeeRow;
  department: {
    id: string;
    name: string;
    code: string | null;
    leadName: string | null;
    parentName: string | null;
    icon: string | null;
    iconColor: string | null;
    /** Everyone in the department, including the subject — the card's headline number. */
    headcount: number;
  } | null;
  manager: { id: string; name: string; designation: string | null } | null;
  team: {
    members: PersonTeamMember[];
    directReportCount: number;
    /** Departments where this person is the lead — why they may see people who do not report to them. */
    ledDepartments: { id: string; name: string }[];
  };
  attendance: {
    from: string;
    to: string;
    /** Null when the VIEWER may not see this person's attendance — see `canView`. */
    summary: AttendanceSummary | null;
    canView: boolean;
  };
  timeOff: {
    year: number;
    balances: LeaveBalanceRow[];
    requests: Awaited<ReturnType<typeof hrLeaveRequestRepo.listMine>>;
  };
}

/** The viewer's own employee row id, or '' when their sign-in is not linked to one. */
async function viewerEmployeeId(ctx: TenantContext): Promise<string> {
  if (!ctx.userId.startsWith('zoho:')) return '';
  const row = await hrEmployeeRepo.findByZohoUserId(ctx, ctx.userId.replace(/^zoho:/, ''));
  return row?.id ?? '';
}

/**
 * May this viewer see the subject's attendance?
 *
 * Attendance is scoped more tightly than the directory: HR Manager / Admin see everyone, a manager sees
 * their own team. Rather than failing the whole panel for a viewer who can legitimately read the
 * person's record but not their check-ins, this answers the question and the caller renders the block
 * as unavailable — the alternative was a 403 that made the entire page look broken.
 */
async function canViewAttendance(
  ctx: TenantContext,
  viewerId: string,
  targetId: string,
): Promise<boolean> {
  if (canViewAllAttendance(ctx)) return true;
  if (!viewerId) return false;
  try {
    await assertCanViewEmployeeAttendance(ctx, viewerId, targetId);
    return true;
  } catch (err) {
    if (err instanceof RBACError) return false;
    throw err;
  }
}

export async function buildHrPersonOverview(
  ctx: TenantContext,
  employee: HrEmployeeRow,
  opts: { year: number; weekOf?: string | undefined },
): Promise<HrPersonOverview> {
  const week = weekRangeContaining(opts.weekOf || uzbDateString(new Date()));
  const viewerId = await viewerEmployeeId(ctx);

  const [department, manager, directReports, ledDepartmentIds, balances, requests, attendanceOk] =
    await Promise.all([
      employee.departmentId ? hrDepartmentRepo.getById(ctx, employee.departmentId) : undefined,
      employee.reportingToEmployeeId
        ? hrEmployeeRepo.getById(ctx, employee.reportingToEmployeeId)
        : undefined,
      hrEmployeeRepo.listByReportingTo(ctx, employee.id, { status: 'Active' }),
      hrDepartmentRepo.listIdsLedBy(ctx, employee.id),
      hrLeavePolicyRepo.balanceSummary(ctx, employee.id, opts.year),
      hrLeaveRequestRepo.listMine(ctx, employee.id, { year: opts.year, limit: 50 }),
      canViewAttendance(ctx, viewerId, employee.id),
    ]);

  // Members of departments this person LEADS, minus the people already counted as direct reports and
  // minus the subject themselves — a lead is not their own team member.
  const ledMembers = await hrEmployeeRepo.listByDepartmentIds(ctx, ledDepartmentIds, {
    status: 'Active',
  });
  const seen = new Set<string>([employee.id]);
  const members: PersonTeamMember[] = [];
  const push = (row: HrEmployeeRow, relation: PersonTeamMember['relation']): void => {
    if (seen.has(row.id)) return;
    seen.add(row.id);
    members.push({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      designation: row.designation,
      department: row.department,
      status: row.status,
      photoFileId: row.photoFileId,
      relation,
    });
  };
  // Direct reports first, so the stronger relation wins the dedupe.
  for (const row of directReports) push(row, 'direct_report');
  for (const row of ledMembers) push(row, 'department_member');

  const ledDepartments = ledDepartmentIds.length
    ? (await Promise.all(ledDepartmentIds.map((id) => hrDepartmentRepo.getById(ctx, id))))
        .filter((d): d is NonNullable<typeof d> => d != null)
        .map((d) => ({ id: d.id, name: d.name }))
    : [];

  const headcount = employee.departmentId
    ? (await hrEmployeeRepo.listByDepartmentIds(ctx, [employee.departmentId])).length
    : 0;

  return {
    employee,
    department: department
      ? {
          id: department.id,
          name: department.name,
          code: department.code,
          leadName: department.leadName,
          parentName: department.parentName,
          icon: department.icon,
          iconColor: department.iconColor,
          headcount,
        }
      : null,
    manager: manager
      ? {
          id: manager.id,
          name: `${manager.firstName} ${manager.lastName}`.trim(),
          designation: manager.designation,
        }
      : null,
    team: {
      members,
      directReportCount: directReports.length,
      ledDepartments,
    },
    attendance: {
      from: week.from,
      to: week.to,
      summary: attendanceOk
        ? await buildAttendanceSummary(ctx, employee.id, week.from, week.to)
        : null,
      canView: attendanceOk,
    },
    timeOff: { year: opts.year, balances, requests },
  };
}
