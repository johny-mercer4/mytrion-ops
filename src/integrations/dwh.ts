/**
 * DWH wrapper — read-only access to the Data Warehouse Postgres (a separate, third-party
 * analytics DB; never migrated/written by us). A pooled connection, enforced read-only at the
 * session level. Tools that read the DWH go through `dwhQuery`.
 */
import pg from 'pg';
import type { Pool, QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: Pool | null = null;

/** Lazily create the read-only DWH pool. Throws if DWH_DATABASE_URL is unconfigured. */
export function getDwhPool(): Pool {
  if (pool) return pool;
  if (!env.DWH_DATABASE_URL) {
    throw new Error('[dwh] DWH_DATABASE_URL is not configured');
  }
  pool = new pg.Pool({
    connectionString: env.DWH_DATABASE_URL,
    ssl: false, // DWH is a direct, non-TLS Postgres (matches servercrm).
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    // Enforce read-only at the session level — this wrapper must never write the DWH.
    options: '-c default_transaction_read_only=on',
  });
  pool.on('error', (err) => logger.error({ err: err.message }, 'DWH pool error'));
  return pool;
}

/** Run a read-only query against the DWH and return its rows. */
export async function dwhQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await getDwhPool().query<T>(text, params as unknown[]);
  return result.rows;
}

/** Close the pool (graceful shutdown / tests). */
export async function closeDwhPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
