/**
 * DWH schema inspector — fetch metadata, columns, and sample rows from the Data Warehouse
 * (read-only; uses the same enforced-read-only pool as the runtime tools).
 *
 *   pnpm dwh:inspect                                  # list schemas + table counts
 *   pnpm dwh:inspect --schema octane                  # list tables in a schema
 *   pnpm dwh:inspect --schema octane --like %deal%    # filter tables by ILIKE pattern
 *   pnpm dwh:inspect --schema octane --table intm_zoho_deals            # columns + row count
 *   pnpm dwh:inspect --schema octane --table intm_zoho_deals --sample 3 # + sample rows
 *   pnpm dwh:inspect --query "select ... limit 10"                      # ad-hoc read-only SQL
 *
 * Requires DWH_DATABASE_URL. Never writes (session is default_transaction_read_only=on).
 */
import 'dotenv/config';
import { closeDwhPool, dwhQuery } from '../src/integrations/dwh.js';

function opt(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Guard identifiers we interpolate (schema/table names can't be bind params). */
function ident(raw: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) throw new Error(`unsafe identifier: ${raw}`);
  return `"${raw}"`;
}

async function main(): Promise<void> {
  const schema = opt('schema');
  const table = opt('table');
  const like = opt('like');
  const sample = Number(opt('sample') ?? 0);
  const query = opt('query');

  if (query) {
    // Ad-hoc SQL — the pool session is default_transaction_read_only=on, so writes fail.
    const rows = await dwhQuery(query);
    console.log(JSON.stringify(rows, null, 1));
    console.log(`(${rows.length} rows)`);
    return;
  }

  if (!schema) {
    const rows = await dwhQuery<{ schema: string; tables: number }>(
      `select table_schema as schema, count(*)::int as tables
         from information_schema.tables
        where table_schema not in ('pg_catalog', 'information_schema')
        group by table_schema order by table_schema`,
    );
    console.log('schemas:');
    for (const r of rows) console.log(`  ${r.schema}  (${r.tables} tables)`);
    return;
  }

  if (!table) {
    const rows = await dwhQuery<{ table_name: string; table_type: string }>(
      `select table_name, table_type
         from information_schema.tables
        where table_schema = $1 ${like ? 'and table_name ilike $2' : ''}
        order by table_name`,
      like ? [schema, like] : [schema],
    );
    console.log(`tables in ${schema}${like ? ` matching '${like}'` : ''}: ${rows.length}`);
    for (const r of rows) console.log(`  ${r.table_name}  [${r.table_type}]`);
    return;
  }

  const cols = await dwhQuery<{ column_name: string; data_type: string; is_nullable: string }>(
    `select column_name, data_type, is_nullable
       from information_schema.columns
      where table_schema = $1 and table_name = $2
      order by ordinal_position`,
    [schema, table],
  );
  if (cols.length === 0) {
    console.log(`no such table: ${schema}.${table}`);
    return;
  }
  console.log(`${schema}.${table} — ${cols.length} columns:`);
  for (const c of cols) {
    console.log(`  ${c.column_name.padEnd(36)} ${c.data_type}${c.is_nullable === 'YES' ? '' : '  NOT NULL'}`);
  }

  const count = await dwhQuery<{ n: string }>(
    `select count(*)::text as n from ${ident(schema)}.${ident(table)}`,
  );
  console.log(`rows: ${count[0]?.n ?? '?'}`);

  if (sample > 0) {
    const rows = await dwhQuery(
      `select * from ${ident(schema)}.${ident(table)} limit ${Math.min(sample, 10)}`,
    );
    console.log(`sample (${rows.length}):`);
    for (const row of rows) console.log(JSON.stringify(row, null, 2).slice(0, 2000));
  }
}

main()
  .then(async () => {
    await closeDwhPool();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('[dwh:inspect] failed:', err instanceof Error ? err.message : err);
    await closeDwhPool();
    process.exit(1);
  });
