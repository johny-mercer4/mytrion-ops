/**
 * `isMissingTable` / `isMissingColumn` — the "deployed ahead of the migration" guard.
 *
 * These exist so a screen returns an actionable 503 instead of a bare 500 when code reaches an
 * environment before its schema does. They are worth a test for one reason: the errors they match
 * are WRAPPED. Drizzle throws its own Error whose `message` is "Failed query: <sql>" and whose
 * `cause` is the pg driver error carrying the SQLSTATE — so the code and the table name live on
 * different nodes of the chain, and a check that reads only `err.code` or only `err.message` passes
 * review and never fires in production.
 *
 * The undefined-COLUMN half is the one that recurs. A table is only missing on the single release
 * that introduces it; a column is missing on every later release that adds one. Migration 0115
 * (`mytrion_permission_sets.override`) is exactly that case, and it put a 500 back on a screen that
 * already knew how to explain the problem.
 */
import { describe, expect, it } from 'vitest';

import { isMissingColumn, isMissingTable } from '../../src/repos/util.js';

const TABLE = 'mytrion_permission_sets';

/** What Drizzle actually throws: its own error, with the driver error as `cause`. */
function wrapped(sqlstate: string, driverMessage: string, sql: string): Error {
  const driver = Object.assign(new Error(driverMessage), { code: sqlstate });
  return Object.assign(new Error(`Failed query: ${sql}`), { cause: driver });
}

const undefinedTable = (): Error =>
  wrapped(
    '42P01',
    `relation "${TABLE}" does not exist`,
    `select "id" from "${TABLE}" where "tenant_id" = $1`,
  );

/**
 * Postgres does NOT name the table in an undefined-column message — only the column. So the table
 * match can only come from the SQL in Drizzle's outer message, which is why the helper is scoped
 * per table rather than offered as a bare `isMissingColumn(err)`.
 */
const undefinedColumn = (): Error =>
  wrapped(
    '42703',
    'column "override" does not exist',
    `select "id", "override" from "${TABLE}" where "tenant_id" = $1`,
  );

describe('undefined table (42P01)', () => {
  it('is detected through Drizzle’s wrapper', () => {
    expect(isMissingTable(undefinedTable(), TABLE)).toBe(true);
  });

  it('is not confused with an undefined column', () => {
    expect(isMissingTable(undefinedColumn(), TABLE)).toBe(false);
  });

  it('does not fire for a different table', () => {
    expect(isMissingTable(undefinedTable(), 'mytrion_worker_tasks')).toBe(false);
  });
});

describe('undefined column (42703)', () => {
  it('is detected through Drizzle’s wrapper', () => {
    expect(isMissingColumn(undefinedColumn(), TABLE)).toBe(true);
  });

  it('is not confused with an undefined table', () => {
    expect(isMissingColumn(undefinedTable(), TABLE)).toBe(false);
  });

  it('does not fire for a different table', () => {
    // The statement names `mytrion_permission_sets`, so a guard scoped to another table must not
    // claim this error — otherwise one unmigrated table would 503 every screen in the app.
    expect(isMissingColumn(undefinedColumn(), 'mytrion_role_defaults')).toBe(false);
  });

  it('is detected when the driver error arrives unwrapped', () => {
    // Not every caller goes through Drizzle's query builder; a raw `sql` execution can surface the
    // driver error directly, with the code and the statement on the same object.
    const flat = Object.assign(new Error(`column "override" does not exist in ${TABLE}`), {
      code: '42703',
    });
    expect(isMissingColumn(flat, TABLE)).toBe(true);
  });
});

describe('everything else is left alone', () => {
  it.each([
    ['a unique violation', Object.assign(new Error('duplicate key'), { code: '23505' })],
    ['a connection refusal', Object.assign(new Error('ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    ['a plain error', new Error('boom')],
    ['null', null],
    ['a string', 'not an error'],
  ])('%s is neither a missing table nor a missing column', (_label, err) => {
    expect(isMissingTable(err, TABLE)).toBe(false);
    expect(isMissingColumn(err, TABLE)).toBe(false);
  });

  it('does not loop forever on a self-referencing cause chain', () => {
    const err: Error & { cause?: unknown } = new Error('cycle');
    err.cause = err;
    expect(isMissingColumn(err, TABLE)).toBe(false);
  });
});
