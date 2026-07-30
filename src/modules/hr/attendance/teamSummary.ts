/**
 * Build team attendance list rows (week totals per visible employee).
 */
import type { TenantContext } from '../../../types/tenantContext.js';
import { hrAttendancePunchRepo } from '../../../repos/hrAttendancePunchRepo.js';
import { hrAttendanceShiftRepo } from '../../../repos/hrAttendanceShiftRepo.js';
import { buildAttendanceSummaryFromRecords } from './summary.js';
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
    unscheduled: number;
  };
  lastPunch: {
    kind: string;
    punchedAt: string;
    localDateTime: string;
    doorName: string | null;
  } | null;
  currentState: 'in_office' | 'out_of_office' | 'no_activity';
}

export interface AttendanceTeamList {
  from: string;
  to: string;
  scope: AttendanceTeamScope;
  canViewAll: boolean;
  counts: { direct: number; all: number };
  unmappedPunches: number;
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
  const employeeIds = team.items.map((member) => member.employee.id);
  const [rangePunches, assignments, latestPunches] = await Promise.all([
    hrAttendancePunchRepo.listForEmployeesRange(ctx, employeeIds, from, to),
    hrAttendanceShiftRepo.assignmentsForEmployeesDate(ctx, employeeIds, to),
    hrAttendancePunchRepo.lastForEmployees(ctx, employeeIds),
  ]);
  const punchesByEmployee = new Map<string, typeof rangePunches>();
  for (const punch of rangePunches) {
    if (!punch.employeeId) continue;
    const employeePunches = punchesByEmployee.get(punch.employeeId) ?? [];
    employeePunches.push(punch);
    punchesByEmployee.set(punch.employeeId, employeePunches);
  }

  for (const member of team.items) {
    const e = member.employee;
    const summary = buildAttendanceSummaryFromRecords(
      e.id,
      from,
      to,
      punchesByEmployee.get(e.id) ?? [],
      assignments.get(e.id),
      latestPunches.get(e.id),
    );
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
        unscheduled: summary.totals.unscheduled,
      },
      lastPunch: summary.lastPunch,
      currentState: summary.currentState,
    });
  }

  const unmappedPunches = team.canViewAll
    ? await hrAttendancePunchRepo.countUnmappedRange(ctx, from, to)
    : 0;

  return {
    from,
    to,
    scope,
    canViewAll: team.canViewAll,
    counts: { direct: team.directCount, all: team.allCount },
    unmappedPunches,
    items,
  };
}
