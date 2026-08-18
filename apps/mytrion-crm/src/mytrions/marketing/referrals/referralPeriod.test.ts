import { describe, expect, it } from 'vitest';
import {
  clampReferralRange,
  daySpan,
  monthSpan,
  periodFileStamp,
  periodLabel,
  periodRangeLabel,
  rangeForMonth,
  REFERRAL_PERIOD_MAX_DAYS,
  REFERRAL_PERIOD_MAX_MONTHS,
  utcToday,
} from './referralPeriod';

describe('referral period helpers', () => {
  it('labels a single day and a day range, and stamps export filenames', () => {
    expect(periodLabel('2026-08-16')).toBe('August 16, 2026');
    expect(periodRangeLabel('2026-08-16', '2026-08-16')).toBe('August 16, 2026');
    expect(periodRangeLabel('2026-07-15', '2026-08-20')).toBe(
      'July 15, 2026 – August 20, 2026',
    );
    expect(periodFileStamp('2026-08-16', '2026-08-16')).toBe('2026-08-16');
    expect(periodFileStamp('2026-07-15', '2026-08-20')).toBe('2026-07-15_to_2026-08-20');
  });

  it('clamps inverted and over-long ranges to the day and 12-month caps', () => {
    expect(daySpan('2026-08-01', '2026-08-16')).toBe(16);
    expect(monthSpan('2026-01-01', '2026-12-31')).toBe(REFERRAL_PERIOD_MAX_MONTHS);
    expect(REFERRAL_PERIOD_MAX_DAYS).toBe(366);
    expect(clampReferralRange('2026-07-20', '2026-05-10')).toEqual({
      from: '2026-05-10',
      to: '2026-05-10',
    });
    expect(clampReferralRange('2025-01-01', '2026-08-01')).toEqual({
      from: '2025-01-01',
      to: '2025-12-31',
    });
  });

  it('expands a month pick to first-through-last day, clamping the current month to today', () => {
    expect(rangeForMonth('2026-07-15')).toEqual({ from: '2026-07-01', to: '2026-07-31' });
    const today = utcToday();
    expect(rangeForMonth(today)).toEqual({
      from: `${today.slice(0, 7)}-01`,
      to: today,
    });
  });
});
