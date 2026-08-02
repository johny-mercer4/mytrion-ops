import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { databaseUrl, env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { dbSslOption } from './client.js';

/** Stable, application-scoped advisory lock. Prevents two deploy instances migrating at once. */
const MIGRATION_LOCK_ID = 8_062_683;

/**
 * Apply pending Drizzle migrations at boot — so a deploy (push -> Render redeploy) brings the DB
 * schema forward with no separate manual step. Opt-in via DB_MIGRATE_ON_BOOT=1 (set it in the
 * Render env group): off by default so tests, tooling, and local runs never migrate unexpectedly.
 * Idempotent (Drizzle tracks applied migrations), and fail-closed — a schema that can't be brought
 * up to date must not serve half-broken endpoints, so a failure aborts boot.
 *
 * Runs on its OWN single connection (postgres.js migrator wants max:1), separate from the app pool,
 * and closes it when done.
 */
/**
 * Conditions that mean "the database is not ready yet", as opposed to "the migration is wrong".
 *
 * `57P03` (cannot_connect_now) is what Postgres answers while it replays WAL after a restart or
 * failover, and it is what killed the 2026-07-29 21:55 deploy: the release booted into a Render
 * Postgres that was still in recovery, the migrator's very first connection was refused, and because
 * migrations are (correctly) fail-closed the whole process exited. Nothing was wrong with the build.
 *
 * These are worth waiting out. A genuine migration error — bad SQL, a conflicting schema — carries
 * none of these codes and still aborts boot immediately, which is the behaviour we want to keep.
 */
export const TRANSIENT_BOOT_DB_CODES = new Set([
  '57P03', // cannot_connect_now — in recovery / still starting
  '57P01', // admin_shutdown — the server is going down under us
  '57P02', // crash_shutdown
  '53300', // too_many_connections — a restarting neighbour is holding the slots
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN', // DNS not resolving yet — normal mid-failover
  // postgres.js when Render drops the TLS socket mid-handshake / mid-restart
  'CONNECTION_CLOSED',
  'CONNECT_TIMEOUT',
]);

export function isTransientBootDbError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && TRANSIENT_BOOT_DB_CODES.has(code);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function runMigrationsOnBoot(): Promise<void> {
  if (env.DB_MIGRATE_ON_BOOT !== '1') {
    logger.debug('DB_MIGRATE_ON_BOOT not set — skipping boot migrations');
    return;
  }
  // Dockerfile copies migrations to /app/src/db/migrations; cwd is /app at runtime (tsx-dev too).
  const migrationsFolder =
    process.env.DB_MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'src/db/migrations');
  const waitMs = Math.max(0, Number(env.DB_BOOT_WAIT_SECONDS) || 0) * 1000;
  const giveUpAt = Date.now() + waitMs;

  for (let attempt = 1; ; attempt++) {
    // A fresh connection per attempt: a socket refused mid-handshake is not reusable.
    const sql = postgres(databaseUrl, { max: 1, ssl: dbSslOption(databaseUrl) });
    try {
      logger.info({ migrationsFolder, attempt }, 'applying database migrations on boot');
      await sql`select pg_advisory_lock(${MIGRATION_LOCK_ID})`;
      await migrate(drizzle(sql), { migrationsFolder });
      logger.info({ attempt }, 'database migrations up to date');
      return;
    } catch (err) {
      // Out of budget, or not the kind of failure that waiting fixes → fail closed as before.
      if (!isTransientBootDbError(err) || Date.now() >= giveUpAt) throw err;
      const backoffMs = Math.min(15_000, 1_000 * 2 ** (attempt - 1));
      logger.warn(
        { attempt, backoffMs, code: (err as { code?: string }).code, secondsLeft: Math.round((giveUpAt - Date.now()) / 1000) },
        'database not accepting connections yet — waiting before retrying boot migrations',
      );
      // Sleep AFTER the finally below has released this attempt's connection.
      await sql.end({ timeout: 5 }).catch(() => undefined);
      await sleep(backoffMs);
      continue;
    } finally {
      await sql`select pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => undefined);
      // No-op on the retry path (already ended above); closes the pool on success and on rethrow.
      await sql.end({ timeout: 5 }).catch(() => undefined);
    }
  }
}
