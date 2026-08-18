import { describe, expect, it } from 'vitest';
import {
  clipReferralMonthWindow,
  enumerateReferralMonths,
  isIsoDate,
  lastDayOfMonth,
  REFERRAL_PERIOD_MAX_DAYS,
  REFERRAL_PERIOD_MAX_MONTHS,
  referralDaySpan,
  referralMonthSpan,
} from '../../src/modules/manager/referralPeriodRange.js';

describe('referral day range', () => {
  it('counts inclusive calendar months and days, and enumerates overlapping months', () => {
    expect(referralMonthSpan('2026-05-01', '2026-05-01')).toBe(1);
    expect(referralMonthSpan('2026-07-15', '2026-08-20')).toBe(2);
    expect(referralDaySpan('2026-08-01', '2026-08-01')).toBe(1);
    expect(referralDaySpan('2026-08-01', '2026-08-16')).toBe(16);
    expect(enumerateReferralMonths('2026-07-15', '2026-08-20')).toEqual([
      '2026-07-01',
      '2026-08-01',
    ]);
    expect(enumerateReferralMonths('2025-11-01', '2026-02-01')).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(REFERRAL_PERIOD_MAX_MONTHS).toBe(12);
    expect(REFERRAL_PERIOD_MAX_DAYS).toBe(366);
    expect(referralMonthSpan('2026-01-01', '2026-12-31')).toBe(12);
    expect(referralMonthSpan('2025-01-01', '2026-02-01')).toBe(14);
  });

  it('rejects impossible calendar days and clips each month to the requested window', () => {
    expect(isIsoDate('2026-08-16')).toBe(true);
    expect(isIsoDate('2026-02-31')).toBe(false);
    expect(lastDayOfMonth('2026-06-01')).toBe('2026-06-30');
    expect(lastDayOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(clipReferralMonthWindow('2026-07-01', '2026-07-15', '2026-08-20')).toEqual({
      from: '2026-07-15',
      to: '2026-07-31',
    });
    expect(clipReferralMonthWindow('2026-08-01', '2026-07-15', '2026-08-20')).toEqual({
      from: '2026-08-01',
      to: '2026-08-20',
    });
  });
});
