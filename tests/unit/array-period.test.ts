/**
 * Ordering Array filings by period.
 *
 * The bug this covers is not subtle: `report_period` holds `'Aug 2026'`, and sorting that as text
 * descending gives May > Jun > Jul > Aug. Every "newest filing per carrier" read on the desk —
 * placement readiness, agency-return detection, the Array list, the period filter — was returning
 * the OLDEST of the four snapshots for 1,960 of 2,469 carriers.
 */
import { describe, expect, it } from 'vitest';
import { reportPeriodKey } from '../../src/repos/arrayPeriod.js';

describe('reportPeriodKey', () => {
  it('orders the four periods production actually holds', () => {
    const stored = ['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026'];

    // The bug, stated: plain text sort disagrees with the calendar.
    expect([...stored].sort()).toEqual(['Aug 2026', 'Jul 2026', 'Jun 2026', 'May 2026']);

    const byKey = [...stored].sort((a, b) => reportPeriodKey(a).localeCompare(reportPeriodKey(b)));
    expect(byKey).toEqual(['May 2026', 'Jun 2026', 'Jul 2026', 'Aug 2026']);
  });

  it('maps every month to its number', () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    months.forEach((m, i) => {
      expect(reportPeriodKey(`${m} 2026`), m).toBe(`2026-${String(i + 1).padStart(2, '0')}`);
    });
  });

  it('sorts across a year boundary', () => {
    expect(reportPeriodKey('Dec 2025') < reportPeriodKey('Jan 2026')).toBe(true);
  });

  it('passes an already-sortable period through — fixtures and local seeds use YYYY-MM', () => {
    expect(reportPeriodKey('2026-08')).toBe('2026-08');
  });

  it('never throws on a value it cannot read, and sorts it last', () => {
    for (const bad of ['', '   ', 'Smarch 2026', 'quarterly', '2026', null, undefined]) {
      expect(reportPeriodKey(bad), String(bad)).toBe('0000-00');
    }
    expect(reportPeriodKey('0000-00') < reportPeriodKey('May 2026')).toBe(true);
  });

  it('is case- and whitespace-tolerant, because the generator is a locale call', () => {
    expect(reportPeriodKey('  aug 2026 ')).toBe('2026-08');
    expect(reportPeriodKey('AUG 2026')).toBe('2026-08');
  });
});
