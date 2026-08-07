/**
 * Retry a DB operation once if it fails on a dead-socket error, not a real query error.
 *
 * `client.ts`'s `idle_timeout: 20` closes idle sockets ourselves before Render's own reaper does —
 * but that is a race, not a guarantee: a pooled connection can be severed at the network/LB layer
 * between two queries, and the NEXT query to touch it throws a raw driver exception
 * (`CONNECTION_CLOSED`, "Connection terminated unexpectedly", Postgres admin-shutdown codes) that has
 * nothing to do with the query itself. Every repo's error path (src/plugins/errorHandler.ts) turns
 * an uncaught, non-AppError exception into a bare "Internal server error" 500 — which is exactly
 * what CS reported (2026-08-07) hitting Refresh on the Maintenance tab: the button re-issues the
 * SAME query the page just loaded successfully, on a connection that had time to go idle while the
 * agent was reading the list. A read is idempotent, so retrying once against a fresh connection is
 * safe; a genuine query bug (bad SQL, a type error) will fail identically on the retry and still
 * surface.
 */
const TRANSIENT_DB_ERROR =
  /CONNECTION_CLOSED|CONNECTION_ENDED|ECONNRESET|EPIPE|ETIMEDOUT|\b(57P01|08006|08003|08000)\b|connection.*(closed|terminated|reset|ended)/i;

function isTransientDbError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as Error & { code?: string }).code ?? '';
  return TRANSIENT_DB_ERROR.test(`${err.message} ${code}`);
}

export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientDbError(err)) throw err;
    return await fn();
  }
}
