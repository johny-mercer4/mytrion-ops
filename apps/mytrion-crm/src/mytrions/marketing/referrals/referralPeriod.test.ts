import { describe, expect, it } from 'vitest';
import {
  clampReferralRange,
  monthSpan,
  periodFileStamp,
  periodRangeLabel,
  REFERRAL_PERIOD_MAX_MONTHS,
} from './referralPeriod';

describe('referral period helpers', () => {
  it('labels a single month and a range, and stamps export filenames', () => {
    expect(periodRangeLabel('2026-08-01', '2026-08-01')).toBe('August 2026');
    expect(periodRangeLabel('2026-05-01', '2026-07-01')).toBe('May 2026 – July 2026');
    expect(periodFileStamp('2026-08-01', '2026-08-01')).toBe('2026-08');
    expect(periodFileStamp('2026-05-01', '2026-07-01')).toBe('2026-05_to_2026-07');
  });

  it('clamps inverted and over-long ranges to the 12-month cap', () => {
    expect(monthSpan('2026-01-01', '2026-12-01')).toBe(REFERRAL_PERIOD_MAX_MONTHS);
    expect(clampReferralRange('2026-07-01', '2026-05-01')).toEqual({
      from: '2026-05-01',
      to: '2026-05-01',
    });
    expect(clampReferralRange('2025-01-01', '2026-08-01')).toEqual({
      from: '2025-01-01',
      to: '2025-12-01',
    });
  });
});
