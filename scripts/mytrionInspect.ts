/**
 * Full Mytrion PostgreSQL metadata inspector.
 *
 * Reads information_schema + pg_catalog/pg_stat only. It never selects application rows.
 *
 *   pnpm mytrion:inspect
 *   pnpm mytrion:inspect -- --search kpi
 *   pnpm mytrion:inspect -- --table kpi_workers
 *   pnpm mytrion:inspect -- --schema public --table users --json
 *
 * The unfiltered command writes metadataScripts/output/mytrion-database.{json,md}. Filtered
 * commands print a focused inspection to stdout; add --json for machine-readable output.
 */
import 'dotenv/config';
import {
  connectPg,
  fetchPgCatalog,
  findTables,
  renderCatalogMarkdown,
  renderTableMarkdown,
  type PgCatalog,
  type TableMeta,
} from '../metadataScripts/lib/pgCatalog.js';
import { nowIso, writeMetadata } from '../metadataScripts/lib/output.js';

interface Args {
  table?: string;
  schema?: string;
  search?: string;
  json: boolean;
}

function option(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function usage(): never {
  console.log(`Usage: pnpm mytrion:inspect -- [--search TEXT] [--table NAME] [--schema NAME] [--json]

No filters: write the full JSON + Markdown catalog.
--search:    find table names, column/API names, SQL/UDT types, and comments.
--table:     show one table's full columns, keys, relationships, indexes, and activity.
--schema:    narrow --table when the same name exists in multiple schemas.
--json:      print the selected metadata as JSON instead of a human-readable report.`);
  process.exit(0);
}

function parseArgs(argv: string[]): Args {
  if (argv.includes('--help') || argv.includes('-h')) usage();
  const table = option(argv, 'table');
  const schema = option(argv, 'schema');
  const search = option(argv, 'search');
  return {
    ...(table ? { table } : {}),
    ...(schema ? { schema } : {}),
    ...(search ? { search } : {}),
    json: argv.includes('--json'),
  };
}

function tablePayload(table: TableMeta): object {
  return {
    ...table,
    columns: table.columns.map((column) => ({
      ...column,
      apiName: column.name,
    })),
  };
}

function catalogPayload(catalog: PgCatalog, tables = catalog.tables): object {
  return {
    ...catalog,
    tableCount: tables.length,
    tables: tables.map(tablePayload),
    note: 'For PostgreSQL, column name is the SQL/API name. Activity counters are cumulative since statistics reset.',
  };
}

function matchesSearch(table: TableMeta, raw: string): boolean {
  const query = raw.trim().toLowerCase();
  if (!query) return true;
  const tableText = [
    table.qualifiedName,
    table.type,
    table.comment ?? '',
    table.activityStatus,
    table.activityReason,
  ]
    .join(' ')
    .toLowerCase();
  if (tableText.includes(query)) return true;
  return table.columns.some((column) =>
    [
      column.name,
      column.dataType,
      column.udtName,
      column.comment ?? '',
      column.default ?? '',
    ]
      .join(' ')
      .toLowerCase()
      .includes(query),
  );
}

function printSearch(tables: TableMeta[]): void {
  console.log(`Mytrion metadata matches: ${tables.length} table(s)`);
  for (const table of tables) {
    console.log(`\n${table.qualifiedName} [${table.type}] — ${table.activityReason}`);
    for (const column of table.columns) {
      console.log(
        `  ${String(column.ordinalPosition).padStart(2)}. ${column.name.padEnd(36)} ` +
          `${column.dataType} / ${column.udtName}`,
      );
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = nowIso();
  const { client } = await connectPg({ target: 'ops' });
  try {
    const catalog = await fetchPgCatalog(client, 'ops', generatedAt);

    if (args.table) {
      const matches = findTables(catalog, args.table, args.schema);
      if (matches.length === 0) {
        throw new Error(`no table matching "${args.table}"${args.schema ? ` in ${args.schema}` : ''}`);
      }
      if (matches.length > 1) {
        throw new Error(
          `ambiguous table "${args.table}"; pass --schema (${matches.map((table) => table.schema).join(', ')})`,
        );
      }
      const table = matches[0]!;
      console.log(args.json ? JSON.stringify(tablePayload(table), null, 2) : renderTableMarkdown(table, catalog));
      return;
    }

    if (args.search) {
      const tables = catalog.tables.filter((table) => matchesSearch(table, args.search!));
      console.log(args.json ? JSON.stringify(catalogPayload(catalog, tables), null, 2) : '');
      if (!args.json) printSearch(tables);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(catalogPayload(catalog), null, 2));
      return;
    }

    const paths = await writeMetadata(
      'mytrion-database',
      catalogPayload(catalog),
      renderCatalogMarkdown(catalog).replace('# Postgres metadata (ops)', '# Mytrion Database metadata'),
    );
    console.log(
      `[mytrion:inspect] ${catalog.schemaCount} schemas, ${catalog.tableCount} tables/views, ` +
        `${catalog.tables.reduce((sum, table) => sum + table.columns.length, 0)} columns`,
    );
    console.log(`[mytrion:inspect] wrote:\n  ${paths.jsonPath}\n  ${paths.mdPath}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('[mytrion:inspect] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
