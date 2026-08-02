/**
 * Boot-migration resilience. The 2026-07-29 21:55 deploy died because Render Postgres was still in
 * recovery when the release booted: the migrator's first connection came back `57P03`
 * (cannot_connect_now) and, migrations being fail-closed, the process exited.
 *
 * The distinction these tests pin down is the whole point of the fix: "not ready yet" is worth
 * waiting out, "your migration is wrong" must still abort boot immediately.
 */
import { describe, expect, it } from 'vitest';
import { TRANSIENT_BOOT_DB_CODES, isTransientBootDbError } from '../../src/db/migrate.js';

/** Shape of what postgres.js throws — a plain Error carrying a `code`. */
function pgError(code: string, message = 'boom'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('isTransientBootDbError', () => {
  it('treats a database still in recovery as transient — the exact code that failed the deploy', () => {
    expect(isTransientBootDbError(pgError('57P03', 'the database system is in recovery mode'))).toBe(
      true,
    );
  });

  it('treats the other unavailability codes as transient', () => {
    for (const code of ['57P01', '57P02', '53300', '08006', '08001', '08004']) {
      expect(isTransientBootDbError(pgError(code)), code).toBe(true);
    }
  });

  it('treats socket/DNS failures during a failover as transient', () => {
    for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN']) {
      expect(isTransientBootDbError(pgError(code)), code).toBe(true);
    }
  });

  it('does NOT retry a real migration failure — bad SQL must still abort boot', () => {
    // 42601 syntax_error, 42P07 duplicate_table, 23505 unique_violation: all mean the migration is
    // wrong, and waiting would only delay a deploy that can never succeed.
    for (const code of ['42601', '42P07', '23505', '42703']) {
      expect(isTransientBootDbError(pgError(code)), code).toBe(false);
    }
  });

  it('does NOT retry an authentication or missing-database failure — waiting cannot fix config', () => {
    for (const code of ['28P01', '3D000', '28000']) {
      expect(isTransientBootDbError(pgError(code)), code).toBe(false);
    }
  });

  it('is safe on errors that carry no code at all', () => {
    expect(isTransientBootDbError(new Error('no code here'))).toBe(false);
    expect(isTransientBootDbError(null)).toBe(false);
    expect(isTransientBootDbError(undefined)).toBe(false);
    expect(isTransientBootDbError('a string')).toBe(false);
    // A non-string code must not be coerced into a match.
    expect(isTransientBootDbError({ code: 57_703 })).toBe(false);
  });

  it('keeps the retry set narrow — every entry is an unavailability condition, not a schema one', () => {
    // Guards against someone widening this to "retry everything", which would turn a broken
    // migration into a 90-second stall followed by the same failure.
    expect(TRANSIENT_BOOT_DB_CODES.size).toBeLessThanOrEqual(13);
    for (const forbidden of ['42601', '42P07', '23505', '28P01', '3D000']) {
      expect(TRANSIENT_BOOT_DB_CODES.has(forbidden), forbidden).toBe(false);
    }
  });
});
