import { describe, expect, it } from 'vitest';
import { msdFmtGallons, msdFmtGallonsK, msdFmtK, msdFmtNum } from './dashFormat';

describe('gallons keep their precision', () => {
  it('abbreviates to two decimals instead of one significant figure', () => {
    // What the Card Activity tooltip used to show for this day, and what it shows now.
    expect(msdFmtK(9241.36)).toBe('9k');
    expect(msdFmtNum(9241.36)).toBe('9.2k');
    expect(msdFmtGallonsK(9241.36)).toBe('9.24k');
  });

  it('stays in k below a thousand and switches to M above a million', () => {
    expect(msdFmtGallonsK(741.5)).toBe('0.74k');
    expect(msdFmtGallonsK(92_410.4)).toBe('92.41k');
    expect(msdFmtGallonsK(1_234_567)).toBe('1.23M');
  });

  it('always shows two decimals so the mono column lines up', () => {
    expect(msdFmtGallonsK(10_000)).toBe('10.00k');
    expect(msdFmtGallonsK(0)).toBe('0');
  });

  it('is safe on the values the warehouse actually sends', () => {
    expect(msdFmtGallonsK(Number.NaN)).toBe('0');
    expect(msdFmtGallonsK(undefined as unknown as number)).toBe('0');
  });

  it('leaves the transactions table exact', () => {
    expect(msdFmtGallons(9241.36)).toBe('9,241.36');
    expect(msdFmtGallons(10_000)).toBe('10,000');
  });
});
