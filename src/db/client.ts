import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import * as schema from './schema/index.js';

/**
 * postgres.js connects lazily (on first query), so importing this module never
 * opens a socket — safe for tests and tooling that don't touch the DB.
 */
const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
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
