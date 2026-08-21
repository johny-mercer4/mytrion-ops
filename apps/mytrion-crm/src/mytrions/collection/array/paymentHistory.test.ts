/**
 * The Metro 2 payment history parser.
 *
 * The one thing that must never break here: absence must not read as good standing. `B`/`D` mean
 * the bureau reported nothing that month, and a strip that coloured them like `0` would turn a
 * carrier nobody has data on into one that looks reliable.
 */
import { describe, expect, it } from 'vitest';
import { monthBefore, parsePaymentHistory, summarisePaymentHistory } from './paymentHistory';

describe('monthBefore', () => {
  it('counts back across a year boundary', () => {
    expect(monthBefore('2026-05', 0)).toBe('May 2026');
    expect(monthBefore('2026-05', 4)).toBe('Jan 2026');
    expect(monthBefore('2026-05', 5)).toBe('Dec 2025');
    expect(monthBefore('2026-05', 23)).toBe('Jun 2024');
  });

  it("reads the format production actually stores — 'Aug 2026', not '2026-08'", () => {
    expect(monthBefore('Aug 2026', 0)).toBe('Aug 2026');
    expect(monthBefore('Aug 2026', 1)).toBe('Jul 2026');
    expect(monthBefore('May 2026', 5)).toBe('Dec 2025');
    expect(monthBefore('Jan 2026', 1)).toBe('Dec 2025');
    // Case and a full month name both resolve; the generator only ever emits the short form.
    expect(monthBefore('august 2026', 0)).toBe('Aug 2026');
    expect(monthBefore('September 2026', 0)).toBe('Sep 2026');
  });

  it('returns null rather than inventing a date', () => {
    expect(monthBefore(null, 0)).toBeNull();
    expect(monthBefore('', 3)).toBeNull();
    expect(monthBefore('Smarch 2026', 0)).toBeNull();
    expect(monthBefore('2026', 0)).toBeNull();
  });
});

describe('parsePaymentHistory', () => {
  it('parses the real profile from the screen that prompted this', () => {
    const months = parsePaymentHistory('000000000000BBBBBBBBBBBB', '2026-05');
    expect(months).toHaveLength(24);
    expect(months[0]).toMatchObject({ code: '0', tone: 'current', month: 'Apr 2026' });
    expect(months[11]).toMatchObject({ code: '0', tone: 'current', month: 'May 2025' });
    expect(months[12]).toMatchObject({ code: 'B', tone: 'none', month: 'Apr 2025' });
  });

  it('opens on the month BEFORE the filing, which is where the generator starts', () => {
    // arrayReportSync.js: "Position 0 = the most recent month-end (= previous reporting period)".
    const months = parsePaymentHistory('000', 'Aug 2026');
    expect(months.map((m) => m.month)).toEqual(['Jul 2026', 'Jun 2026', 'May 2026']);
  });

  it('never reads absence as good standing', () => {
    for (const code of ['B', 'D']) {
      const [m] = parsePaymentHistory(code, '2026-05');
      expect(m?.tone).toBe('none');
    }
    expect(parsePaymentHistory('0', '2026-05')[0]?.tone).toBe('current');
    expect(parsePaymentHistory('E', '2026-05')[0]?.tone).toBe('current');
  });

  it('grades lateness into the four bands the strip draws', () => {
    const tones = [...'0123456'].map((c) => parsePaymentHistory(c)[0]?.tone);
    expect(tones).toEqual(['current', 'late', 'late', 'severe', 'severe', 'severe', 'derogatory']);
  });

  it('treats collection, charge-off and repossession as derogatory', () => {
    for (const c of ['G', 'K', 'L']) {
      expect(parsePaymentHistory(c)[0]?.tone).toBe('derogatory');
    }
  });

  it('keeps an unrecognised code instead of dropping it — dropping would shift every later month', () => {
    const months = parsePaymentHistory('0?0', '2026-05');
    expect(months).toHaveLength(3);
    expect(months[1]).toMatchObject({ code: '?', tone: 'none' });
    expect(months[2]?.month).toBe('Feb 2026');
  });

  it('is empty for an absent or blank profile', () => {
    expect(parsePaymentHistory(null)).toEqual([]);
    expect(parsePaymentHistory('   ')).toEqual([]);
  });

  it('falls back to a position label when the period is unusable', () => {
    expect(parsePaymentHistory('00', null)[0]?.month).toBe('1 month back');
    expect(parsePaymentHistory('00', null)[1]?.month).toBe('2 months back');
  });
});

describe('summarisePaymentHistory', () => {
  it('counts only REPORTED months, so a short history cannot pass as a clean one', () => {
    const s = summarisePaymentHistory(parsePaymentHistory('000000000000BBBBBBBBBBBB', '2026-05'));
    expect(s.reported).toBe(12);
    expect(s.clean).toBe(true);
    expect(s.worst?.tone).toBe('current');
  });

  it('surfaces the worst month, not the most recent one', () => {
    const s = summarisePaymentHistory(parsePaymentHistory('0006000', '2026-05'));
    expect(s.clean).toBe(false);
    expect(s.worst?.tone).toBe('derogatory');
    expect(s.worst?.month).toBe('Jan 2026');
  });

  it('is not clean when nothing was reported at all', () => {
    const s = summarisePaymentHistory(parsePaymentHistory('BBBB', '2026-05'));
    expect(s.reported).toBe(0);
    expect(s.clean).toBe(false);
    expect(s.worst).toBeNull();
  });
});
