/**
 * Finance cache keys and the range wire shape.
 *
 * The dangerous failure mode of a cached panel is a key that omits one of its inputs: the panel then
 * serves the 7-day window's rows under the 90-day heading, or one carrier's money codes under another
 * carrier's name. That looks like real data, so it is worse than a slow panel — hence these assert that
 * every input actually reaches the key, rather than just that the format looks right.
 */
import { describe, expect, it } from 'vitest';
import { rangeLabel, rangeQuery, rollingRange, type EfsRange } from '../../api/finance';
import { financeKeys, STALE } from './panelBits';

const custom = (from: string, to: string): EfsRange => ({ kind: 'custom', from, to });

describe('every input reaches the key', () => {
  it('separates carriers', () => {
    const keys = [
      financeKeys.client('5815100'),
      financeKeys.invoices('5815100'),
      financeKeys.payments('5815100'),
      financeKeys.efsLoads('5815100', rollingRange(30)),
      financeKeys.moneyCodes('5815100', rollingRange(30), 'ALL'),
    ];
    const other = [
      financeKeys.client('5794015'),
      financeKeys.invoices('5794015'),
      financeKeys.payments('5794015'),
      financeKeys.efsLoads('5794015', rollingRange(30)),
      financeKeys.moneyCodes('5794015', rollingRange(30), 'ALL'),
    ];
    for (const [i, k] of keys.entries()) expect(k).not.toBe(other[i]);
    expect(new Set([...keys, ...other]).size).toBe(10);
  });

  it('separates the rolling window, so 7d rows cannot be served as 90d', () => {
    const loads = ([7, 30, 90] as const).map((d) => financeKeys.efsLoads('5815100', rollingRange(d)));
    expect(new Set(loads).size).toBe(3);
  });

  /**
   * The custom range is the newest input and the easiest to leave out of a key. Two different picked
   * spans must not share an entry, and a custom span must never collide with a preset.
   */
  it('separates custom ranges from each other and from the presets', () => {
    const a = financeKeys.efsLoads('5815100', custom('2026-06-01', '2026-06-30'));
    const b = financeKeys.efsLoads('5815100', custom('2026-07-01', '2026-07-31'));
    const c = financeKeys.efsLoads('5815100', custom('2026-06-01', '2026-07-31'));
    const preset = financeKeys.efsLoads('5815100', rollingRange(30));
    expect(new Set([a, b, c, preset]).size).toBe(4);
  });

  it('separates a custom money-code range per status', () => {
    const r = custom('2026-06-01', '2026-06-30');
    const combos = ['ALL', 'OPEN', 'PARTIAL', 'USED', 'VOIDED'].map((s) =>
      financeKeys.moneyCodes('5815100', r, s),
    );
    expect(new Set(combos).size).toBe(5);
  });

  it('separates money-code window AND status independently', () => {
    const combos: string[] = [];
    for (const d of [7, 30, 90] as const) {
      for (const s of ['ALL', 'OPEN', 'PARTIAL', 'USED', 'VOIDED']) {
        combos.push(financeKeys.moneyCodes('5815100', rollingRange(d), s));
      }
    }
    expect(new Set(combos).size).toBe(15);
  });

  it('separates the transactions range', () => {
    const ranges = ['month', 'quarter', 'year', 'all_time'];
    expect(new Set(ranges.map((r) => financeKeys.transactions('5815100', r))).size).toBe(4);
  });

  it('keys one money code per id', () => {
    expect(financeKeys.moneyCode('164407678')).not.toBe(financeKeys.moneyCode('164627819'));
  });

  /** A shared prefix is what makes `invalidateSwrCache('finance:')` able to clear just this module. */
  it('namespaces everything under finance: so invalidation cannot reach another module', () => {
    const all = [
      financeKeys.roster(),
      financeKeys.client('1'),
      financeKeys.invoices('1'),
      financeKeys.payments('1'),
      financeKeys.transactions('1', 'month'),
      financeKeys.efsLoads('1', rollingRange(7)),
      financeKeys.moneyCodes('1', rollingRange(7), 'ALL'),
      financeKeys.moneyCode('1'),
    ];
    for (const k of all) expect(k.startsWith('finance:')).toBe(true);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('range → wire params', () => {
  it('sends days for a preset and from/to for a custom range, never both', () => {
    expect(rangeQuery(rollingRange(90))).toEqual({ days: 90 });
    expect(rangeQuery(custom('2026-06-01', '2026-06-30'))).toEqual({
      from: '2026-06-01',
      to: '2026-06-30',
    });
    // The route schema is .strict() — a stray key would 400 rather than be ignored.
    expect(Object.keys(rangeQuery(rollingRange(7)))).toEqual(['days']);
  });

  it('labels both shapes distinctly', () => {
    expect(rangeLabel(rollingRange(30))).toBe('30d');
    expect(rangeLabel(custom('2026-06-01', '2026-06-30'))).toBe('2026-06-01_2026-06-30');
  });
});

describe('staleness windows', () => {
  it('are all positive and none exceed five minutes', () => {
    for (const [name, ms] of Object.entries(STALE)) {
      expect(ms, name).toBeGreaterThan(0);
      // A money figure held longer than this stops being "current enough" to act on without a refresh.
      expect(ms, name).toBeLessThanOrEqual(300_000);
    }
  });

  it('holds settled fuel history longest and live EFS movement shortest', () => {
    expect(STALE.TXNS).toBeGreaterThan(STALE.EFS_LOADS);
    expect(STALE.MONEY_CODES).toBeGreaterThan(STALE.EFS_LOADS);
  });
});
