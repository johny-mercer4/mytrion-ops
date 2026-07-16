/**
 * AWS MySQL wrapper — pooled access to an external AWS RDS / Aurora MySQL database, mirroring the
 * DWH Postgres wrapper (integrations/dwh.ts). A lazily-created connection pool built from
 * AWS_MYSQL_DATABASE_URL; read-only is the default (AWS_MYSQL_READONLY) per the repo's
 * read-only-first rule. Callers that read AWS MySQL go through `awsMysqlQuery`.
 *
 * Auth: discrete fields (AWS_MYSQL_HOST/_PORT/_USER/_PASSWORD/_DATABASE, preferred — password
 * passed raw) or the connection URI (AWS_MYSQL_DATABASE_URL, mysql://user:pass@host:3306/db, whose
 * password must be percent-encoded). For IAM database auth instead, mint a short-lived token with
 * `@aws-sdk/rds-signer` (the AWS SDK v3 is already a dependency) and pass it as the password — not
 * wired here; add a token-refresh path when needed.
 *
 * NOTE: MySQL placeholders are positional `?`, NOT Postgres `$1` — queries are not portable between
 * this wrapper and `dwhQuery`.
 */
import mysql from 'mysql2/promise';
import type { Pool, PoolOptions, RowDataPacket } from 'mysql2/promise';
import type { PoolConnection } from 'mysql2';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { SqlWrapper } from './core/sqlBase.js';

let pool: Pool | null = null;

/** Discrete fields (raw password, tunnel-friendly) win over the URI; else fall back to the URI. */
function connectionConfig(): PoolOptions {
  if (env.AWS_MYSQL_HOST) {
    return {
      host: env.AWS_MYSQL_HOST,
      port: env.AWS_MYSQL_PORT,
      user: env.AWS_MYSQL_USER,
      password: env.AWS_MYSQL_PASSWORD,
      // Omit `database` when blank so the connection has no default schema (browse all).
      ...(env.AWS_MYSQL_DATABASE ? { database: env.AWS_MYSQL_DATABASE } : {}),
    };
  }
  return { uri: env.AWS_MYSQL_DATABASE_URL };
}

/** Lazily create the AWS MySQL pool. Throws if neither discrete fields nor the URI are configured. */
export function getAwsMysqlPool(): Pool {
  if (pool) return pool;
  if (!env.AWS_MYSQL_HOST && !env.AWS_MYSQL_DATABASE_URL) {
    throw new Error('[aws-mysql] set AWS_MYSQL_HOST (+ _USER/_PASSWORD/_PORT/_DATABASE) or AWS_MYSQL_DATABASE_URL');
  }
  pool = mysql.createPool({
    ...connectionConfig(),
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

export class CmpDatabaseWrapper extends SqlWrapper {
  readonly name = 'cmp_mysql';
  readonly placeholderStyle = '?' as const;

  get readOnly(): boolean {
    return env.AWS_MYSQL_READONLY;
  }

  isConfigured(): boolean {
    return Boolean(env.AWS_MYSQL_HOST || env.AWS_MYSQL_DATABASE_URL);
  }

  protected override async probe(): Promise<void> {
    await this.query('SELECT 1');
  }

  /** Run a query and return its rows. Params use positional `?` placeholders (NOT `$1`). */
  async query<T extends object = Record<string, unknown>>(
    sql: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> {
    const [rows] = await getAwsMysqlPool().query<(T & RowDataPacket)[]>(sql, params as unknown[]);
    return rows;
  }

  /** Close the pool (graceful shutdown / tests). */
  async close(): Promise<void> {
    if (pool) {
      await pool.end();
      pool = null;
    }
  }
}

export const cmpDb = new CmpDatabaseWrapper();

/** @deprecated Import { cmpDb } and call cmpDb.query — kept as a facade during migration. */
export async function awsMysqlQuery<T extends RowDataPacket = RowDataPacket>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  return cmpDb.query<T>(sql, params);
}

/** @deprecated Import { cmpDb } and call cmpDb.close — kept as a facade during migration. */
export function closeAwsMysqlPool(): Promise<void> {
  return cmpDb.close();
}
