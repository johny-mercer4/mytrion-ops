/**
 * Verification DB wrapper — read-only access to the `credit_platform` Render Postgres (a separate,
 * third-party credit-decisioning DB; never migrated/written by us). Pooled, enforced read-only at
 * the session level, SSL (Render external Postgres requires TLS, self-signed → rejectUnauthorized
 * false, same as the app/DWH-over-Render pattern). Used ONLY for read-only metadata/reference
 * (the Mytrion Admin "Verification DB" schema tab); never returns row data to tools.
 * Postgres dialect: `$1` placeholders.
 */
import pg from 'pg';
import type { Pool, QueryResultRow } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { SqlWrapper } from './core/sqlBase.js';

let pool: Pool | null = null;

/** Lazily create the read-only verification pool. Throws if VERIFICATION_DATABASE_URL is unset. */
export function getVerificationPool(): Pool {
  if (pool) return pool;
  if (!env.VERIFICATION_DATABASE_URL) {
    throw new Error('[verification-db] VERIFICATION_DATABASE_URL is not configured');
  }
  pool = new pg.Pool({
    connectionString: env.VERIFICATION_DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // Render external Postgres = TLS with a self-signed chain.
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    // Enforce read-only at the session level — this wrapper must never write credit_platform. Also
    // cap runaway queries: a single pathological scan must not pin the pool (max 5) indefinitely.
    options: '-c default_transaction_read_only=on -c statement_timeout=60000 -c idle_in_transaction_session_timeout=60000',
  });
  pool.on('error', (err) => logger.error({ err: err.message }, 'verification-db pool error'));
  return pool;
}

export class VerificationDbWrapper extends SqlWrapper {
  readonly name = 'verification_db';
  readonly placeholderStyle = '$n' as const;
  readonly readOnly = true;

  isConfigured(): boolean {
    return Boolean(env.VERIFICATION_DATABASE_URL);
  }

  protected override async probe(): Promise<void> {
    await this.query('select 1');
  }

  /** Run a read-only query against the verification DB and return its rows. */
  async query<T extends object = Record<string, unknown>>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const result = await getVerificationPool().query<T & QueryResultRow>(text, params as unknown[]);
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

export const verificationDb = new VerificationDbWrapper();
