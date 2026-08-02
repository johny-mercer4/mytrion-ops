import { describe, expect, it } from 'vitest';
import { buildAttendanceSummaryFromRecords } from '../../src/modules/hr/attendance/summary.js';
import type { AttendanceAssignmentWithShift } from '../../src/repos/hrAttendanceShiftRepo.js';
import {
  doorKind,
  isAllowedAttendanceDoor,
  isUzbWeekend,
  parseUzbWallClock,
  uzbDateString,
  workDateForPunch,
} from '../../src/modules/hr/attendance/uzbTime.js';

describe('attendance uzbTime', () => {
  it('parses UZB wall-clock as UTC−5h', () => {
    const d = parseUzbWallClock('2026-07-29 19:00:00');
    // 19:00 UZB = 14:00 UTC
    expect(d.toISOString()).toBe('2026-07-29T14:00:00.000Z');
  });

  it('classifies door names', () => {
    expect(doorKind('Main Entry')).toBe('check_in');
    expect(doorKind('Exit Gate')).toBe('check_out');
    expect(doorKind('UZB Main')).toBe('check_in');
    expect(doorKind('unknown')).toBeNull();
  });

  it('accepts only Ganga attendance readers', () => {
    expect(isAllowedAttendanceDoor('Ganga 5F Entry')).toBe(true);
    expect(isAllowedAttendanceDoor('GANGA 4F Exit')).toBe(true);
    expect(isAllowedAttendanceDoor('Oybek 3F Entry')).toBe(false);
  });

  it('buckets overnight punches before end_local to previous day', () => {
    // 01:00 UZB on Jul 30 → work_date Jul 29 for 19:00–03:00 shift
    const punched = parseUzbWallClock('2026-07-30 01:00:00');
    expect(uzbDateString(punched)).toBe('2026-07-30');
    expect(workDateForPunch(punched, { startLocal: '19:00', endLocal: '03:00' })).toBe(
      '2026-07-29',
    );
  });

  it('keeps a late overnight checkout with the shift during the grace window', () => {
    const punched = parseUzbWallClock('2026-07-30 05:00:00');
    expect(workDateForPunch(punched, { startLocal: '19:00', endLocal: '03:00' })).toBe(
      '2026-07-29',
    );
  });

  it('starts the new work date after the overnight checkout grace window', () => {
    const punched = parseUzbWallClock('2026-07-30 08:00:00');
    expect(workDateForPunch(punched, { startLocal: '19:00', endLocal: '03:00' })).toBe(
      '2026-07-30',
    );
  });

  it('keeps same-day shift punches on calendar day', () => {
    const punched = parseUzbWallClock('2026-07-29 10:00:00');
    expect(workDateForPunch(punched, { startLocal: '09:00', endLocal: '18:00' })).toBe(
      '2026-07-29',
    );
  });

  it('detects UZB weekends', () => {
    expect(isUzbWeekend('2026-08-01')).toBe(true); // Sat
    expect(isUzbWeekend('2026-08-02')).toBe(true); // Sun
    expect(isUzbWeekend('2026-07-29')).toBe(false); // Wed
  });

  it('does not mark an employee absent before a shift begins', () => {
    const assignment: AttendanceAssignmentWithShift = {
      id: 'hrsa_1',
      tenantId: 'octane',
      employeeId: 'hre_1',
      shiftId: 'hrs_1',
      effectiveFrom: '2026-07-30',
      effectiveTo: null,
      createdAt: new Date('2026-07-30T00:00:00Z'),
      updatedAt: new Date('2026-07-30T00:00:00Z'),
      shift: {
        id: 'hrs_1',
        tenantId: 'octane',
        name: 'UZB Tashkent · Ganga',
        timezone: 'Asia/Tashkent',
        startLocal: '19:00',
        endLocal: '03:00',
        isActive: true,
        createdAt: new Date('2026-07-30T00:00:00Z'),
        updatedAt: new Date('2026-07-30T00:00:00Z'),
      },
    };

    const summary = buildAttendanceSummaryFromRecords(
      'hre_1',
      '2026-07-27',
      '2026-07-31',
      [],
      assignment,
      undefined,
    );

    expect(summary.days.map((day) => day.status)).toEqual([
      'Unscheduled',
      'Unscheduled',
      'Unscheduled',
      'Absent',
      'Absent',
    ]);
    expect(summary.totals).toMatchObject({ unscheduled: 3, absent: 2 });
  });
});
