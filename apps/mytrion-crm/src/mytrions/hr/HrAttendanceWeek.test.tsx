import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceSummaryDto } from '../../api/hr';
import { HrAttendanceWeek } from './HrAttendanceWeek';

const summary: AttendanceSummaryDto = {
  employeeId: 'hre_1',
  from: '2026-07-30',
  to: '2026-07-30',
  calculatedAt: '2026-07-30T16:30:00.000Z',
  timezone: 'Asia/Tashkent',
  shift: {
    id: 'hrs_1',
    name: 'UZB Tashkent · Ganga',
    startLocal: '19:00',
    endLocal: '03:00',
    timezone: 'Asia/Tashkent',
  },
  days: [
    {
      date: '2026-07-30',
      status: 'Present',
      firstIn: '19:00:00',
      lastOut: '21:30:00',
      hoursWorked: '02:30',
      hoursWorkedMs: 9_000_000,
      punchCount: 2,
      currentState: 'out_of_office',
      unmatchedPunches: 0,
      sessions: [
        {
          checkIn: '19:00:00',
          checkOut: '21:30:00',
          checkInDoor: 'Ganga 5F Entry',
          checkOutDoor: 'Ganga 5F Exit',
          duration: '02:30',
          durationMs: 9_000_000,
          checkInAt: '2026-07-30T14:00:00.000Z',
          checkOutAt: '2026-07-30T16:30:00.000Z',
          status: 'complete',
        },
      ],
    },
  ],
  totals: {
    payableDays: 1,
    present: 1,
    weekend: 0,
    absent: 0,
    unscheduled: 0,
    onDuty: 0,
    paidLeave: 0,
    holidays: 0,
  },
  lastPunch: {
    kind: 'check_out',
    punchedAt: '2026-07-30T16:30:00.000Z',
    localDateTime: '2026-07-30 21:30:00',
    doorName: 'Ganga 5F Exit',
  },
  currentState: 'out_of_office',
};

