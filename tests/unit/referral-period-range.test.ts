import { describe, expect, it } from 'vitest';
import {
  enumerateReferralMonths,
  REFERRAL_PERIOD_MAX_MONTHS,
  referralMonthSpan,
} from '../../src/modules/manager/referralPeriodRange.js';

describe('referral month range', () => {
  it('counts inclusive calendar months and enumerates first-of-month days', () => {
    expect(referralMonthSpan('2026-05-01', '2026-05-01')).toBe(1);
    expect(referralMonthSpan('2026-05-01', '2026-06-01')).toBe(2);
    expect(enumerateReferralMonths('2025-11-01', '2026-02-01')).toEqual([
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
    ]);
    expect(REFERRAL_PERIOD_MAX_MONTHS).toBe(12);
    expect(referralMonthSpan('2026-01-01', '2026-12-01')).toBe(12);
    expect(referralMonthSpan('2025-01-01', '2026-02-01')).toBe(14);
  });
});
