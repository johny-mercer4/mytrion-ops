/**
 * Data Warehouse (DWH) metadata analyzer.
 *
 * Introspects DWH_DATABASE_URL (read Postgres) and emits schemas → tables → columns,
 * primary keys, foreign keys, indexes, and activity/deprecation status.
 *
 * Run: `pnpm meta:dwh` (alias for full DWH catalog export to output/dwh.{json,md})
 */
import 'dotenv/config';
import { connectPg, fetchPgCatalog, renderCatalogMarkdown } from './lib/pgCatalog.js';
import { nowIso, runAnalyzer, writeMetadata } from './lib/output.js';

async function main() {
  const generatedAt = nowIso();
  const { client } = await connectPg({ target: 'dwh' });
  console.log('[dwh] connected; introspecting information_schema + pg_stat');

  try {
    const catalog = await fetchPgCatalog(client, 'dwh', generatedAt);
    const json = {
      service: 'dwh',
      ...catalog,
      summary: {
        activeTables: catalog.tables.filter((t) => t.activityStatus === 'active').length,
        inactiveTables: catalog.tables.filter((t) => t.activityStatus === 'inactive').length,
        unknownTables: catalog.tables.filter((t) => t.activityStatus === 'unknown').length,
        deprecatedTables: catalog.tables.filter((t) => t.deprecated).length,
      },
    };

    console.log(
      `[dwh] ${catalog.schemaCount} schemas, ${catalog.tableCount} tables/views, ${catalog.foreignKeyCount} FKs, ${catalog.indexCount} indexes — ` +
        `${json.summary.activeTables} active, ${json.summary.deprecatedTables} deprecated`,
    );

    const md = renderCatalogMarkdown(catalog).replace(
      '# Postgres metadata (dwh)',
      '# Data Warehouse metadata',
    );

    return await writeMetadata('dwh', json, md);
  } finally {
    await client.end();
  }
}

runAnalyzer('dwh', main);
