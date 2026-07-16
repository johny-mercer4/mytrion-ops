/**
 * Postgres catalog analyzer — all schemas, tables, columns (with data types), and
 * whether each table is actively updated or marked deprecated.
 *
 * Usage:
 *   pnpm meta:pg-catalog                  # DWH (DWH_DATABASE_URL)
 *   pnpm meta:pg-catalog -- --target ops  # app DB (MYTRION_OPS_DATABASE_URL)
 *
 * Output: metadataScripts/output/pg-catalog-{target}.{json,md}
 */
import 'dotenv/config';
import { connectPg, fetchPgCatalog, renderCatalogMarkdown, type PgTarget } from './lib/pgCatalog.js';
import { nowIso, runAnalyzer, writeMetadata } from './lib/output.js';

function parseTarget(): PgTarget {
  const idx = process.argv.indexOf('--target');
  const raw = idx >= 0 ? process.argv[idx + 1] : 'dwh';
  if (raw === 'dwh' || raw === 'ops') return raw;
  throw new Error(`invalid --target "${raw}" — use "dwh" or "ops"`);
}

async function main() {
  const target = parseTarget();
  const generatedAt = nowIso();
  const { client } = await connectPg({ target });
  console.log(`[pg-catalog] connected (${target}); introspecting information_schema + pg_stat`);

  try {
    const catalog = await fetchPgCatalog(client, target, generatedAt);
    const json = {
      ...catalog,
      summary: {
        activeTables: catalog.tables.filter((t) => t.activityStatus === 'active').length,
        inactiveTables: catalog.tables.filter((t) => t.activityStatus === 'inactive').length,
        unknownTables: catalog.tables.filter((t) => t.activityStatus === 'unknown').length,
        deprecatedTables: catalog.tables.filter((t) => t.deprecated).length,
      },
    };

    console.log(
      `[pg-catalog] ${catalog.schemaCount} schemas, ${catalog.tableCount} tables/views — ` +
        `${json.summary.activeTables} active, ${json.summary.inactiveTables} inactive, ` +
        `${json.summary.deprecatedTables} deprecated`,
    );

    return await writeMetadata(`pg-catalog-${target}`, json, renderCatalogMarkdown(catalog));
  } finally {
    await client.end();
  }
}

runAnalyzer('pg-catalog', main);
