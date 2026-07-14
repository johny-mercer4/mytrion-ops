/**
 * Postgres table metadata fetcher — given a table name, return full column catalog
 * (API names, data types), activity status, and deprecation hints.
 *
 * Usage:
 *   pnpm meta:pg-table -- intm_zoho_deals
 *   pnpm meta:pg-table -- users --target ops
 *   pnpm meta:pg-table -- intm_zoho_deals --schema octane --write
 *   pnpm meta:pg-table -- deals --json
 *
 * Flags:
 *   --target dwh|ops   connection (default: dwh)
 *   --schema NAME      disambiguate when the table name exists in multiple schemas
 *   --json             print JSON only (no banner)
 *   --write            also write metadataScripts/output/pg-table-{target}-{schema}-{table}.{json,md}
 */
import 'dotenv/config';
import {
  connectPg,
  fetchPgCatalog,
  findTables,
  renderTableMarkdown,
  type PgTarget,
  type TableMeta,
} from './lib/pgCatalog.js';
import { nowIso, writeMetadata } from './lib/output.js';

function opt(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

function parseTarget(): PgTarget {
  const raw = opt('target') ?? 'dwh';
  if (raw === 'dwh' || raw === 'ops') return raw;
  throw new Error(`invalid --target "${raw}" — use "dwh" or "ops"`);
}

function usage(exitCode = 1): never {
  console.error(`Usage: pnpm meta:pg-table -- <tableName> [--target dwh|ops] [--schema NAME] [--json] [--write]

Examples:
  pnpm meta:pg-table -- intm_zoho_deals
  pnpm meta:pg-table -- users --target ops
  pnpm meta:pg-table -- intm_zoho_deals --schema octane --write
  pnpm meta:pg-table -- deals --json`);
  process.exit(exitCode);
}

function tablePayload(table: TableMeta, meta: { target: PgTarget; generatedAt: string; connectionLabel: string }) {
  return {
    target: meta.target,
    generatedAt: meta.generatedAt,
    connectionLabel: meta.connectionLabel,
    table: {
      schema: table.schema,
      name: table.name,
      qualifiedName: table.qualifiedName,
      type: table.type,
      comment: table.comment,
      deprecated: table.deprecated,
      activelyUpdated: table.activelyUpdated,
      activityStatus: table.activityStatus,
      activityReason: table.activityReason,
      activity: table.activity,
      columns: table.columns.map((c) => ({
        apiName: c.name,
        dataType: c.dataType,
        udtName: c.udtName,
        nullable: c.nullable,
        default: c.default,
        primaryKey: c.primaryKey,
        ordinalPosition: c.ordinalPosition,
        comment: c.comment,
        deprecated: c.deprecated,
      })),
      foreignKeys: table.foreignKeys,
      indexes: table.indexes,
    },
  };
}

function parseArgs(argv: string[]): {
  tableName: string;
  jsonOnly: boolean;
  write: boolean;
} {
  const positional: string[] = [];
  let jsonOnly = false;
  let write = false;
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg === '--json') jsonOnly = true;
    else if (arg === '--write') write = true;
    else if (arg === '--help' || arg === '-h') usage(0);
    else if (arg.startsWith('-')) continue;
    else positional.push(arg);
  }
  if (positional.length < 1) usage(1);
  return { tableName: positional[0]!, jsonOnly, write };
}

async function main(): Promise<void> {
  const { tableName, jsonOnly, write } = parseArgs(process.argv.slice(2));

  const target = parseTarget();
  const schema = opt('schema');
  const generatedAt = nowIso();

  const { client } = await connectPg({ target });
  try {
    const catalog = await fetchPgCatalog(client, target, generatedAt);
    const matches = findTables(catalog, tableName, schema);

    if (matches.length === 0) {
      console.error(`[pg-table] no table matching "${tableName}"${schema ? ` in schema "${schema}"` : ''} (${target})`);
      process.exit(1);
    }

    if (matches.length > 1) {
      console.error(`[pg-table] ambiguous table name "${tableName}" — found in multiple schemas:`);
      for (const m of matches) console.error(`  ${m.qualifiedName}`);
      console.error('Pass --schema <name> to disambiguate.');
      process.exit(1);
    }

    const table = matches[0]!;
    const payload = tablePayload(table, catalog);

    if (jsonOnly) {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(`[pg-table] ${table.qualifiedName} (${target})`);
      console.log(`  type: ${table.type}`);
      console.log(`  status: ${table.deprecated ? 'deprecated' : table.activityStatus}`);
      console.log(`  actively updated: ${table.activelyUpdated ? 'yes' : 'no'}`);
      console.log(`  activity: ${table.activityReason}`);
      console.log(`  columns: ${table.columns.length}`);
      for (const col of table.columns) {
        const flags = [col.primaryKey ? 'PK' : null, col.deprecated ? 'deprecated' : null].filter(Boolean).join(', ');
        console.log(
          `    ${String(col.ordinalPosition).padStart(2)}. ${col.name.padEnd(32)} ${col.dataType}${flags ? `  [${flags}]` : ''}`,
        );
      }
    }

    if (write) {
      const slug = `${target}-${table.schema}-${table.name}`.replace(/[^a-zA-Z0-9._-]+/g, '_');
      const { jsonPath, mdPath } = await writeMetadata(`pg-table-${slug}`, payload, renderTableMarkdown(table, catalog));
      if (!jsonOnly) console.log(`[pg-table] wrote:\n  ${jsonPath}\n  ${mdPath}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error('[pg-table] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
