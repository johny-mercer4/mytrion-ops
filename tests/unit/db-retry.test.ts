/**
 * CS feedback 2026-08-07: clicking Refresh on the Maintenance tab threw "Internal server error" —
 * traced to a pooled connection dying between page-load and Refresh (client.ts's idle_timeout is a
 * race against Render's own reaper, not a guarantee). withDbRetry is the fix: retry once on a
 * dead-socket error, never on a real query error.
 */
import { describe, expect, it, vi } from 'vitest';
import { withDbRetry } from '../../src/db/retry.js';

function connectionClosedError(): Error {
  return new Error('CONNECTION_CLOSED: Connection terminated unexpectedly');
}

describe('withDbRetry', () => {
  it('returns the result on a normal, successful call — no retry', async () => {
    const fn = vi.fn(async () => 'ok');
    await expect(withDbRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds after a dead-socket error', async () => {
    const fn = vi.fn().mockRejectedValueOnce(connectionClosedError()).mockResolvedValueOnce('ok');
    await expect(withDbRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('recognizes a Postgres admin-shutdown code, not just the postgres.js message text', async () => {
    const err = Object.assign(new Error('terminating connection due to administrator command'), {
      code: '57P01',
    });
    const fn = vi.fn().mockRejectedValueOnce(err).mockResolvedValueOnce('ok');
    await expect(withDbRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry a real query error — it fails identically either way', async () => {
    const queryError = new Error('column "nope" does not exist');
    const fn = vi.fn().mockRejectedValue(queryError);
    await expect(withDbRetry(fn)).rejects.toBe(queryError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the retry — two dead sockets in a row is a real outage, not a blip', async () => {
    const fn = vi.fn().mockRejectedValue(connectionClosedError());
    await expect(withDbRetry(fn)).rejects.toThrow(/CONNECTION_CLOSED/);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
