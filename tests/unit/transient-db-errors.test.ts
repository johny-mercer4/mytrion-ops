/**
 * A sleeping database must read as "retry", not "broken".
 *
 * This deployment's Postgres sleeps when idle, so the first read after a quiet spell fails — and which
 * route happens to be first is arbitrary. That makes this a property of the error handler, not of any
 * one route. The pattern list is the part that actually decides, so it is what these pin.
 */
import { describe, expect, it } from 'vitest';
import { isTransientDbError } from '../../src/modules/jobs/bossErrors.js';

describe('isTransientDbError', () => {
  it('recognises Postgres refusing connections while it starts up', () => {
    expect(isTransientDbError(new Error('the database system is starting up'))).toBe(true);
  });

  /**
   * THE CASE THAT ACTUALLY HAPPENS, and the one an easy test misses.
   *
   * Routes never catch the Postgres error directly — Drizzle wraps it. `DrizzleQueryError` is built as
   * `super('Failed query: ' + query + ...)` with the driver error on `cause`, so the top-level message
   * says only that A query failed, never that the DATABASE WAS ASLEEP. Reading `err.message` alone
   * classifies a real outage as a generic 500, which is exactly the bug that was reported.
   */
  it('reads through the Drizzle wrapper to the driver error underneath', () => {
    const driverError = new Error('the database system is starting up');
    const wrapped = new Error(
      'Failed query: select "id", "name" from "hr_attendance_shifts" where "tenant_id" = $1\nparams: octane',
      { cause: driverError },
    );

    // Guard the premise: if this ever stops holding, the test below proves nothing.
    expect(wrapped.message).not.toContain('starting up');
    expect(isTransientDbError(wrapped)).toBe(true);
  });

  it('reads through more than one layer of wrapping', () => {
    const deep = new Error('outer', {
      cause: new Error('middle', { cause: new Error('connection terminated unexpectedly') }),
    });
    expect(isTransientDbError(deep)).toBe(true);
  });

  /** Runs inside the error handler; a self-referencing chain must not hang the process. */
  it('survives a cyclic cause chain', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isTransientDbError(a)).toBe(false);
  });

  it('recognises the shutdown and recovery variants', () => {
    expect(isTransientDbError(new Error('the database system is shutting down'))).toBe(true);
    expect(isTransientDbError(new Error('the database system is in recovery mode'))).toBe(true);
    expect(isTransientDbError(new Error('cannot connect now'))).toBe(true);
  });

  it('still recognises the socket-level failures it always did', () => {
    expect(isTransientDbError(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isTransientDbError(new Error('read ECONNRESET'))).toBe(true);
    expect(isTransientDbError(new Error('socket hang up'))).toBe(true);
  });

  it('is case-insensitive, because drivers disagree about capitalisation', () => {
    expect(isTransientDbError(new Error('The Database System Is Starting Up'))).toBe(true);
  });

  /**
   * The important negative. Treating a real fault as transient would tell the user to retry something
   * that will never succeed, and would hide the fault behind a 503 nobody investigates.
   */
  it('does NOT swallow genuine errors', () => {
    expect(isTransientDbError(new Error('relation "hr_employees" does not exist'))).toBe(false);
    expect(isTransientDbError(new Error('duplicate key value violates unique constraint'))).toBe(
      false,
    );
    expect(isTransientDbError(new Error('permission denied for table hr_attendance_punches'))).toBe(
      false,
    );
    expect(isTransientDbError(new Error('syntax error at or near "slect"'))).toBe(false);
  });

  it('reads a message off a non-Error, which is what some drivers throw', () => {
    expect(isTransientDbError({ message: 'the database system is starting up' })).toBe(true);
    expect(isTransientDbError({ message: 'wrapped', cause: { message: 'socket hang up' } })).toBe(
      true,
    );
    expect(isTransientDbError('socket hang up')).toBe(true);
    expect(isTransientDbError(undefined)).toBe(false);
  });

  /** A wrapper around a REAL fault must stay a 500 — the cause walk must not make everything transient. */
  it('does not turn a wrapped genuine error into a transient one', () => {
    const wrapped = new Error('Failed query: select ...', {
      cause: new Error('relation "hr_employees" does not exist'),
    });
    expect(isTransientDbError(wrapped)).toBe(false);
  });
});
