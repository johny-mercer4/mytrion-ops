/**
 * What a stale `work_date` does to the numbers on screen.
 *
 * `work_date` is denormalised onto every punch and, for an OVERNIGHT shift, is not the calendar date —
 * a 02:00 exit belongs to the previous day's shift. The repo rebuckets when punches are LINKED to an
 * employee; assigning a shift retroactively changes the answer too, and used not to.
 *
 * These run the real summary builder, so they cannot drift from the pipeline: the first is the symptom,
 * the second is the same night once the dates are right.
 */
import { describe, expect, it } from 'vitest';
import { buildAttendanceSummaryFromRecords } from '../../src/modules/hr/attendance/summary.js';

/** 19:00–03:00, the shipped UZB shift. */
const NIGHT = {
  id: 's1',
  name: 'UZB Main',
  startLocal: '19:00',
  endLocal: '03:00',
  timezone: 'Asia/Tashkent',
};

/** UZB is +5, so a wall-clock hour on a date is that hour minus five, UTC. */
const uzb = (date: string, hh: number, mm = 0): Date =>
  new Date(`${date}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+05:00`);

function punch(over: Record<string, unknown>) {
  return {
    id: 'p',
    tenantId: 't1',
    employeeId: 'e1',
    kind: 'check_in',
    doorName: 'Ganga Entry',
    faceId: '1',
    source: 'ganga',
    ...over,
  } as never;
}

/**
 * What the stale dates actually looked like on screen. This is the symptom the fix removes, asserted
 * against the real summary builder so it cannot drift from the pipeline.
 */
describe('the symptom stale work dates produced', () => {
  const assignment = { effectiveFrom: '2026-08-01', effectiveTo: null, shift: NIGHT } as never;

  it('scored a worked night as 0 hours and the next day as absent', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-03',
      '2026-08-04',
      [
        punch({ id: 'in', kind: 'check_in', punchedAt: uzb('2026-08-03', 19), workDate: '2026-08-03' }),
        // The stale bucketing.
        punch({ id: 'out', kind: 'check_out', punchedAt: uzb('2026-08-04', 2), workDate: '2026-08-04' }),
      ],
      assignment,
      undefined,
      uzb('2026-08-10', 12),
    );

    const [d3, d4] = summary.days;
    expect(d3!.hoursWorkedMs).toBe(0);
    expect(d3!.sessions[0]!.status).toBe('needs_review');
    expect(d4!.status).toBe('Absent');
    expect(d4!.unmatchedPunches).toBe(1);
  });

  it('scores the same night correctly once the dates are repaired', () => {
    const summary = buildAttendanceSummaryFromRecords(
      'e1',
      '2026-08-03',
      '2026-08-04',
      [
        punch({ id: 'in', kind: 'check_in', punchedAt: uzb('2026-08-03', 19), workDate: '2026-08-03' }),
        punch({ id: 'out', kind: 'check_out', punchedAt: uzb('2026-08-04', 2), workDate: '2026-08-03' }),
      ],
      assignment,
      undefined,
      uzb('2026-08-10', 12),
    );

    const [d3, d4] = summary.days;
    expect(d3!.status).toBe('Present');
    expect(d3!.hoursWorkedMs).toBe(7 * 60 * 60 * 1000);
    expect(d3!.sessions[0]!.status).toBe('complete');
    expect(d4!.unmatchedPunches).toBe(0);
  });
});
