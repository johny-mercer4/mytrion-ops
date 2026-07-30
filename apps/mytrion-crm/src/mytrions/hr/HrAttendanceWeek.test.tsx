import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { AttendanceSummaryDto } from '../../api/hr';
import { HrAttendanceWeek } from './HrAttendanceWeek';

const summary: AttendanceSummaryDto = {
  employeeId: 'hre_1',
  from: '2026-07-30',
  to: '2026-07-30',
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
  it('shows Tashkent punch time, paired session, presence, and office duration', () => {
    render(<HrAttendanceWeek data={summary} today="2026-07-30" />);

    expect(screen.getByText(/2026-07-30 21:30:00 UZT/)).toBeInTheDocument();
    expect(screen.getByText('19:00:00')).toBeInTheDocument();
    expect(screen.getByText('21:30:00')).toBeInTheDocument();
    expect(screen.getByText('Out of office')).toBeInTheDocument();
    expect(screen.getAllByText('02:30')).toHaveLength(2);
  });
});
