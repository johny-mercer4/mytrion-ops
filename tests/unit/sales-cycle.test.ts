import { describe, expect, it } from 'vitest';
import {
  CYCLE_START_SQL,
  PREV_CYCLE_START_SQL,
  cycleCte,
  cycleRangeIso,
  cycleWindowSql,
  salesCycleBounds,
} from '../../src/lib/salesCycle.js';

const utc = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);

describe('sales cycle boundaries (26th → 25th)', () => {
  it('starts on the 26th of THIS month once the 26th has arrived', () => {
    const b = salesCycleBounds(utc('2026-08-26'));
    expect(b.start.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(b.endInclusive.toISOString().slice(0, 10)).toBe('2026-09-25');
  });

  it('starts on the 26th of LAST month before the 26th arrives', () => {
    const b = salesCycleBounds(utc('2026-08-12'));
    expect(b.start.toISOString().slice(0, 10)).toBe('2026-07-26');
    expect(b.endInclusive.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  /** The 25th/26th flip is the whole rule; an off-by-one here misreports a rep's entire cycle. */
  it('flips exactly between the 25th and the 26th', () => {
    expect(salesCycleBounds(utc('2026-08-25')).start.toISOString().slice(0, 10)).toBe('2026-07-26');
    expect(salesCycleBounds(utc('2026-08-26')).start.toISOString().slice(0, 10)).toBe('2026-08-26');
  });

  it('is half-open so the 25th is fully included and the next 26th is not', () => {
    const b = salesCycleBounds(utc('2026-08-12'));
    expect(b.endExclusive.toISOString().slice(0, 10)).toBe('2026-08-26');
    expect(b.endExclusive.getTime() - b.endInclusive.getTime()).toBe(86_400_000);
  });

  it('handles February and year boundaries without month-length arithmetic', () => {
    const feb = salesCycleBounds(utc('2026-02-10'));
    expect(feb.start.toISOString().slice(0, 10)).toBe('2026-01-26');
    expect(feb.endInclusive.toISOString().slice(0, 10)).toBe('2026-02-25');

    const jan = salesCycleBounds(utc('2026-01-05'));
    expect(jan.start.toISOString().slice(0, 10)).toBe('2025-12-26');
    expect(jan.endInclusive.toISOString().slice(0, 10)).toBe('2026-01-25');

    const dec = salesCycleBounds(utc('2026-12-30'));
    expect(dec.start.toISOString().slice(0, 10)).toBe('2026-12-26');
    expect(dec.endInclusive.toISOString().slice(0, 10)).toBe('2027-01-25');
  });

  it('offsets whole cycles back, and cycles abut without gap or overlap', () => {
    const cur = salesCycleBounds(utc('2026-08-12'), 0);
    const prev = salesCycleBounds(utc('2026-08-12'), 1);
    expect(prev.start.toISOString().slice(0, 10)).toBe('2026-06-26');
    expect(prev.endInclusive.toISOString().slice(0, 10)).toBe('2026-07-25');
    // The previous cycle's exclusive end is exactly the current cycle's start.
    expect(prev.endExclusive.getTime()).toBe(cur.start.getTime());
  });

  it('labels the window the way a rep reads it', () => {
    expect(salesCycleBounds(utc('2026-08-12')).label).toBe('26 Jul – 25 Aug 2026');
  });

  it('emits an inclusive ISO range for tools that take from/to', () => {
    expect(cycleRangeIso(utc('2026-08-12'))).toEqual({ from: '2026-07-26', to: '2026-08-25' });
    expect(cycleRangeIso(utc('2026-08-12'), 1)).toEqual({ from: '2026-06-26', to: '2026-07-25' });
  });
});

describe('sales cycle SQL', () => {
  it('states the rule once and derives the previous cycle from it', () => {
    expect(CYCLE_START_SQL).toContain('extract(day from current_date) >= 26');
    expect(PREV_CYCLE_START_SQL).toContain(CYCLE_START_SQL);
    expect(PREV_CYCLE_START_SQL).toContain("- interval '1 month'");
  });

  it('builds a named CTE exposing cycle_start', () => {
    expect(cycleCte()).toMatch(/^cyc as \(/);
    expect(cycleCte('bounds')).toMatch(/^bounds as \(/);
    expect(cycleCte()).toContain('as cycle_start');
  });

  /** Half-open, so the 25th is included without any month-length special case. */
  it('bounds a column half-open over one month from the cycle start', () => {
    const cur = cycleWindowSql('t.transaction_date', 'current');
    expect(cur).toContain('t.transaction_date >=');
    expect(cur).toContain('t.transaction_date <');
    expect(cur).toContain("+ interval '1 month'");

    const prev = cycleWindowSql('t.transaction_date', 'previous');
    expect(prev).toContain("- interval '1 month'");
    expect(prev).not.toBe(cur);
  });

  /**
   * The rule had drifted into four copies (two files in src/, plus the CRM frontend). The point of
   * lib/salesCycle.ts is that src/ states it exactly once.
   */
  it('is the single source of truth in src/', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const { join, relative } = await import('node:path');

    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && readFileSync(full, 'utf8').includes('extract(day from current_date)')) {
          hits.push(relative(process.cwd(), full));
        }
      }
    };
    walk(join(process.cwd(), 'src'));

    expect(hits).toEqual(['src/lib/salesCycle.ts']);
  });
});
