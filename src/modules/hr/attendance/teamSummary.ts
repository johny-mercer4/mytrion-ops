/**
 * Build team attendance list rows (week totals per visible employee).
 */
import type { TenantContext } from '../../../types/tenantContext.js';
import { hrAttendancePunchRepo } from '../../../repos/hrAttendancePunchRepo.js';
import { hrAttendanceShiftRepo } from '../../../repos/hrAttendanceShiftRepo.js';
import { buildAttendanceSummaryFromRecords } from './summary.js';
import type { AttendancePresenceState } from './sessionize.js';
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
  /** So the roster can show the same face the employee directory shows. */
  photoFileId: string | null;
  relation: AttendanceTeamRelation;
  shift: {
    id: string;
    name: string;
    startLocal: string;
    endLocal: string;
    timezone: string;
  } | null;
  /**
   * The week's tally, or `null` when the caller asked for a directory rather than a report.
   *
   * Computing this means reading every punch for every listed person — measured against production:
   * 3.5s for 146 people and 2305 punches, roughly half the endpoint's total time — and the roster
   * shows it as one line per card that most visits never read. The detail panel fetches the full
   * summary for the ONE person clicked, so the number is a click away rather than 3.5s away for all.
   */
  totals: {
    payableDays: number;
    present: number;
    weekend: number;
    absent: number;
    unscheduled: number;
  } | null;
  lastPunch: {
    kind: string;
    punchedAt: string;
    localDateTime: string;
    doorName: string | null;
  } | null;
  currentState: AttendancePresenceState;
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
  options: { withTotals?: boolean } = {},
): Promise<AttendanceTeamList> {
  const withTotals = options.withTotals !== false;
  const calculatedAt = new Date();
  const team = await resolveAttendanceTeam(ctx, selfEmployeeId, scope, q);
  const items: AttendanceTeamListItem[] = [];
  const employeeIds = team.items.map((member) => member.employee.id);
  /**
   * `listForEmployeesRange` is the expensive one and the only one that is optional.
   *
   * Everything the roster renders WITHOUT the week tally — the shift line, the presence badge, and so
   * all four summary tiles — comes from the last punch and the current assignment, never from the
   * week's records: `currentState` is `presenceStateForLastPunch(last, now)`. So skipping the range
   * read costs exactly `totals` and nothing else.
   */
  const [rangePunches, assignments, latestPunches] = await Promise.all([
    withTotals
      ? hrAttendancePunchRepo.listForEmployeesRange(ctx, employeeIds, from, to)
      : Promise.resolve([]),
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
      calculatedAt,
    );
    items.push({
      employeeId: e.id,
      employeeCode: e.employeeId,
      firstName: e.firstName,
      lastName: e.lastName,
      designation: e.designation,
      department: e.department,
      departmentId: e.departmentId,
      photoFileId: e.photoFileId,
      relation: member.relation,
      shift: summary.shift,
      totals: withTotals
        ? {
            payableDays: summary.totals.payableDays,
            present: summary.totals.present,
            weekend: summary.totals.weekend,
            absent: summary.totals.absent,
            unscheduled: summary.totals.unscheduled,
          }
        : null,
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
