/**
 * The deploy-ahead-of-migration guard, and the drift that broke it once already.
 *
 * `asFlowSchemaError` turns "this database has not run 0121" into an actionable 503. It did that by
 * checking a HAND-WRITTEN list of tables, and the list had four of the twelve — so
 * `verification_statuses`, which every list call reads, fell through and the desk showed a bare
 * 500 on an environment whose only problem was an unrun migration.
 *
 * The first test below is the one that matters: it reads the migration and asserts the guard knows
 * about every table it creates. A future table cannot be added without the guard learning it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  asFlowSchemaError,
  FLOW_TABLES,
} from '../../src/modules/verificationFlow/applicationService.js';

const MIGRATION = readFileSync(
  join(process.cwd(), 'src/db/migrations/0121_verification_new_era.sql'),
  'utf8',
);

/** Wrap a driver error the way Drizzle does — SQLSTATE on the cause, table name in the outer text. */
function wrapped(sqlstate: string, message: string, query: string): Error {
  const driver = Object.assign(new Error(message), { code: sqlstate });
  return Object.assign(new Error(`Failed query: ${query}`), { cause: driver });
}

const missingTable = (table: string) =>
  wrapped('42P01', `relation "${table}" does not exist`, `select "id" from "${table}"`);

const missingColumn = (table: string, column: string) =>
  wrapped('42703', `column "${column}" does not exist`, `select "${column}" from "${table}"`);

describe('the guard covers every table the migration creates', () => {
  const created = Array.from(
    MIGRATION.matchAll(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/g),
    (m) => m[1] as string,
  );

  it('0121 creates twelve tables', () => {
    expect(created).toHaveLength(12);
  });

  it('FLOW_TABLES lists every one of them', () => {
    const known = new Set<string>(FLOW_TABLES);
    const unguarded = created.filter((t) => !known.has(t));
    expect(
      unguarded,
      'these tables would surface as a bare 500 on an un-migrated database',
    ).toEqual([]);
  });

  it('lists nothing the migration does not create', () => {
    // A stale entry is harmless but misleading — it implies coverage that no longer means anything.
    const createdSet = new Set(created);
    expect(FLOW_TABLES.filter((t) => !createdSet.has(t))).toEqual([]);
  });
});

describe('missing tables map to a 503', () => {
  it.each([...FLOW_TABLES])('catches a missing %s', (table) => {
    const mapped = asFlowSchemaError(missingTable(table));
    expect(mapped).not.toBeNull();
    expect(mapped?.statusCode).toBe(503);
    expect(mapped?.code).toBe('VERIFICATION_FLOW_NOT_MIGRATED');
    expect(mapped?.expose).toBe(true);
  });

  it('catches verification_statuses specifically — the one that regressed', () => {
    // Every list call on both desks reads this table, so missing it is the single most likely
    // symptom of an un-migrated environment.
    expect(asFlowSchemaError(missingTable('verification_statuses'))).not.toBeNull();
  });
});

describe('missing columns map to a 503', () => {
  it('catches the 0121 columns added to verification_cases', () => {
    // The half that bites more often: the table is there, one migration behind.
    expect(asFlowSchemaError(missingColumn('verification_cases', 'verification_process'))).not.toBeNull();
  });

  it('catches the 0122 column added to verification_banking_reviews', () => {
    expect(
      asFlowSchemaError(
        missingColumn('verification_banking_reviews', 'banking_inconsistent_with_operations'),
      ),
    ).not.toBeNull();
  });

  it('names both migrations so the operator knows what to run', () => {
    const message = asFlowSchemaError(missingTable('verification_policy'))?.message ?? '';
    expect(message).toContain('0121_verification_new_era');
    expect(message).toContain('0122_verification_banking_consistency');
    expect(message).toContain('pnpm db:migrate');
  });
});

describe('unrelated failures are left alone', () => {
  it('does not swallow an ordinary error', () => {
    expect(asFlowSchemaError(new Error('connection reset'))).toBeNull();
  });

  it('does not claim a migration problem for another table', () => {
    expect(asFlowSchemaError(missingTable('retention_cases'))).toBeNull();
  });

  it('does not treat a constraint violation as a missing migration', () => {
    expect(asFlowSchemaError(wrapped('23505', 'duplicate key', 'insert into verification_cases'))).toBeNull();
  });
});
