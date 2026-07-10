import path from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { databaseUrl, env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { dbSslOption } from './client.js';

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
export async function runMigrationsOnBoot(): Promise<void> {
  if (env.DB_MIGRATE_ON_BOOT !== '1') {
    logger.debug('DB_MIGRATE_ON_BOOT not set — skipping boot migrations');
    return;
  }
  // Dockerfile copies migrations to /app/src/db/migrations; cwd is /app at runtime (tsx-dev too).
  const migrationsFolder =
    process.env.DB_MIGRATIONS_DIR ?? path.resolve(process.cwd(), 'src/db/migrations');
  const sql = postgres(databaseUrl, { max: 1, ssl: dbSslOption(databaseUrl) });
  try {
    logger.info({ migrationsFolder }, 'applying database migrations on boot');
    await migrate(drizzle(sql), { migrationsFolder });
    logger.info('database migrations up to date');
  } finally {
    await sql.end({ timeout: 5 });
  }
}
