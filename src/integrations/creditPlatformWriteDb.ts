/**
 * Credit-platform WRITE pool — the only place Mytrion writes to the `credit_platform` Postgres.
 * Opens the SAME VERIFICATION_DATABASE_URL as the read pool (verificationDb.ts, `johnmercer`
 * credential, Render TLS) but a WRITABLE session (no `default_transaction_read_only`), gated by the
 * VERIFICATION_WRITE_ENABLED kill switch. Its writes are confined to the two INSERT-only
 * inbox tables (`kxd.sales_agent_updates`, `kxd.sales_agent_files`) a flag-gated credit-platform
 * consumer drains — Mytrion never mutates live case rows directly. All INSERTs go through the module
 * functions below (never inline SQL in a route). Postgres dialect: `$1` placeholders.
 */
import pg from 'pg';
import type { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';

let pool: Pool | null = null;

/** True when write-back is enabled (VERIFICATION_WRITE_ENABLED) and the DB URL is set. */
export function isWriteConfigured(): boolean {
  return env.VERIFICATION_WRITE_ENABLED && Boolean(env.VERIFICATION_DATABASE_URL);
}

/** Lazily create the writable pool over VERIFICATION_DATABASE_URL. Throws if write-back is disabled. */
function getWritePool(): Pool {
  if (pool) return pool;
  if (!isWriteConfigured()) {
    throw new Error('[credit-platform-write] write-back disabled — set VERIFICATION_WRITE_ENABLED=1 and VERIFICATION_DATABASE_URL');
  }
  pool = new pg.Pool({
    connectionString: env.VERIFICATION_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    options: '-c statement_timeout=30000 -c idle_in_transaction_session_timeout=30000',
  });
  pool.on('error', (err) => logger.error({ err: err.message }, 'credit-platform-write pool error'));
  return pool;
}

/**
 * Queue an applicant-field edit for the credit-platform consumer. INSERT-only; the consumer applies
 * it through the same encrypted-profile + loans-sync path the analyst's Decision Desk edit uses.
 * `changes` = { field: value } over the known applicant fields (validated in the route).
 */
export async function insertApplicantUpdate(input: {
  requestId: string;
  agent: string;
  changes: Record<string, string>;
}): Promise<{ id: number }> {
  const result = await getWritePool().query<{ id: number }>(
    `INSERT INTO kxd.sales_agent_updates (request_id, agent, changes)
     VALUES ($1, $2, $3::jsonb)
     RETURNING id`,
    [input.requestId, input.agent, JSON.stringify(input.changes)],
  );
  const id = result.rows[0]?.id;
  if (id == null) throw new Error('[credit-platform-write] applicant update insert returned no id');
  return { id };
}

/**
 * Queue bank-statement uploads for the credit-platform consumer, which ATTACHES them to the case
 * (scope 'sales_bank_statement') — it never triggers the Plaid LLM parse (the analyst runs that
 * manually in the desk). One row per file, all sharing a batch_id. `content` is a Node Buffer → bytea.
 */
export async function insertBankStatementFiles(input: {
  requestId: string;
  agent: string;
  batchId: string;
  files: Array<{ fileName: string; contentType: string; content: Buffer }>;
}): Promise<{ ids: number[] }> {
  const client = await getWritePool().connect();
  try {
    const ids: number[] = [];
    for (const file of input.files) {
      const result = await client.query<{ id: number }>(
        `INSERT INTO kxd.sales_agent_files
           (request_id, agent, batch_id, file_name, content_type, byte_size, content)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          input.requestId,
          input.agent,
          input.batchId,
          file.fileName,
          file.contentType,
          file.content.length,
          file.content,
        ],
      );
      const id = result.rows[0]?.id;
      if (id == null) throw new Error('[credit-platform-write] bank-statement insert returned no id');
      ids.push(id);
    }
    return { ids };
  } finally {
    client.release();
  }
}

/** How many files this portal has queued for a request (for the "docs uploaded from here" count). */
export async function countQueuedFiles(requestId: string): Promise<number> {
  const result = await getWritePool().query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM kxd.sales_agent_files WHERE request_id = $1`,
    [requestId],
  );
  return Number(result.rows[0]?.n ?? 0);
}

/** Close the pool (graceful shutdown / tests). */
export async function closeWritePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
