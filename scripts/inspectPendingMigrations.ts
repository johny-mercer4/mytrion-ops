/**
 * READ-ONLY: what has this database actually applied, and what is pending?
 *
 * `pnpm db:migrate` applies EVERY pending migration. Before pointing that at production you need to
 * know whether that is one migration or fifteen — the answer decides whether "migrate" and "apply
 * our change" are the same operation or very different ones. This prints that comparison and writes
 * nothing.
 *
 * Prints names and counts only. It never echoes the connection string.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Pool } from 'pg';

import { env } from '../src/config/env.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(here, '../src/db/migrations');

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(path.join(migrationsDir, 'meta/_journal.json'), 'utf8'),
) as { entries: JournalEntry[] };

const url = env.MYTRION_OPS_DATABASE_URL;
if (!url) throw new Error('MYTRION_OPS_DATABASE_URL is not set');

/** Host only — enough to prove which database was inspected, without the credentials. */
const host = new URL(url).host;

const pool = new Pool({
  connectionString: url,
  ...(/\brender\.com\b/.test(host) ? { ssl: { rejectUnauthorized: false } } : {}),
});

try {
  console.log(`database host: ${host}\n`);

  const ledgerExists = await pool.query<{ exists: boolean }>(
    `select exists (
       select 1 from information_schema.tables
       where table_schema = 'drizzle' and table_name = '__drizzle_migrations'
     ) as exists`,
  );
  if (!ledgerExists.rows[0]?.exists) {
    console.log('no drizzle ledger — this database has never been migrated.');
    process.exit(0);
  }

  const applied = await pool.query<{ created_at: string }>(
    'select created_at from drizzle.__drizzle_migrations order by created_at asc',
  );
  // Drizzle records the journal's `when` as created_at (milliseconds), which is the only field that
  // ties a ledger row back to a migration file.
  const appliedWhen = new Set(applied.rows.map((r) => String(r.created_at)));

  const pending = journal.entries.filter((e) => !appliedWhen.has(String(e.when)));

  console.log(`journal entries: ${journal.entries.length}`);
  console.log(`applied:         ${applied.rows.length}`);
  console.log(`pending:         ${pending.length}`);
  if (pending.length > 0) {
    console.log('\nPENDING (in the order `pnpm db:migrate` would apply them):');
    for (const e of pending) console.log(`  ${String(e.idx).padStart(3)}  ${e.tag}`);
  }

  const col = await pool.query<{ n: string }>(
    `select count(*)::text as n from information_schema.columns
     where table_name = 'mytrion_permission_sets' and column_name = 'override'`,
  );
  const tbl = await pool.query<{ n: string }>(
    `select count(*)::text as n from information_schema.tables
     where table_name in ('mytrion_permission_sets', 'mytrion_permission_set_assignments')`,
  );
  console.log(`\npermission-set tables present: ${tbl.rows[0]?.n ?? '0'} of 2`);
  console.log(`\`override\` column present:      ${col.rows[0]?.n === '1' ? 'yes' : 'NO'}`);
} finally {
  await pool.end();
}
