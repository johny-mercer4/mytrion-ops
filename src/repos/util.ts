import { AppError } from '../lib/errors.js';

/** First row or undefined (works with noUncheckedIndexedAccess). */
export function firstOrUndefined<T>(rows: readonly T[]): T | undefined {
  return rows[0];
}

/** First row, or throw an internal error (use when a row is guaranteed, e.g. INSERT ... RETURNING). */
export function firstOrThrow<T>(rows: readonly T[], message = 'Expected a row but got none'): T {
  const row = rows[0];
  if (row === undefined) {
    throw new AppError(message, { code: 'DB_EMPTY_RESULT', statusCode: 500 });
  }
  return row;
}

/** True if the error is a Postgres unique-constraint violation (SQLSTATE 23505). */
export function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === '23505'
  );
}

/**
 * True if a Postgres error carrying SQLSTATE `sqlstate` was raised against `table`.
 *
 * Drizzle WRAPS the driver error, so the SQLSTATE sits on the cause while the table name appears
 * only in the outer "Failed query: …" text. Neither is reliably on the same node, so the chain is
 * walked once and each fact is taken from wherever it turns up.
 */
function isPgErrorFor(err: unknown, sqlstate: string, table: string): boolean {
  let hasCode = false;
  let mentionsTable = false;
  let node: unknown = err;
  for (let depth = 0; node !== null && node !== undefined && depth < 5; depth += 1) {
    if (typeof node !== 'object') break;
    if ((node as { code?: unknown }).code === sqlstate) hasCode = true;
    const message = (node as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes(table)) mentionsTable = true;
    node = (node as { cause?: unknown }).cause;
  }
  return hasCode && mentionsTable;
}

/**
 * True if the error is a Postgres undefined-table violation (SQLSTATE 42P01) for `table`.
 *
 * The realistic cause is code deployed ahead of its migration. Left as a raw failure the caller
 * returns "Internal server error", which tells an admin nothing and sends them to the logs to find a
 * one-line answer. `dataLoader.routes.ts` already did this by hand for its own table; this is the
 * same check, named once.
 */
export function isMissingTable(err: unknown, table: string): boolean {
  return isPgErrorFor(err, '42P01', table);
}

/**
 * True if the error is a Postgres undefined-COLUMN violation (SQLSTATE 42703) against `table`.
 *
 * The second half of the same deploy-order problem, and the half that actually bites: a table only
 * goes missing on the very first release that introduces it, whereas every later migration that adds
 * a column reopens the window — the table is there, the query names a column that is not, and 42P01
 * never fires. `mytrion_permission_sets.override` did exactly this: an environment one migration
 * behind returned a bare 500 on a screen that already knew how to explain the problem.
 *
 * Postgres does not name the table in an undefined-column message ("column X does not exist"), so
 * the match relies on Drizzle's outer "Failed query" text, which contains the statement. That is why
 * this is scoped per table rather than offered as a bare `isMissingColumn(err)`.
 */
export function isMissingColumn(err: unknown, table: string): boolean {
  return isPgErrorFor(err, '42703', table);
}

/** Format a number[] as a pgvector text literal: [0.1,0.2,...]. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export interface Pagination {
  limit: number;
  offset: number;
}

/**
 * Clamp caller-supplied paging. `maxLimit` defaults to the 200-row page cap every list route uses;
 * export paths pass a higher ceiling because a CSV/XLSX of the current filter is one request, not a
 * page the user scrolls.
 */
export function normalizePagination(
  // `| undefined` on each field, not just on `input`: under `exactOptionalPropertyTypes` a caller
  // holding a filter whose own `limit` is `number | undefined` cannot pass it otherwise, and every
  // route filter is shaped that way. Widening a parameter only admits more callers.
  input?: { limit?: number | undefined; offset?: number | undefined },
  maxLimit = 200,
): Pagination {
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), maxLimit);
  const offset = Math.max(input?.offset ?? 0, 0);
  return { limit, offset };
}
