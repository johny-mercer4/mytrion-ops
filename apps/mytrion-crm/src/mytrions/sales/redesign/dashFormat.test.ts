import { describe, expect, it } from 'vitest';
import { msdFmtGallons, msdFmtK, msdFmtNum } from './dashFormat';

describe('gallons are never abbreviated', () => {
  it('keeps every gallon the other formatters round away', () => {
    // What the Card Activity tooltip used to show for this day, and what it shows now.
    expect(msdFmtK(9241.36)).toBe('9k');
    expect(msdFmtNum(9241.36)).toBe('9.2k');
    expect(msdFmtGallons(9241.36)).toBe('9,241.36');
  });

  it('drops trailing zeros so a whole-gallon day stays readable', () => {
    expect(msdFmtGallons(10_000)).toBe('10,000');
    expect(msdFmtGallons(1_234_567.5)).toBe('1,234,567.5');
    expect(msdFmtGallons(0)).toBe('0');
  });

  it('is safe on the values the warehouse actually sends', () => {
    expect(msdFmtGallons(Number.NaN)).toBe('0');
    expect(msdFmtGallons(undefined as unknown as number)).toBe('0');
  });
});
