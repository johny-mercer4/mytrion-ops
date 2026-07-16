/**
 * AWS MySQL schema inspector — list databases, tables, columns, row counts and sample rows from the
 * external AWS RDS/Aurora MySQL (read-only; uses the same pool as the runtime tools).
 *
 *   pnpm mysql:inspect                                       # list databases + table counts
 *   pnpm mysql:inspect --db tss_db                           # list tables in a database
 *   pnpm mysql:inspect --db tss_db --like %deal%             # filter tables by LIKE
 *   pnpm mysql:inspect --db tss_db --table deals             # columns + row count
 *   pnpm mysql:inspect --db tss_db --table deals --sample 3  # + sample rows
 *   pnpm mysql:inspect --query "select ... limit 10"         # ad-hoc read-only SQL
 *
 * Requires AWS_MYSQL_DATABASE_URL and a running SSH tunnel (the app dials 127.0.0.1:3307, it does
 * NOT open the tunnel itself). Read-only by default (AWS_MYSQL_READONLY).
 */
import 'dotenv/config';
import { awsMysqlQuery, closeAwsMysqlPool } from '../src/integrations/awsMysql.js';

function opt(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/** Guard identifiers we interpolate (db/table names can't be bind params). MySQL quotes with backticks. */
function ident(raw: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(raw)) throw new Error(`unsafe identifier: ${raw}`);
  return `\`${raw}\``;
}

const SYS_SCHEMAS = "('mysql','information_schema','performance_schema','sys')";

async function main(): Promise<void> {
  const db = opt('db');
  const table = opt('table');
  const like = opt('like');
  const sample = Number(opt('sample') ?? 0);
  const query = opt('query');

  if (query) {
    // Ad-hoc SQL — the session is read-only (AWS_MYSQL_READONLY), so writes fail.
    const rows = await awsMysqlQuery(query);
    console.log(JSON.stringify(rows, null, 1));
    console.log(`(${rows.length} rows)`);
    return;
  }

  if (!db) {
    const rows = await awsMysqlQuery(
      `select table_schema as schema_name, count(*) as tables
         from information_schema.tables
        where table_schema not in ${SYS_SCHEMAS}
        group by table_schema order by table_schema`,
    );
    console.log('databases:');
    for (const r of rows) console.log(`  ${r.schema_name}  (${r.tables} tables)`);
    return;
  }

  if (!table) {
    const rows = await awsMysqlQuery(
      `select table_name as table_name, table_type as table_type
         from information_schema.tables
        where table_schema = ? ${like ? 'and table_name like ?' : ''}
        order by table_name`,
      like ? [db, like] : [db],
    );
    console.log(`tables in ${db}${like ? ` matching '${like}'` : ''}: ${rows.length}`);
    for (const r of rows) console.log(`  ${r.table_name}  [${r.table_type}]`);
    return;
  }

  const cols = await awsMysqlQuery(
    `select column_name as column_name, column_type as column_type, is_nullable as is_nullable
       from information_schema.columns
      where table_schema = ? and table_name = ?
      order by ordinal_position`,
    [db, table],
  );
  if (cols.length === 0) {
    console.log(`no such table: ${db}.${table}`);
    return;
  }
  console.log(`${db}.${table} — ${cols.length} columns:`);
  for (const c of cols) {
    console.log(`  ${String(c.column_name).padEnd(36)} ${c.column_type}${c.is_nullable === 'YES' ? '' : '  NOT NULL'}`);
  }

  const count = await awsMysqlQuery(
    `select cast(count(*) as char) as n from ${ident(db)}.${ident(table)}`,
  );
  console.log(`rows: ${count[0]?.n ?? '?'}`);

  if (sample > 0) {
    const rows = await awsMysqlQuery(
      `select * from ${ident(db)}.${ident(table)} limit ${Math.min(sample, 10)}`,
    );
    console.log(`sample (${rows.length}):`);
    for (const row of rows) console.log(JSON.stringify(row, null, 2).slice(0, 2000));
  }
}

main()
  .then(async () => {
    await closeAwsMysqlPool();
    process.exit(0);
  })
  .catch(async (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[mysql:inspect] failed:', msg);
    if (/ECONNREFUSED|connect ETIMEDOUT/.test(msg)) {
      console.error(
        '\nHint: nothing is listening on 127.0.0.1:3307. Start the SSH tunnel first:\n' +
          '  ssh -i <keyfile> -N -L 3307:tss-db-prod.cwz2cieki0p2.us-east-1.rds.amazonaws.com:3306 dbtunnel@ec2-35-170-208-74.compute-1.amazonaws.com',
      );
    }
    await closeAwsMysqlPool();
    process.exit(1);
  });
