/**
 * Data Warehouse (DWH) metadata analyzer.
 *
 * Introspects a separate read Postgres (DWH_DATABASE_URL) via information_schema so DWH
 * tools target real schemas/tables/columns. Emits schemas → tables → columns plus primary
 * keys. Read-only: only SELECTs against catalog views. Run: `pnpm meta:dwh`.
 */
import 'dotenv/config';
import pg from 'pg';
import { env } from '../src/config/env.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  ordinal_position: number;
}

interface TableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
}

interface PkRow {
  table_schema: string;
  table_name: string;
  column_name: string;
}

interface ColumnMeta {
  name: string;
  dataType: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
}

interface TableMeta {
  schema: string;
  name: string;
  type: string;
  columns: ColumnMeta[];
}

const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'];

async function main(): Promise<WrittenPaths> {
  if (!env.DWH_DATABASE_URL) {
    throw new Error('[dwh] DWH_DATABASE_URL is not set — add it to .env and retry');
  }
  const client = new pg.Client({ connectionString: env.DWH_DATABASE_URL });
  await client.connect();
  console.log('[dwh] connected; introspecting information_schema');

  try {
    const schemaList = `(${EXCLUDED_SCHEMAS.map((_, i) => `$${i + 1}`).join(', ')})`;
    const { rows: tables } = await client.query<TableRow>(
      `SELECT table_schema, table_name, table_type
         FROM information_schema.tables
        WHERE table_schema NOT IN ${schemaList}
        ORDER BY table_schema, table_name`,
      EXCLUDED_SCHEMAS,
    );
    const { rows: columns } = await client.query<ColumnRow>(
      `SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns
        WHERE table_schema NOT IN ${schemaList}
        ORDER BY table_schema, table_name, ordinal_position`,
      EXCLUDED_SCHEMAS,
    );
    const { rows: pks } = await client.query<PkRow>(
      `SELECT tc.table_schema, tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema NOT IN ${schemaList}`,
      EXCLUDED_SCHEMAS,
    );

    const pkSet = new Set(pks.map((p) => `${p.table_schema}.${p.table_name}.${p.column_name}`));
    const byTable = new Map<string, TableMeta>();
    for (const t of tables) {
      byTable.set(`${t.table_schema}.${t.table_name}`, {
        schema: t.table_schema,
        name: t.table_name,
        type: t.table_type,
        columns: [],
      });
    }
    for (const c of columns) {
      const meta = byTable.get(`${c.table_schema}.${c.table_name}`);
      if (!meta) continue;
      meta.columns.push({
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.is_nullable === 'YES',
        default: c.column_default,
        primaryKey: pkSet.has(`${c.table_schema}.${c.table_name}.${c.column_name}`),
      });
    }

    const allTables = [...byTable.values()];
    const schemas = [...new Set(allTables.map((t) => t.schema))].sort();
    const json = {
      service: 'dwh',
      generatedAt: nowIso(),
      schemaCount: schemas.length,
      tableCount: allTables.length,
      schemas,
      tables: allTables,
    };

    const lines: string[] = [
      '# Data Warehouse metadata',
      '',
      `Generated: ${json.generatedAt}`,
      `Schemas: ${schemas.length} · Tables/views: ${allTables.length}`,
      '',
    ];
    for (const schema of schemas) {
      lines.push(`## Schema: \`${schema}\``, '');
      for (const t of allTables.filter((x) => x.schema === schema)) {
        lines.push(`### \`${t.name}\` (${t.type})`, '');
        lines.push('| Column | Type | Nullable | PK |', '| --- | --- | --- | --- |');
        for (const col of t.columns) {
          lines.push(
            `| \`${col.name}\` | ${col.dataType} | ${col.nullable ? 'yes' : 'no'} | ${col.primaryKey ? 'yes' : ''} |`,
          );
        }
        lines.push('');
      }
    }
    console.log(`[dwh] ${schemas.length} schemas, ${allTables.length} tables/views`);

    return await writeMetadata('dwh', json, lines.join('\n'));
  } finally {
    await client.end();
  }
}

runAnalyzer('dwh', main);
