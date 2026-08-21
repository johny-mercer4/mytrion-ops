/**
 * Which dates of birth the desk believes.
 *
 * The bug this covers reached production: two `array_reports` rows carry `1191-07-26` (carrier
 * 5785258, May and Jun 2026) — a typo for 1991 — and the Array list rendered it as
 * "Jul 26, 1191" beside real birthdays. servercrm's AR-SYNC would never have written it; the seed
 * that populated the mirror copied Zoho's raw value without the sync's `validDob` check.
 *
 * The bounds are servercrm's, to the year, so the two implementations cannot disagree about a
 * birthday near the boundary.
 */
import { describe, expect, it } from 'vitest';
import {
  DOB_MIN_AGE_YEARS,
  DOB_MIN_YEAR,
  hasPlausibleDob,
  hasPlausibleDobSql,
  needsDobLookupSql,
} from '../../src/repos/dobPlausibility.js';

/** Fixed so the suite does not change meaning as the calendar moves. */
const NOW = new Date('2026-08-21T00:00:00.000Z');

describe('hasPlausibleDob', () => {
  it('rejects the value that actually shipped to production', () => {
    expect(hasPlausibleDob('1191-07-26', NOW)).toBe(false);
  });

  it('accepts the ordinary birthdays that fill the column', () => {
    // Sampled from the real distribution: 1950s through 2000s, peaking in the 1980s.
    for (const dob of ['1963-02-15', '1978-07-28', '1984-06-12', '1989-02-13', '2000-01-03']) {
      expect(hasPlausibleDob(dob, NOW), dob).toBe(true);
    }
  });

  it('holds the exact year bounds rather than approximating them', () => {
    expect(hasPlausibleDob('1919-12-31', NOW)).toBe(false);
    expect(hasPlausibleDob(`${DOB_MIN_YEAR}-01-01`, NOW)).toBe(true);

    const oldestMinor = NOW.getUTCFullYear() - DOB_MIN_AGE_YEARS;
    expect(hasPlausibleDob(`${oldestMinor}-12-31`, NOW)).toBe(true);
    expect(hasPlausibleDob(`${oldestMinor + 1}-01-01`, NOW)).toBe(false);
  });

  it('moves its upper bound with the calendar', () => {
    const later = new Date('2044-08-21T00:00:00.000Z');
    expect(hasPlausibleDob('2026-01-01', NOW)).toBe(false);
    expect(hasPlausibleDob('2026-01-01', later)).toBe(true);
  });

  it('treats absent, malformed and future values as no birthday at all', () => {
    for (const bad of [null, undefined, '', '   ', 'yesterday', '26-07-1191', '2999-01-01']) {
      expect(hasPlausibleDob(bad as string | null, NOW), String(bad)).toBe(false);
    }
  });

  it('accepts a Date as well as an ISO string — the driver returns either', () => {
    expect(hasPlausibleDob(new Date('1978-07-28T00:00:00.000Z'), NOW)).toBe(true);
    expect(hasPlausibleDob(new Date('1191-07-26T00:00:00.000Z'), NOW)).toBe(false);
  });
});

describe('the SQL twin states the same rule', () => {
  /**
   * The SQL runs in Postgres and the TS runs here, so a unit test cannot execute both. What it CAN
   * pin is that the SQL carries the same two bounds — the drift that would let the list and the
   * KPI tile disagree about one row.
   */
  const sqlText = (fragment: { queryChunks: unknown[] }): string =>
    fragment.queryChunks
      .map((chunk) => {
        // Drizzle interleaves StringChunk (literal SQL, `value` is string[]), column refs, and
        // bound params. Only the literals and the numbers carry the bounds we are pinning.
        const literal = (chunk as { value?: unknown }).value;
        if (Array.isArray(literal)) return literal.join('');
        if (typeof chunk === 'number') return String(chunk);
        return '';
      })
      .join('');

  it('bounds on the same year floor and the same adult age', () => {
    const text = sqlText(hasPlausibleDobSql as unknown as { queryChunks: unknown[] });
    expect(text).toContain(String(DOB_MIN_YEAR));
    expect(text).toContain(String(DOB_MIN_AGE_YEARS));
    expect(text).toContain('extract(year from');
  });

  it('counts a row with an unusable date as needing a lookup, not as having one', () => {
    const text = sqlText(needsDobLookupSql as unknown as { queryChunks: unknown[] });
    // Wider than the stored flag on purpose — the production rows carry needs_dob_lookup = false
    // AND an unusable date, which is exactly the combination that must still surface.
    expect(text).toContain('IS TRUE OR NOT');
  });
});
