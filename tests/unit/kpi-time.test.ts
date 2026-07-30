import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  dayBounds,
  monthDays,
  previousMonthStart,
  reportingDate,
} from '../../src/modules/kpi/time.js';

const TZ = 'America/New_York';

describe('KPI reporting calendar', () => {
  it('uses a 23-hour day across spring DST', () => {
    const bounds = dayBounds('2026-03-08', TZ);
    expect(bounds.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect((bounds.end.getTime() - bounds.start.getTime()) / 3_600_000).toBe(23);
  });

  it('uses a 25-hour day across fall DST', () => {
    const bounds = dayBounds('2026-11-01', TZ);
    expect(bounds.start.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect((bounds.end.getTime() - bounds.start.getTime()) / 3_600_000).toBe(25);
  });

  it('keeps dates and month boundaries on the New York calendar', () => {
    expect(reportingDate(new Date('2026-07-01T03:30:00Z'), TZ)).toBe('2026-06-30');
    expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(monthDays('2024-02-01')).toHaveLength(29);
    expect(previousMonthStart(new Date('2026-01-15T12:00:00Z'), TZ)).toBe('2025-12-01');
  });
});
