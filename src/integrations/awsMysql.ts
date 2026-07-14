/**
 * AWS MySQL wrapper — pooled access to an external AWS RDS / Aurora MySQL database, mirroring the
 * DWH Postgres wrapper (integrations/dwh.ts). A lazily-created connection pool built from
 * AWS_MYSQL_DATABASE_URL; read-only is the default (AWS_MYSQL_READONLY) per the repo's
 * read-only-first rule. Callers that read AWS MySQL go through `awsMysqlQuery`.
 *
 * Auth: username/password in the connection URI (mysql://user:pass@host:3306/db). For IAM database
 * auth instead, mint a short-lived token with `@aws-sdk/rds-signer` (the AWS SDK v3 is already a
 * dependency) and pass it as the password — not wired here; add a token-refresh path when needed.
 *
 * NOTE: MySQL placeholders are positional `?`, NOT Postgres `$1` — queries are not portable between
 * this wrapper and `dwhQuery`.
 */
import mysql from 'mysql2/promise';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { PoolConnection } from 'mysql2';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: Pool | null = null;

/** Lazily create the AWS MySQL pool. Throws if AWS_MYSQL_DATABASE_URL is unconfigured. */
export function getAwsMysqlPool(): Pool {
  if (pool) return pool;
  if (!env.AWS_MYSQL_DATABASE_URL) {
    throw new Error('[aws-mysql] AWS_MYSQL_DATABASE_URL is not configured');
  }
  pool = mysql.createPool({
    uri: env.AWS_MYSQL_DATABASE_URL,
    // RDS/Aurora present publicly-trusted certs (Amazon Root CA, in Node's trust store) so verify
    // by default; AWS_MYSQL_SSL='0' drops to plaintext for a non-RDS / tunnelled target. Spread so
    // the `ssl` key is absent (not undefined) when off — exactOptionalPropertyTypes.
    ...(env.AWS_MYSQL_SSL ? { ssl: { rejectUnauthorized: true } } : {}),
    connectionLimit: 10,
    idleTimeout: 30_000,
    connectTimeout: 15_000,
    waitForConnections: true,
  });
  // Pool events live on the base (callback) pool — the promise Pool re-types them narrowly.
  const base = pool.pool;
  // Read-only default (repo rule 7): pin every physical connection to a read-only session so this
  // wrapper can't write even if a query tries to. A read-only MySQL user is the real guarantee;
  // this is defence in depth. Flip AWS_MYSQL_READONLY='0' when writes are intended.
  if (env.AWS_MYSQL_READONLY) {
    base.on('connection', (conn: PoolConnection) => {
      conn.query('SET SESSION TRANSACTION READ ONLY', (err: NodeJS.ErrnoException | null) => {
        if (err) logger.warn({ err: err.message }, 'AWS MySQL: failed to set read-only session');
      });
    });
  }
  base.on('error', (err: Error) => logger.error({ err: err.message }, 'AWS MySQL pool error'));
  return pool;
}

/** Run a query against AWS MySQL and return its rows. Params use positional `?` placeholders. */
export async function awsMysqlQuery<T extends RowDataPacket = RowDataPacket>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const [rows] = await getAwsMysqlPool().query<T[]>(sql, params as unknown[]);
  return rows;
}

/** Close the pool (graceful shutdown / tests). */
export async function closeAwsMysqlPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
