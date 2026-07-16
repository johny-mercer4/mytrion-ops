/**
 * Postgres schema inspector — list schemas/tables, fetch column metadata + activity
 * for a single table, or run ad-hoc read-only SQL.
 *
 *   pnpm pg:inspect                                    # list schemas + table counts
 *   pnpm pg:inspect -- --target ops                    # app DB instead of DWH
 *   pnpm pg:inspect -- --schema octane                 # list tables in a schema
 *   pnpm pg:inspect -- --schema octane --like %deal%   # filter tables
 *   pnpm pg:inspect -- --schema octane --table intm_zoho_deals
 *   pnpm pg:inspect -- --table intm_zoho_deals --schema octane --sample 3
 *   pnpm pg:inspect -- --query "select ... limit 10"
 *
 * Requires DWH_DATABASE_URL (default) or MYTRION_OPS_DATABASE_URL (--target ops).
 */
import 'dotenv/config';
import { connectPg, fetchPgCatalog, findTables, type PgTarget } from '../metadataScripts/lib/pgCatalog.js';

function opt(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function parseTarget(): PgTarget {
  const raw = opt('target') ?? 'dwh';
  if (raw === 'dwh' || raw === 'ops') return raw;
  throw new Error(`invalid --target "${raw}" — use "dwh" or "ops"`);
}

/** Guard identifiers we interpolate (schema/table names can't be bind params). */
function ident(raw: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) throw new Error(`unsafe identifier: ${raw}`);
  return `"${raw}"`;
}

async function main(): Promise<void> {
  const target = parseTarget();
  const schema = opt('schema');
  const table = opt('table');
  const like = opt('like');
  const sample = Number(opt('sample') ?? 0);
  const query = opt('query');

  const { client } = await connectPg({ target });

  try {
    if (query) {
      const { rows } = await client.query(query);
      console.log(JSON.stringify(rows, null, 1));
      console.log(`(${rows.length} rows)`);
      return;
    }

    if (!schema && !table) {
      const { rows } = await client.query<{ schema: string; tables: number }>(
        `SELECT table_schema AS schema, count(*)::int AS tables
           FROM information_schema.tables
          WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
          GROUP BY table_schema ORDER BY table_schema`,
      );
      console.log(`schemas (${target}):`);
      for (const r of rows) console.log(`  ${r.schema}  (${r.tables} tables)`);
      return;
    }

    if (table && !schema) {
      const catalog = await fetchPgCatalog(client, target, new Date().toISOString());
      const matches = findTables(catalog, table);
      if (matches.length === 0) {
        console.log(`no table matching "${table}" (${target})`);
        return;
      }
      if (matches.length > 1) {
        console.log(`ambiguous "${table}" — pass --schema:`);
        for (const m of matches) console.log(`  ${m.qualifiedName}`);
        return;
      }
      printTableDetail(matches[0]!);

      if (sample > 0) {
        const t = matches[0]!;
        const { rows } = await client.query(
          `SELECT * FROM ${ident(t.schema)}.${ident(t.name)} LIMIT ${Math.min(sample, 10)}`,
        );
        console.log(`sample (${rows.length}):`);
        for (const row of rows) console.log(JSON.stringify(row, null, 2).slice(0, 2000));
      }
      return;
    }

    if (!table) {
      const { rows } = await client.query<{ table_name: string; table_type: string }>(
        `SELECT table_name, table_type
           FROM information_schema.tables
          WHERE table_schema = $1 ${like ? 'AND table_name ILIKE $2' : ''}
          ORDER BY table_name`,
        like ? [schema, like] : [schema],
      );
      console.log(`tables in ${schema}${like ? ` matching '${like}'` : ''}: ${rows.length}`);
      for (const r of rows) console.log(`  ${r.table_name}  [${r.table_type}]`);
      return;
    }

    const catalog = await fetchPgCatalog(client, target, new Date().toISOString());
    const matches = findTables(catalog, table, schema);
    if (matches.length === 0) {
      console.log(`no such table: ${schema}.${table}`);
      return;
    }

    printTableDetail(matches[0]!);

    if (sample > 0) {
      const { rows } = await client.query(
        `SELECT * FROM ${ident(schema!)}.${ident(table)} LIMIT ${Math.min(sample, 10)}`,
      );
      console.log(`sample (${rows.length}):`);
      for (const row of rows) console.log(JSON.stringify(row, null, 2).slice(0, 2000));
    }
  } finally {
    await client.end();
  }
}

function printTableDetail(t: ReturnType<typeof findTables>[number]): void {
  const status = t.deprecated ? 'deprecated' : t.activityStatus;
  console.log(`${t.qualifiedName} — ${t.type}`);
  console.log(`  status: ${status} · actively updated: ${t.activelyUpdated ? 'yes' : 'no'}`);
  console.log(`  activity: ${t.activityReason}`);
  if (t.comment) console.log(`  comment: ${t.comment}`);
  console.log(`  columns (${t.columns.length}):`);
  for (const c of t.columns) {
    const flags = [c.primaryKey ? 'PK' : null, c.deprecated ? 'deprecated' : null, c.nullable ? null : 'NOT NULL']
      .filter(Boolean)
      .join(', ');
    console.log(`    ${c.name.padEnd(36)} ${c.dataType} / ${c.udtName}${flags ? `  [${flags}]` : ''}`);
  }
  console.log(`  rows (estimate): ${t.activity.rowEstimate}`);
  console.log(`  writes: ins=${t.activity.inserts} upd=${t.activity.updates} del=${t.activity.deletes}`);
}

main().catch((err) => {
  console.error('[pg:inspect] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
