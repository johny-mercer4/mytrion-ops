/**
 * dayBoundary — turning a `<input type="date">` value into the instant the log query needs.
 *
 * Two traps, both of which silently drop rows rather than erroring:
 *  - `new Date('2026-08-14')` parses as UTC midnight, which in a negative-offset zone is the
 *    PREVIOUS evening. The window then starts a day early and ends a day early.
 *  - An end bound at midnight excludes the whole of its own day, so `from = to = today` returns
 *    nothing at all.
 */
import { describe, expect, it } from 'vitest';
import { dayBoundary } from './logsShared';

/** Local wall-clock parts of an ISO instant — what the user actually picked. */
function localParts(iso: string): [number, number, number, number, number, number] {
  const d = new Date(iso);
  return [
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  ];
}

describe('dayBoundary', () => {
  it('starts the window at LOCAL midnight of the chosen day', () => {
    const iso = dayBoundary('2026-08-14', 'start');
    expect(iso).toBeDefined();
    expect(localParts(iso!)).toEqual([2026, 8, 14, 0, 0, 0]);
  });

  it('ends the window at the last moment of the chosen day, not its midnight', () => {
    const iso = dayBoundary('2026-08-14', 'end');
    expect(iso).toBeDefined();
    expect(localParts(iso!)).toEqual([2026, 8, 14, 23, 59, 59]);
    expect(new Date(iso!).getMilliseconds()).toBe(999);
  });

  it('makes a single-day window actually contain that day', () => {
    const from = new Date(dayBoundary('2026-08-14', 'start')!).getTime();
    const to = new Date(dayBoundary('2026-08-14', 'end')!).getTime();
    const noon = new Date(2026, 7, 14, 12, 0, 0).getTime();

    expect(to).toBeGreaterThan(from);
    expect(noon).toBeGreaterThanOrEqual(from);
    expect(noon).toBeLessThanOrEqual(to);
  });

  it('spans a whole month inclusively', () => {
    const from = new Date(dayBoundary('2026-08-01', 'start')!).getTime();
    const to = new Date(dayBoundary('2026-08-31', 'end')!).getTime();
    const lastSecond = new Date(2026, 7, 31, 23, 59, 59).getTime();

    expect(lastSecond).toBeLessThanOrEqual(to);
    expect(new Date(2026, 7, 1, 0, 0, 0).getTime()).toBeGreaterThanOrEqual(from);
  });

  it('returns undefined for an empty or malformed value, so no bound is sent', () => {
    expect(dayBoundary('', 'start')).toBeUndefined();
    expect(dayBoundary('   ', 'end')).toBeUndefined();
    expect(dayBoundary('14/08/2026', 'start')).toBeUndefined();
    expect(dayBoundary('2026-8-4', 'start')).toBeUndefined();
  });

  it('tolerates surrounding whitespace', () => {
    expect(dayBoundary('  2026-08-14  ', 'start')).toBeDefined();
  });
});
