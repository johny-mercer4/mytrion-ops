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
