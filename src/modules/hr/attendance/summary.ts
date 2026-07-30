/**
 * Build a week/range attendance summary for one employee (My Data view).
 */
import type { HrAttendancePunch } from '../../../db/schema/index.js';
import { hrAttendancePunchRepo } from '../../../repos/hrAttendancePunchRepo.js';
import { hrAttendanceShiftRepo } from '../../../repos/hrAttendanceShiftRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import {
  eachDateInclusive,
  formatDurationHours,
  formatUzbHhMmSs,
  isUzbWeekend,
} from './uzbTime.js';

export type DayStatus = 'Present' | 'Absent' | 'Weekend';

export interface AttendanceDayRow {
  date: string;
  status: DayStatus;
  firstIn: string | null;
  lastOut: string | null;
  hoursWorked: string;
  hoursWorkedMs: number;
  punchCount: number;
}

export interface AttendanceSummary {
  employeeId: string;
  from: string;
  to: string;
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
    onDuty: number;
    paidLeave: number;
    holidays: number;
  };
  lastPunch: {
    kind: string;
    punchedAt: string;
    doorName: string | null;
  } | null;
}

function pairDay(punches: HrAttendancePunch[]): {
  firstIn: Date | null;
  lastOut: Date | null;
  ms: number;
} {
  const ins = punches.filter((p) => p.kind === 'check_in').map((p) => p.punchedAt);
  const outs = punches.filter((p) => p.kind === 'check_out').map((p) => p.punchedAt);
  const firstIn = ins.length ? new Date(Math.min(...ins.map((d) => d.getTime()))) : null;
  const lastOut = outs.length ? new Date(Math.max(...outs.map((d) => d.getTime()))) : null;
  let ms = 0;
  if (firstIn && lastOut && lastOut.getTime() > firstIn.getTime()) {
    ms = lastOut.getTime() - firstIn.getTime();
  }
  return { firstIn, lastOut, ms };
}

export async function buildAttendanceSummary(
  ctx: TenantContext,
  employeeId: string,
  from: string,
  to: string,
): Promise<AttendanceSummary> {
  const punches = await hrAttendancePunchRepo.listForEmployeeRange(ctx, employeeId, from, to);
  const byDate = new Map<string, HrAttendancePunch[]>();
  for (const p of punches) {
    const list = byDate.get(p.workDate) ?? [];
    list.push(p);
    byDate.set(p.workDate, list);
  }

  const mid = from;
  const asg = await hrAttendanceShiftRepo.assignmentForDate(ctx, employeeId, mid);
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

  for (const date of eachDateInclusive(from, to)) {
    const dayPunches = byDate.get(date) ?? [];
    const weekendDay = isUzbWeekend(date);
    const { firstIn, lastOut, ms } = pairDay(dayPunches);
    let status: DayStatus;
    if (weekendDay && dayPunches.length === 0) {
      status = 'Weekend';
      weekend += 1;
    } else if (firstIn) {
      status = 'Present';
      present += 1;
    } else if (weekendDay) {
      status = 'Weekend';
      weekend += 1;
    } else {
      status = 'Absent';
      absent += 1;
    }
    days.push({
      date,
      status,
      firstIn: firstIn ? formatUzbHhMmSs(firstIn) : null,
      lastOut: lastOut ? formatUzbHhMmSs(lastOut) : null,
      hoursWorked: formatDurationHours(ms),
      hoursWorkedMs: ms,
      punchCount: dayPunches.length,
    });
  }

  const last = await hrAttendancePunchRepo.lastForEmployee(ctx, employeeId);

  return {
    employeeId,
    from,
    to,
    shift,
    days,
    totals: {
      payableDays: present,
      present,
      weekend,
      absent,
      onDuty: 0,
      paidLeave: 0,
      holidays: 0,
    },
    lastPunch: last
      ? {
          kind: last.kind,
          punchedAt: last.punchedAt.toISOString(),
          doorName: last.doorName,
        }
      : null,
  };
}

/** CSV lines for historical export (header + rows). */
export function summaryToCsv(summary: AttendanceSummary, employeeLabel: string): string {
  const lines = [
    'employee,date,status,first_in,last_out,hours_worked,punch_count',
  ];
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
