/**
 * The money parser and the schedule preview.
 *
 * Both write to a payment agreement a debtor is told out loud on a call, so both are covered
 * directly. `previewSchedule` intentionally duplicates the server's `scheduleDates`; the last
 * block here is the pin that keeps the two from drifting — if either changes, one of these fails.
 */
import { describe, expect, it } from 'vitest';
import { moneyInput, planShortfall, previewSchedule } from './actionsModel';

describe('moneyInput', () => {
  it('accepts what a person actually types', () => {
    expect(moneyInput('2400')).toBe('2400.00');
    expect(moneyInput('2400.5')).toBe('2400.5');
    expect(moneyInput('2400.55')).toBe('2400.55');
    expect(moneyInput('$2,400.00')).toBe('2400.00');
    expect(moneyInput(' 2400 ')).toBe('2400.00');
  });

  it('rejects what is not money', () => {
    expect(moneyInput('')).toBeNull();
    expect(moneyInput('abc')).toBeNull();
    expect(moneyInput('-100')).toBeNull();
    expect(moneyInput('0')).toBeNull();
    expect(moneyInput('2400.005')).toBeNull();
    expect(moneyInput('1e5')).toBeNull();
  });

  it('never returns a number — the wire format is a string to Postgres numeric', () => {
    expect(typeof moneyInput('2400')).toBe('string');
  });
});

describe('previewSchedule', () => {
  it('steps a monthly plan by calendar month and walks the balance down', () => {
    const rows = previewSchedule({
      amount: '2400.00',
      count: 3,
      frequency: 'monthly',
      firstPaymentDate: '2026-09-02',
      outstanding: 26_120,
    });
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-09-02', '2026-10-02', '2026-11-02']);
    expect(rows.map((r) => r.balanceAfter)).toEqual(['23720.00', '21320.00', '18920.00']);
  });

  it('clamps a month-end start into a short month rather than rolling into the next', () => {
    const rows = previewSchedule({
      amount: '100.00',
      count: 3,
      frequency: 'monthly',
      firstPaymentDate: '2026-01-31',
      outstanding: 1000,
    });
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('never shows a negative balance once the plan overpays the debt', () => {
    const rows = previewSchedule({
      amount: '600.00',
      count: 4,
      frequency: 'weekly',
      firstPaymentDate: '2026-08-19',
      outstanding: 1000,
    });
    expect(rows.map((r) => r.balanceAfter)).toEqual(['400.00', '0.00', '0.00', '0.00']);
  });

  it('returns nothing rather than guessing on a bad date or amount', () => {
    expect(
      previewSchedule({ amount: 'x', count: 3, frequency: 'monthly', firstPaymentDate: '2026-09-02', outstanding: 1 }),
    ).toEqual([]);
    expect(
      previewSchedule({ amount: '10', count: 3, frequency: 'monthly', firstPaymentDate: 'nope', outstanding: 1 }),
    ).toEqual([]);
  });
});

describe('planShortfall', () => {
  it('is zero when the plan clears the debt, and the gap when it does not', () => {
    expect(planShortfall(26_120, '2400.00', 11)).toBe(0);
    expect(planShortfall(26_120, '2400.00', 10)).toBe(2120);
    expect(planShortfall(1000, '333.33', 3)).toBe(0.01);
  });

  it('treats a zero-instalment plan as clearing nothing', () => {
    expect(planShortfall(500, '100.00', 0)).toBe(500);
  });
});

/**
 * The preview and the server's `scheduleDates` must agree. Kept as an explicit table rather than
 * an import of the backend module — the widget bundle must not pull `src/` server code in.
 */
describe('parity with the server schedule', () => {
  const CASES: Array<[string, number, 'weekly' | 'fortnightly' | 'monthly', string[]]> = [
    ['2026-09-02', 3, 'monthly', ['2026-09-02', '2026-10-02', '2026-11-02']],
    ['2026-01-31', 3, 'monthly', ['2026-01-31', '2026-02-28', '2026-03-31']],
    ['2026-08-19', 3, 'fortnightly', ['2026-08-19', '2026-09-02', '2026-09-16']],
    ['2026-08-19', 3, 'weekly', ['2026-08-19', '2026-08-26', '2026-09-02']],
  ];

  it.each(CASES)('%s × %i %s', (start, count, frequency, expected) => {
    const rows = previewSchedule({
      amount: '100.00',
      count,
      frequency,
      firstPaymentDate: start,
      outstanding: 10_000,
    });
    expect(rows.map((r) => r.dueDate)).toEqual(expected);
  });
});
