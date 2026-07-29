import { describe, expect, it } from 'vitest';
import { calculateLeaveDays, leaveYear } from '../../src/modules/hr/leave/calendar.js';

describe('HR leave calendar', () => {
  it('excludes weekends and full holidays', () => {
    expect(
      calculateLeaveDays({
        fromDate: '2026-09-04',
        toDate: '2026-09-08',
        dayPart: 'full',
        holidays: [{ date: '2026-09-07', isHalfDay: false, session: null }],
      }),
    ).toBe(2);
  });

  it('supports one half day and half-day holidays', () => {
    expect(
      calculateLeaveDays({
        fromDate: '2026-12-24',
        toDate: '2026-12-24',
        dayPart: 'afternoon',
        holidays: [],
      }),
    ).toBe(0.5);
    expect(
      calculateLeaveDays({
        fromDate: '2026-12-24',
        toDate: '2026-12-24',
        dayPart: 'full',
        holidays: [{ date: '2026-12-24', isHalfDay: true, session: 'afternoon' }],
      }),
    ).toBe(0.5);
  });

  it('refuses half-day ranges, empty ranges, and cross-year requests', () => {
    expect(() =>
      calculateLeaveDays({
        fromDate: '2026-07-30',
        toDate: '2026-07-31',
        dayPart: 'morning',
        holidays: [],
      }),
    ).toThrow(/same date/);
    expect(() =>
      calculateLeaveDays({
        fromDate: '2026-07-04',
        toDate: '2026-07-04',
        dayPart: 'full',
        holidays: [],
      }),
    ).toThrow(/no working/);
    expect(() => leaveYear('2026-12-31', '2027-01-02')).toThrow(/cross calendar years/);
  });
});
