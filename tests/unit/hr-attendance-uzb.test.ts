import { describe, expect, it } from 'vitest';
import {
  doorKind,
  isUzbWeekend,
  parseUzbWallClock,
  uzbDateString,
  workDateForPunch,
} from '../../src/modules/hr/attendance/uzbTime.js';

describe('attendance uzbTime', () => {
  it('parses UZB wall-clock as UTC−5h', () => {
    const d = parseUzbWallClock('2026-07-29 19:00:00');
    // 19:00 UZB = 14:00 UTC
    expect(d.toISOString()).toBe('2026-07-29T14:00:00.000Z');
  });

  it('classifies door names', () => {
    expect(doorKind('Main Entry')).toBe('check_in');
    expect(doorKind('Exit Gate')).toBe('check_out');
    expect(doorKind('UZB Main')).toBe('check_in');
    expect(doorKind('unknown')).toBeNull();
  });

  it('buckets overnight punches before end_local to previous day', () => {
    // 01:00 UZB on Jul 30 → work_date Jul 29 for 19:00–03:00 shift
    const punched = parseUzbWallClock('2026-07-30 01:00:00');
    expect(uzbDateString(punched)).toBe('2026-07-30');
    expect(
      workDateForPunch(punched, { startLocal: '19:00', endLocal: '03:00' }),
    ).toBe('2026-07-29');
  });

  it('keeps same-day shift punches on calendar day', () => {
    const punched = parseUzbWallClock('2026-07-29 10:00:00');
    expect(
      workDateForPunch(punched, { startLocal: '09:00', endLocal: '18:00' }),
    ).toBe('2026-07-29');
  });

  it('detects UZB weekends', () => {
    expect(isUzbWeekend('2026-08-01')).toBe(true); // Sat
    expect(isUzbWeekend('2026-08-02')).toBe(true); // Sun
    expect(isUzbWeekend('2026-07-29')).toBe(false); // Wed
  });
});
