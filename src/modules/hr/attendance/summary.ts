/**
 * Build a week/range attendance summary for one employee (My Data view).
 */
import type { HrAttendancePunch } from '../../../db/schema/index.js';
import { hrAttendancePunchRepo } from '../../../repos/hrAttendancePunchRepo.js';
import {
  hrAttendanceShiftRepo,
  type AttendanceAssignmentWithShift,
} from '../../../repos/hrAttendanceShiftRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import {
  eachDateInclusive,
  formatDurationHours,
  formatUzbDateTime,
  formatUzbHhMmSs,
  isUzbWeekend,
} from './uzbTime.js';
import {
  MAX_LIVE_ATTENDANCE_SESSION_MS,
  pairAttendancePunches,
  type AttendancePresenceState,
} from './sessionize.js';

export type DayStatus = 'Present' | 'Absent' | 'Weekend' | 'Unscheduled';

export interface AttendanceDayRow {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  hoursWorked: string;
  hoursWorkedMs: number;
  punchCount: number;
  currentState: AttendancePresenceState;
  unmatchedPunches: number;
  sessions: Array<{
    checkIn: string;
    checkOut: string | null;
    checkInDoor: string | null;
    checkOutDoor: string | null;
    duration: string;
    durationMs: number;
    checkInAt: string;
    checkOutAt: string | null;
    status: 'complete' | 'open' | 'needs_review';
  }>;
}

export interface AttendanceSummary {
  employeeId: string;
  from: string;
  to: string;
  calculatedAt: string;
  timezone: 'Asia/Tashkent';
  shift: {
    id: string;
    name: string;
    startLocal: string;
    endLocal: string;
    timezone: string;
  } | null;
  days: AttendanceDayRow[];
  totals: {
    payableDays: number;
    present: number;
    weekend: number;
    absent: number;
    unscheduled: number;
    onDuty: number;
    paidLeave: number;
    holidays: number;
  };
  lastPunch: {
    kind: string;
    punchedAt: string;
    localDateTime: string;
    doorName: string | null;
  } | null;
  currentState: AttendancePresenceState;
}

export async function buildAttendanceSummary(
  ctx: TenantContext,
  employeeId: string,
  from: string,
  to: string,
): Promise<AttendanceSummary> {
  const punches = await hrAttendancePunchRepo.listForEmployeeRange(ctx, employeeId, from, to);
  // Resolve the assignment at the end of the requested range so a shift that starts mid-week is
  // immediately visible in the current-week UI (the rollout itself began on 2026-07-30).
  const asg = await hrAttendanceShiftRepo.assignmentForDate(ctx, employeeId, to);
  const last = await hrAttendancePunchRepo.lastForEmployee(ctx, employeeId);
  return buildAttendanceSummaryFromRecords(employeeId, from, to, punches, asg, last, new Date());
}

/** Pure summary builder shared by My Data and the batched HR Team directory. */
export function buildAttendanceSummaryFromRecords(
  employeeId: string,
  from: string,
  to: string,
  punches: HrAttendancePunch[],
  asg: AttendanceAssignmentWithShift | undefined,
  last: HrAttendancePunch | undefined,
  calculatedAt = new Date(),
): AttendanceSummary {
  const byDate = new Map<string, HrAttendancePunch[]>();
  for (const p of punches) {
    const list = byDate.get(p.workDate) ?? [];
    list.push(p);
    byDate.set(p.workDate, list);
  }
  const shift = asg
    ? {
        id: asg.shift.id,
        name: asg.shift.name,
        startLocal: asg.shift.startLocal,
        endLocal: asg.shift.endLocal,
        timezone: asg.shift.timezone,
      }
    : null;

  const days: AttendanceDayRow[] = [];
  let present = 0;
  let weekend = 0;
  let absent = 0;
  let unscheduled = 0;

  for (const date of eachDateInclusive(from, to)) {
    const dayPunches = byDate.get(date) ?? [];
    const weekendDay = isUzbWeekend(date);
    const scheduled =
      asg != null &&
      asg.effectiveFrom <= date &&
      (asg.effectiveTo == null || asg.effectiveTo >= date);
    const paired = pairAttendancePunches(dayPunches, { now: calculatedAt });
    let status: DayStatus;
    if (weekendDay && dayPunches.length === 0) {
      status = 'Weekend';
      weekend += 1;
    } else if (paired.firstIn) {
      status = 'Present';
      present += 1;
    } else if (weekendDay) {
      status = 'Weekend';
      weekend += 1;
    } else if (!scheduled) {
      status = 'Unscheduled';
      unscheduled += 1;
    } else {
      status = 'Absent';
      absent += 1;
    }
    days.push({
      date,
      status,
      firstIn: paired.firstIn ? formatUzbHhMmSs(paired.firstIn) : null,
      lastOut: paired.lastOut ? formatUzbHhMmSs(paired.lastOut) : null,
      hoursWorked: formatDurationHours(paired.totalMs),
      hoursWorkedMs: paired.totalMs,
      punchCount: dayPunches.length,
      currentState: paired.currentState,
      unmatchedPunches: paired.unmatchedPunches,
      sessions: paired.sessions.map((session) => ({
        checkIn: formatUzbHhMmSs(session.checkIn),
        checkOut: session.checkOut ? formatUzbHhMmSs(session.checkOut) : null,
        checkInDoor: session.checkInDoor,
        checkOutDoor: session.checkOutDoor,
        duration: formatDurationHours(session.durationMs),
        durationMs: session.durationMs,
        checkInAt: session.checkIn.toISOString(),
        checkOutAt: session.checkOut?.toISOString() ?? null,
        status: session.status,
      })),
    });
  }

  return {
    employeeId,
    from,
    to,
    calculatedAt: calculatedAt.toISOString(),
    timezone: 'Asia/Tashkent',
    shift,
    days,
    totals: {
      payableDays: present,
      present,
      weekend,
      absent,
      unscheduled,
      onDuty: 0,
      paidLeave: 0,
      holidays: 0,
    },
    lastPunch: last
      ? {
          kind: last.kind,
          punchedAt: last.punchedAt.toISOString(),
          localDateTime: formatUzbDateTime(last.punchedAt),
          doorName: last.doorName,
        }
      : null,
    currentState: presenceStateForLastPunch(last, calculatedAt),
  };
}

function presenceStateForLastPunch(
  last: HrAttendancePunch | undefined,
  calculatedAt: Date,
): AttendancePresenceState {
  if (!last) return 'no_activity';
  if (last.kind === 'check_out') return 'out_of_office';
  const elapsed = calculatedAt.getTime() - last.punchedAt.getTime();
  return elapsed >= 0 && elapsed <= MAX_LIVE_ATTENDANCE_SESSION_MS ? 'in_office' : 'needs_review';
}

/** CSV lines for historical export (header + rows). */
export function summaryToCsv(summary: AttendanceSummary, employeeLabel: string): string {
  const lines = ['employee,date,status,first_in,last_out,hours_worked,punch_count'];
  for (const d of summary.days) {
    lines.push(
      [
        csvEscape(employeeLabel),
        d.date,
        d.status,
        d.firstIn ?? '',
        d.lastOut ?? '',
        d.hoursWorked,
        String(d.punchCount),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
