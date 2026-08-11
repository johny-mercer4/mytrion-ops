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
 * True if the error is a Postgres undefined-table violation (SQLSTATE 42P01) for `table`.
 *
 * The realistic cause is code deployed ahead of its migration. Left as a raw failure the caller
 * returns "Internal server error", which tells an admin nothing and sends them to the logs to find a
 * one-line answer. `dataLoader.routes.ts` already did this by hand for its own table; this is the
 * same check, named once.
 */
export function isMissingTable(err: unknown, table: string): boolean {
  // Drizzle wraps the driver error, so 42P01 sits on the CAUSE while the table name is only in the
  // outer "Failed query: …" message. Walk the chain and take the code from wherever it is.
  let hasCode = false;
  let mentionsTable = false;
  let node: unknown = err;
  for (let depth = 0; node !== null && node !== undefined && depth < 5; depth += 1) {
    if (typeof node !== 'object') break;
    if ((node as { code?: unknown }).code === '42P01') hasCode = true;
    const message = (node as { message?: unknown }).message;
    if (typeof message === 'string' && message.includes(table)) mentionsTable = true;
    node = (node as { cause?: unknown }).cause;
  }
  return hasCode && mentionsTable;
}

/** Format a number[] as a pgvector text literal: [0.1,0.2,...]. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

export interface Pagination {
  limit: number;
  offset: number;
}

export function normalizePagination(input?: { limit?: number; offset?: number }): Pagination {
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
  const offset = Math.max(input?.offset ?? 0, 0);
  return { limit, offset };
}
