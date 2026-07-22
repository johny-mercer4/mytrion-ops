/**
 * DWH wrapper — read-only access to the Data Warehouse Postgres (a separate, third-party
 * analytics DB; never migrated/written by us). A pooled connection, enforced read-only at the
 * session level. Tools that read the DWH go through `dwh.query` (or the `dwhQuery` facade).
 * Postgres dialect: `$1` placeholders — NOT portable to the CMP MySQL wrapper (`?`).
 */
import pg from 'pg';
import type { Pool, QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { SqlWrapper } from './core/sqlBase.js';

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
    // Enforce read-only at the session level — this wrapper must never write the DWH. Also cap
    // runaway queries: a single pathological scan must not pin the pool (max 10) indefinitely.
    options: '-c default_transaction_read_only=on -c statement_timeout=60000 -c idle_in_transaction_session_timeout=60000',
  });
  pool.on('error', (err) => logger.error({ err: err.message }, 'DWH pool error'));
  return pool;
}

export class DwhWrapper extends SqlWrapper {
  readonly name = 'dwh';
  readonly placeholderStyle = '$n' as const;
  readonly readOnly = true;

  isConfigured(): boolean {
    return Boolean(env.DWH_DATABASE_URL);
  }

  protected override async probe(): Promise<void> {
    await this.query('select 1');
  }

  /** Run a read-only query against the DWH and return its rows. */
  async query<T extends object = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await getDwhPool().query<T & QueryResultRow>(text, params as unknown[]);
    return result.rows;
  }

  /** Close the pool (graceful shutdown / tests). */
  async close(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
}

export const dwh = new DwhWrapper();

/** @deprecated Import { dwh } and call dwh.query — kept as a facade during migration. */
export async function dwhQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  return dwh.query<T>(text, params);
}

/** @deprecated Import { dwh } and call dwh.close — kept as a facade during migration. */
export function closeDwhPool(): Promise<void> {
  return dwh.close();
}
