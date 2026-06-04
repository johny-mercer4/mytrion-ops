import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema/index.js';

/**
 * SSL is required by managed Postgres (e.g. Render external hosts) but off for local
 * docker. Detect by hostname; managed connections use TLS without CA verification
 * (Render presents its own CA), which is the standard Render client setup.
 */
export function dbSslOption(url: string): false | { rejectUnauthorized: false } {
  try {
    const host = new URL(url).hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === 'postgres';
    return isLocal ? false : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

/**
 * postgres.js connects lazily (on first query), so importing this module never
 * opens a socket — safe for tests and tooling that don't touch the DB.
 */
const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  ssl: dbSslOption(env.DATABASE_URL),
  onnotice: (notice) => logger.debug({ notice }, 'pg notice'),
});

export const db: PostgresJsDatabase<typeof schema> = drizzle(sql, { schema });
export type Database = typeof db;
export { schema };

/** Raw postgres.js client — use for vector kNN and other queries Drizzle can't express. */
export const pg = sql;

export async function pingDb(): Promise<boolean> {
  await sql`select 1`;
  return true;
}

export async function closeDb(): Promise<void> {
  await sql.end({ timeout: 5 });
}
