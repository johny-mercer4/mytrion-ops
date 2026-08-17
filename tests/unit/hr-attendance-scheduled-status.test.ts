/**
 * `Scheduled` vs `Unscheduled` — the day-status split.
 *
 * The reported bug: a night worker on the shipped 19:00–03:00 shift opened today and saw
 * "Unscheduled / No shift scheduled", because a shift whose window has not closed yet was scored the
 * same as having no shift at all. These pin the two apart against the real summary builder, so the
 * classification cannot drift from the pipeline the UI actually reads.
 */
import { describe, expect, it } from 'vitest';
import { buildAttendanceSummaryFromRecords } from '../../src/modules/hr/attendance/summary.js';

/** 19:00–03:00, the shipped UZB shift — overnight, so its window closes at 03:00 the NEXT day. */
const NIGHT = {
  id: 's1',
  name: 'UZB Tashkent · Ganga',
  startLocal: '19:00',
  endLocal: '03:00',
  timezone: 'Asia/Tashkent',
};

/** An open-ended assignment of that shift. */
const ASSIGNED = { effectiveFrom: '2026-07-30', effectiveTo: null, shift: NIGHT } as never;

/** UZB is +5, so a wall-clock hour on a date is that hour minus five, UTC. */
const uzb = (date: string, hh: number, mm = 0): Date =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:00`);

function punch(over: Record<string, unknown>) {
  return {
    id: 'p',
    tenantId: 't1',
    employeeId: 'e1',
    kind: 'check_in',
    doorName: 'Ganga 5F Entry',
    faceId: '1',
    source: 'ganga',
    ...over,
  } as never;
}

describe('a covered day whose shift window has not closed', () => {
  // Friday noon: the 19:00–03:00 shift has not even started, let alone closed.
  const NOON_FRIDAY = uzb('2026-08-14', 12);

  it('scores Scheduled — not Unscheduled — so the card can name the shift (the reported bug)', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-14',
      '2026-08-14',
      [],
      ASSIGNED,
      undefined,
      NOON_FRIDAY,
    );
    expect(summary.days[0]!.status).toBe('Scheduled');
    expect(summary.totals.scheduled).toBe(1);
    // The two meanings that used to be one: neither of these must claim it.
    expect(summary.totals.unscheduled).toBe(0);
    expect(summary.totals.absent).toBe(0);
  });

  it('still carries the shift on the summary so the client has a window to render', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-14',
      '2026-08-14',
      [],
      ASSIGNED,
      undefined,
      NOON_FRIDAY,
    );
    expect(summary.shift?.startLocal).toBe('19:00');
    expect(summary.shift?.endLocal).toBe('03:00');
  });

  it('flips to Present the moment there is a check-in', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-14',
      '2026-08-14',
      [punch({ kind: 'check_in', punchedAt: uzb('2026-08-14', 19), workDate: '2026-08-14' })],
      ASSIGNED,
      undefined,
      uzb('2026-08-14', 20),
    );
    expect(summary.days[0]!.status).toBe('Present');
    expect(summary.totals.scheduled).toBe(0);
  });
});

describe('a day no shift covers', () => {
  it('is Unscheduled, and does not leak into the scheduled count', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-14',
      '2026-08-14',
      [],
      undefined, // no assignment at all
      undefined,
      uzb('2026-08-14', 12),
    );
    expect(summary.days[0]!.status).toBe('Unscheduled');
    expect(summary.totals.unscheduled).toBe(1);
    expect(summary.totals.scheduled).toBe(0);
  });
});

describe('a covered day whose window HAS closed with no scan', () => {
  it('remains Absent — the split must not soften a real absence into Scheduled', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-14',
      '2026-08-14',
      [],
      ASSIGNED,
      undefined,
      uzb('2026-08-16', 12), // two days later; the 14th's window closed at 03:00 on the 15th
    );
    expect(summary.days[0]!.status).toBe('Absent');
    expect(summary.totals.absent).toBe(1);
    expect(summary.totals.scheduled).toBe(0);
  });
});

/**
 * The whole current week, read mid-week, with no scans yet. This is what a night worker who has not
 * badged this week actually sees, and it exercises every branch of the split at once.
 */
describe('the current week read on Wednesday noon, no scans', () => {
  it('splits into closed=Absent, open=Scheduled, and Weekend', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-10', // Monday
      '2026-08-16', // Sunday
      [],
      ASSIGNED,
      undefined,
      uzb('2026-08-12', 12), // Wednesday noon
    );
    expect(summary.days.map((d) => d.status)).toEqual([
      'Absent', // Mon — window closed
      'Absent', // Tue — window closed at 03:00 Wed
      'Scheduled', // Wed — shift starts 19:00, not closed
      'Scheduled', // Thu — future
      'Scheduled', // Fri — future
      'Weekend', // Sat
      'Weekend', // Sun
    ]);
    expect(summary.totals).toMatchObject({
      absent: 2,
      scheduled: 3,
      weekend: 2,
      present: 0,
      unscheduled: 0,
      payableDays: 0,
    });
  });
});