describe('HrAttendanceWeek', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows Tashkent punch time, paired session, presence, and office duration', () => {
    render(<HrAttendanceWeek data={summary} today="2026-07-30" />);

    expect(screen.getByText(/Last scan 2026-07-30 21:30:00/)).toBeInTheDocument();
    expect(screen.getByText('19:00:00')).toBeInTheDocument();
    expect(screen.getByText('21:30:00')).toBeInTheDocument();
    expect(screen.getByText('Currently out of office')).toBeInTheDocument();
    expect(screen.getAllByText('2h 30m').length).toBeGreaterThanOrEqual(3);
  });

  it('shows an open visit as a live office timer', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T16:24:14.000Z'));
    const live: AttendanceSummaryDto = {
      ...summary,
      calculatedAt: '2026-07-30T16:24:14.000Z',
      currentState: 'in_office',
      lastPunch: {
        kind: 'check_in',
        punchedAt: '2026-07-30T14:00:00.000Z',
        localDateTime: '2026-07-30 19:00:00',
        doorName: 'Ganga 5F Entry',
      },
      days: [
        {
          ...summary.days[0]!,
          lastOut: null,
          hoursWorked: '02:24',
          hoursWorkedMs: 8_654_000,
          punchCount: 1,
          currentState: 'in_office',
          sessions: [
            {
              checkIn: '19:00:00',
              checkOut: null,
              checkInDoor: 'Ganga 5F Entry',
              checkOutDoor: null,
              duration: '02:24',
              durationMs: 8_654_000,
              checkInAt: '2026-07-30T14:00:00.000Z',
              checkOutAt: null,
              status: 'open',
            },
          ],
        },
      ],
    };

    render(<HrAttendanceWeek data={live} today="2026-07-30" />);

    expect(screen.getByText('Currently in the office')).toBeInTheDocument();
    expect(screen.getByText('Still inside')).toBeInTheDocument();
    expect(screen.getAllByText('2h 24m 14s').length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * The day total sits BESIDE the live visit, not instead of it.
 *
 * "This visit" used to replace the day reading while a visit was open, so the moment someone clocked in
 * they lost sight of how long they had already been in that day — which for a split shift, or anyone who
 * stepped out and came back, is the number that actually answers "have I done my hours".
 */
describe('the presence readings', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * Scoped to the presence strip. The day rows below repeat the same durations and dates, so an
   * unscoped query passes on the wrong element — it would have found "30m 00s" in the session row even
   * if the strip stopped rendering it.
   */
  const strip = () => within(screen.getByRole('region', { name: /presence|summary/i }));

  /** One completed visit earlier, one open now, on the same day. */
  function openDay(dayDate: string, calculatedAt: string): AttendanceSummaryDto {
    return {
      ...summary,
      from: '2026-07-29',
      to: dayDate,
      calculatedAt,
      currentState: 'in_office',
      days: [
        /**
         * An EARLIER day carrying 2h, so the week total (3h 30m) differs from the day total (1h 30m).
         * Without it both readings show the same string and the assertion cannot tell which element it
         * found — the first version of this test passed on "This week" while claiming to check "Today".
         */
        {
          ...summary.days[0]!,
          date: '2026-07-29',
          sessions: [
            { ...summary.days[0]!.sessions[0]!, durationMs: 7_200_000,
              checkInAt: '2026-07-29T14:00:00.000Z', checkOutAt: '2026-07-29T16:00:00.000Z',
              status: 'complete' },
          ],
        },
        {
          ...summary.days[0]!,
          date: dayDate,
          currentState: 'in_office',
          sessions: [
            // 19:00–20:00 completed = 1h.
            { ...summary.days[0]!.sessions[0]!, checkIn: '19:00:00', checkOut: '20:00:00',
              durationMs: 3_600_000, checkInAt: `${dayDate}T14:00:00.000Z`,
              checkOutAt: `${dayDate}T15:00:00.000Z`, status: 'complete' },
            // 21:00 → still open.
            { ...summary.days[0]!.sessions[0]!, checkIn: '21:00:00', checkOut: null,
              checkOutDoor: null, durationMs: 0, checkInAt: `${dayDate}T16:00:00.000Z`,
              checkOutAt: null, status: 'open' },
          ],
        },
      ],
    };
  }

  it('shows the visit AND the day while a visit is open', () => {
    vi.useFakeTimers();
    // 21:30 Tashkent: the open visit is 30m, and the day is 1h30m including it.
    vi.setSystemTime(new Date('2026-07-30T16:30:00.000Z'));
    render(<HrAttendanceWeek data={openDay('2026-07-30', '2026-07-30T16:30:00.000Z')} today="2026-07-30" />);

    expect(strip().getByText('This visit')).toBeInTheDocument();
    expect(strip().getByText('Today')).toBeInTheDocument();
    expect(strip().getByText('30m 00s')).toBeInTheDocument();
    // The day total is the completed hour PLUS the live half hour — not one or the other.
    expect(strip().getByText('1h 30m')).toBeInTheDocument();
    expect(strip().getByText('Including this visit')).toBeInTheDocument();
  });

  /**
   * The overnight case, and the reason the label is computed rather than hardcoded. A 19:00–03:00 shift
   * is bucketed on the day it STARTED, so at 01:00 the running day is yesterday's row. Calling that
   * "Today" would be a plain lie on a screen people check payroll against.
   */
  it('names the day instead of calling it Today when a visit has crossed midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-30T20:00:00.000Z')); // 01:00 on the 31st, Tashkent
    render(<HrAttendanceWeek data={openDay('2026-07-30', '2026-07-30T20:00:00.000Z')} today="2026-07-31" />);

    expect(strip().getByText('This visit')).toBeInTheDocument();
    expect(strip().getByText('2026-07-30')).toBeInTheDocument();
    expect(strip().queryByText('Today')).toBeNull();
  });

  it('keeps two readings when nothing is open', () => {
    render(<HrAttendanceWeek data={summary} today="2026-07-30" />);
    expect(strip().queryByText('This visit')).toBeNull();
    expect(strip().getByText('Today')).toBeInTheDocument();
    expect(strip().getByText('Completed visits')).toBeInTheDocument();
    expect(strip().getByText('This week')).toBeInTheDocument();
  });
});
