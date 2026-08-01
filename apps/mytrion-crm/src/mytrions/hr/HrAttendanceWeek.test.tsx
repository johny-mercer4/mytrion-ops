import { render, screen } from '@testing-library/react';
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
