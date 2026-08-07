/**
 * Structural guards on the Drizzle migration journal.
 *
 * Drizzle applies migrations in journal order and records each entry's `when` as its
 * `created_at`. On an EXISTING database it skips any entry whose `when` is not newer than the
 * newest already applied — so a journal where `when` decreases along `idx` can silently skip a
 * migration and still exit 0 green. That is the failure mode that produced the 0022 baseline
 * repair and forced a journal restamp during a `build` merge, and it happens naturally whenever
 * two branches cut migrations off `build` independently and merge at different times.
 *
 * These tests are pure filesystem reads — no database, no network — so they gate every PR.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints?: boolean;
}

const MIGRATIONS_DIR = new URL('../../src/db/migrations/', import.meta.url);

function journal(): JournalEntry[] {
  const raw = readFileSync(new URL('meta/_journal.json', MIGRATIONS_DIR), 'utf8');
  return (JSON.parse(raw) as { entries: JournalEntry[] }).entries;
}

function sqlTags(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .map((name) => name.slice(0, -'.sql'.length));
}

const numberOf = (tag: string): string => tag.split('_')[0] ?? '';

/**
 * Violations that predate this guard. They are recorded rather than fixed because renaming or
 * restamping an ALREADY-APPLIED migration changes its journal tag, which makes Drizzle treat it as
 * new and re-run it against local and production databases. Verified harmless: a fresh
 * `db:migrate` applies all entries and `maintenance_cases` exists.
 *
 * Do not add to these lists. A new entry here means a migration that can be skipped in production.
 */
const GRANDFATHERED_NON_MONOTONIC_IDX = new Set([79]);
const GRANDFATHERED_DUPLICATE_NUMBERS = new Set(['0104']);

describe('drizzle migration journal', () => {
  it('has exactly one journal entry per .sql file', () => {
    const tags = new Set(sqlTags());
    const entries = journal();
    const journalTags = entries.map((entry) => entry.tag);
    expect(new Set(journalTags).size).toBe(journalTags.length);
    expect(journalTags.filter((tag) => !tags.has(tag))).toEqual([]);
    expect([...tags].filter((tag) => !journalTags.includes(tag))).toEqual([]);
  });

  it('numbers entries consecutively from 0 with no gaps', () => {
    const idx = journal().map((entry) => entry.idx);
    expect(idx).toEqual(idx.map((_, position) => position));
  });

  // The important one: a decreasing `when` is what silently skips a migration in production.
  it('never lets `when` decrease as `idx` increases', () => {
    const entries = journal();
    const offenders = entries
      .slice(1)
      .filter((entry, position) => {
        const previous = entries[position];
        return previous !== undefined && entry.when <= previous.when;
      })
      .filter((entry) => !GRANDFATHERED_NON_MONOTONIC_IDX.has(entry.idx))
      .map((entry) => {
        const previous = entries[entry.idx - 1];
        return `${entry.tag} (idx ${entry.idx}, when ${entry.when}) is not newer than ${previous?.tag} (when ${previous?.when})`;
      });
    expect(
      offenders,
      'A migration whose `when` is not newer than its predecessor can be SKIPPED silently on an ' +
        'existing database. If you rebased or merged onto a branch that added migrations, restamp ' +
        'yours: bump `when` in meta/_journal.json above every earlier entry.',
    ).toEqual([]);
  });

  it('does not reuse a migration number', () => {
    const numbers = journal().map((entry) => numberOf(entry.tag));
    const duplicates = [
      ...new Set(numbers.filter((value, index) => numbers.indexOf(value) !== index)),
    ].filter((value) => !GRANDFATHERED_DUPLICATE_NUMBERS.has(value));
    expect(
      duplicates,
      'Two migrations share a number, so the intended order is ambiguous to everyone reading the ' +
        'directory. Renumber the newer one before it is applied anywhere.',
    ).toEqual([]);
  });

  it('keeps the grandfathered exceptions honest', () => {
    // If someone genuinely repairs a grandfathered violation, this fails and the entry should be
    // dropped from the set above — so the allowlist cannot quietly outlive the problem.
    const entries = journal();
    for (const idx of GRANDFATHERED_NON_MONOTONIC_IDX) {
      const entry = entries[idx];
      const previous = entries[idx - 1];
      expect(entry, `grandfathered idx ${idx} no longer exists`).toBeDefined();
      expect(
        previous !== undefined && entry !== undefined && entry.when <= previous.when,
        `idx ${idx} is now monotonic — remove it from GRANDFATHERED_NON_MONOTONIC_IDX`,
      ).toBe(true);
    }
    const numbers = entries.map((entry) => numberOf(entry.tag));
    for (const number of GRANDFATHERED_DUPLICATE_NUMBERS) {
      expect(
        numbers.filter((value) => value === number).length,
        `${number} is no longer duplicated — remove it from GRANDFATHERED_DUPLICATE_NUMBERS`,
      ).toBeGreaterThan(1);
    }
  });
});
