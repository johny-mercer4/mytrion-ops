/**
 * Verification DB inspector (READ-ONLY) — dumps the full schema of the `credit_platform` Render
 * Postgres so we can reference it while building the Sales Mytrion verification pipeline.
 *
 * Connection: uses VERIFICATION_DATABASE_URL if set; otherwise builds it from the VERIFICATION_DB_*
 * vars in .env and reuses the johnmercer password from MYTRION_OPS_DATABASE_URL (same Render
 * instance). The password is never written to disk or printed.
 *
 * Read-only by construction: opens the session with default_transaction_read_only=on and only runs
 * catalog SELECTs. It prints SCHEMA (tables, columns, PK/FK, indexes, enums) + ESTIMATED row counts
 * (pg_class.reltuples — no full scans, no row data dumped; this is a credit platform). Flags:
 *   --counts        exact COUNT(*) per table (slower; still no row data)
 *   --table <name>  focus a single table
 *   --sample <name> print up to 5 sample rows of ONE table (opt-in; use with care)
 *
 * Run: corepack pnpm tsx scripts/inspectVerificationDb.ts
 */
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

function loadDotenv(): Map<string, string> {
  const out = new Map<string, string>();
  let text = '';
  try {
    text = readFileSync('.env', 'utf8');
  } catch {
    return out;
  }
  for (const line of text.split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] && !line.trim().startsWith('#')) out.set(m[1], m[2]!.trim());
  }
  return out;
}

function connectionString(env: Map<string, string>): { url: string; appName: string } {
  const direct = process.env.VERIFICATION_DATABASE_URL || env.get('VERIFICATION_DATABASE_URL');
  const appName = env.get('VERIFICATION_DB_APP_NAME') || 'core-api-verify';
  if (direct) return { url: direct, appName };

  const host = env.get('VERIFICATION_DB_HOST');
  const port = env.get('VERIFICATION_DB_PORT') || '5432';
  const user = env.get('VERIFICATION_DB_USER');
  const name = env.get('VERIFICATION_DB_NAME');
  if (!host || !user || !name) {
    throw new Error('Set VERIFICATION_DATABASE_URL, or VERIFICATION_DB_HOST/USER/NAME in .env');
  }
  // Reuse the johnmercer password from MYTRION_OPS_DATABASE_URL (same instance) — never printed.
  const existing = env.get('MYTRION_OPS_DATABASE_URL') || env.get('DATABASE_URL');
  if (!existing) throw new Error('No password source: set VERIFICATION_DATABASE_URL or MYTRION_OPS_DATABASE_URL');
  const pw = decodeURIComponent(new URL(existing).password);
  const url = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(pw)}@${host}:${port}/${name}`;
  return { url, appName };
}

interface Args {
  counts: boolean;
  table?: string;
  sample?: string;
}
function parseArgs(argv: string[]): Args {
  const a: Args = { counts: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--counts') a.counts = true;
    else if (argv[i] === '--table') { const v = argv[++i]; if (v) a.table = v; }
    else if (argv[i] === '--sample') { const v = argv[++i]; if (v) a.sample = v; }
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const env = loadDotenv();
  const { url, appName } = connectionString(env);
  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 8000,
    application_name: appName,
    statement_timeout: 30_000,
  });

  await client.connect();
  await client.query('SET default_transaction_read_only = on');

  const meta = await client.query<{ db: string; usr: string; v: string; size: string }>(
    `select current_database() db, current_user usr, version() v,
            pg_size_pretty(pg_database_size(current_database())) size`,
  );
  const m = meta.rows[0]!;
  console.log('='.repeat(78));
  console.log(`LIVE ✓  ${m.v.split(' on ')[0]}`);
  console.log(`database=${m.db}  user=${m.usr}  size=${m.size}`);
  console.log('='.repeat(78));

  // Tables + estimated row counts (reltuples — no full scan).
  const tables = await client.query<{ table_name: string; est_rows: number; total: string }>(
    `select c.relname as table_name,
            c.reltuples::bigint as est_rows,
            pg_size_pretty(pg_total_relation_size(c.oid)) as total
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
      order by c.relname`,
  );
  const focus = args.table ?? args.sample;
  const list = focus ? tables.rows.filter((t) => t.table_name === focus) : tables.rows;
  console.log(`\nPUBLIC TABLES (${tables.rows.length})  [est rows · size]`);
  for (const t of tables.rows) console.log(`  ${t.table_name.padEnd(38)} ~${t.est_rows.toLocaleString().padStart(12)}  ${t.total}`);

  if (args.counts) {
    console.log('\nEXACT ROW COUNTS');
    for (const t of list) {
      const r = await client.query<{ n: string }>(`select count(*)::text n from "${t.table_name}"`);
      console.log(`  ${t.table_name.padEnd(38)} ${r.rows[0]!.n.padStart(12)}`);
    }
  }

  // Per-table detail: columns, PK, FKs, indexes.
  for (const t of list) {
    const tn = t.table_name;
    console.log(`\n${'-'.repeat(78)}\nTABLE  ${tn}   (~${t.est_rows.toLocaleString()} rows, ${t.total})`);

    const cols = await client.query<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(
      `select column_name, data_type, is_nullable, column_default
         from information_schema.columns
        where table_schema='public' and table_name=$1 order by ordinal_position`,
      [tn],
    );
    console.log('  COLUMNS:');
    for (const c of cols.rows) {
      const nn = c.is_nullable === 'NO' ? ' NOT NULL' : '';
      const def = c.column_default ? ` default ${c.column_default.slice(0, 40)}` : '';
      console.log(`    ${c.column_name.padEnd(30)} ${c.data_type}${nn}${def}`);
    }

    const pk = await client.query<{ col: string }>(
      `select a.attname as col
         from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey)
        where i.indrelid = ('public.'||$1)::regclass and i.indisprimary order by a.attnum`,
      [tn],
    );
    if (pk.rows.length) console.log(`  PRIMARY KEY: (${pk.rows.map((r) => r.col).join(', ')})`);

    const fks = await client.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def
         from pg_constraint where conrelid = ('public.'||$1)::regclass and contype='f' order by conname`,
      [tn],
    );
    if (fks.rows.length) {
      console.log('  FOREIGN KEYS:');
      for (const f of fks.rows) console.log(`    ${f.def}`);
    }

    const idx = await client.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname='public' and tablename=$1 order by indexname`,
      [tn],
    );
    if (idx.rows.length) {
      console.log('  INDEXES:');
      for (const ix of idx.rows) console.log(`    ${ix.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, '$1')}`);
    }

    if (args.sample === tn) {
      const s = await client.query(`select * from "${tn}" limit 5`);
      console.log(`  SAMPLE (${s.rows.length} rows):`);
      for (const row of s.rows) console.log(`    ${JSON.stringify(row)}`);
    }
  }

  // Enums (useful for status/type reference).
  const enums = await client.query<{ enum_name: string; values: string }>(
    `select t.typname as enum_name, string_agg(e.enumlabel, ', ' order by e.enumsortorder) as values
       from pg_type t join pg_enum e on e.enumtypid=t.oid
       join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'
      group by t.typname order by t.typname`,
  );
  if (enums.rows.length) {
    console.log(`\n${'-'.repeat(78)}\nENUM TYPES (${enums.rows.length})`);
    for (const e of enums.rows) console.log(`  ${e.enum_name}: ${e.values}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error('inspect failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
