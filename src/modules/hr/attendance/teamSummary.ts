/**
 * Build team attendance list rows (week totals per visible employee).
 */
import type { TenantContext } from '../../../types/tenantContext.js';
import { buildAttendanceSummary } from './summary.js';
import {
  resolveAttendanceTeam,
  type AttendanceTeamRelation,
  type AttendanceTeamScope,
} from './teamScope.js';

export interface AttendanceTeamListItem {
  employeeId: string;
  employeeCode: string | null;
  firstName: string;
  lastName: string;
  designation: string | null;
  department: string | null;
  departmentId: string | null;
  relation: AttendanceTeamRelation;
  shift: {
    id: string;
    name: string;
    startLocal: string;
    endLocal: string;
    timezone: string;
  } | null;
  totals: {
    payableDays: number;
    present: number;
    weekend: number;
    absent: number;
  };
  lastPunch: {
    kind: string;
    punchedAt: string;
    doorName: string | null;
  } | null;
}

export interface AttendanceTeamList {
  from: string;
  to: string;
  scope: AttendanceTeamScope;
  canViewAll: boolean;
  counts: { direct: number; all: number };
  items: AttendanceTeamListItem[];
}

export async function buildAttendanceTeamList(
  ctx: TenantContext,
  selfEmployeeId: string,
  from: string,
  to: string,
  scope: AttendanceTeamScope,
  q = '',
): Promise<AttendanceTeamList> {
  const team = await resolveAttendanceTeam(ctx, selfEmployeeId, scope, q);
  const items: AttendanceTeamListItem[] = [];

  // Sequential on purpose — keeps DB load predictable for directory-sized teams.
  for (const member of team.items) {
    const summary = await buildAttendanceSummary(ctx, member.employee.id, from, to);
    const e = member.employee;
    items.push({
      employeeId: e.id,
      employeeCode: e.employeeId,
      firstName: e.firstName,
      lastName: e.lastName,
      designation: e.designation,
      department: e.department,
      departmentId: e.departmentId,
      relation: member.relation,
      shift: summary.shift,
      totals: {
        payableDays: summary.totals.payableDays,
        present: summary.totals.present,
        weekend: summary.totals.weekend,
        absent: summary.totals.absent,
      },
      lastPunch: summary.lastPunch,
    });
  }

  return {
    from,
    to,
    scope,
    canViewAll: team.canViewAll,
    counts: { direct: team.directCount, all: team.allCount },
    items,
  };
}
