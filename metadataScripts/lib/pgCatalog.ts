/**
 * Shared Postgres catalog introspection — schemas, tables, columns, activity stats,
 * and deprecation hints from pg_description comments.
 */
import pg from 'pg';
import { databaseUrl, env } from '../../src/config/env.js';

export type PgTarget = 'dwh' | 'ops';

export const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast'] as const;

export interface PgConnectOptions {
  target?: PgTarget;
  connectionString?: string;
}

export interface ColumnMeta {
  /** Column identifier (API / SQL name). */
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  default: string | null;
  primaryKey: boolean;
  ordinalPosition: number;
  comment: string | null;
  deprecated: boolean;
}

export interface ForeignKeyMeta {
  column: string;
  references: string;
}

export interface IndexMeta {
  name: string;
  definition: string;
}

export interface TableActivity {
  inserts: number;
  updates: number;
  deletes: number;
  totalWrites: number;
  liveRows: number;
  deadRows: number;
  rowEstimate: number;
  lastVacuum: string | null;
  lastAutovacuum: string | null;
  lastAnalyze: string | null;
  lastAutoanalyze: string | null;
  statsResetAt: string | null;
}

export interface TableMeta {
  schema: string;
  name: string;
  qualifiedName: string;
  type: string;
  comment: string | null;
  deprecated: boolean;
  activelyUpdated: boolean;
  activityStatus: 'active' | 'inactive' | 'unknown';
  activityReason: string;
  activity: TableActivity;
  columns: ColumnMeta[];
  foreignKeys: ForeignKeyMeta[];
  indexes: IndexMeta[];
}

export interface PgCatalog {
  target: PgTarget;
  connectionLabel: string;
  generatedAt: string;
  schemaCount: number;
  tableCount: number;
  foreignKeyCount: number;
  indexCount: number;
  schemas: string[];
  tables: TableMeta[];
}

interface TableRow {
  table_schema: string;
  table_name: string;
  table_type: string;
}

interface ColumnRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  data_type: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
  column_default: string | null;
  ordinal_position: number;
}

interface CommentRow {
  table_schema: string;
  table_name: string;
  table_comment: string | null;
  column_name: string | null;
  column_comment: string | null;
  ordinal_position: number | null;
}

interface PkRow {
  table_schema: string;
  table_name: string;
  column_name: string;
}

interface FkRow {
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

interface IndexRow {
  schemaname: string;
  tablename: string;
  indexname: string;
  indexdef: string;
}

interface StatRow {
  schemaname: string;
  relname: string;
  n_tup_ins: string;
  n_tup_upd: string;
  n_tup_del: string;
  n_live_tup: string;
  n_dead_tup: string;
  last_vacuum: Date | null;
  last_autovacuum: Date | null;
  last_analyze: Date | null;
  last_autoanalyze: Date | null;
  stats_reset: Date | null;
}

const DEPRECATED_RE = /\b(deprecated|deprecate|do not use|legacy|obsolete|sunset)\b/i;
const ACTIVE_WINDOW_DAYS = 30;

/** Resolve which Postgres URL to use. */
export function resolvePgUrl(target: PgTarget = 'dwh'): string {
  if (target === 'dwh') {
    if (!env.DWH_DATABASE_URL) {
      throw new Error('[pg-catalog] DWH_DATABASE_URL is not set — add it to .env and retry');
    }
    return env.DWH_DATABASE_URL;
  }
  if (!databaseUrl) {
    throw new Error('[pg-catalog] MYTRION_OPS_DATABASE_URL is not set — add it to .env and retry');
  }
  return databaseUrl;
}

/** Open a pg client for catalog reads. Caller must close. */
export async function connectPg(options: PgConnectOptions = {}): Promise<{ client: pg.Client; target: PgTarget }> {
  const target = options.target ?? 'dwh';
  const connectionString = options.connectionString ?? resolvePgUrl(target);
  const client = new pg.Client({ connectionString });
  await client.connect();
  return { client, target };
}

function isDeprecatedComment(comment: string | null | undefined): boolean {
  return Boolean(comment && DEPRECATED_RE.test(comment));
}

function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function withinDays(isoDate: string | null, days: number): boolean {
  if (!isoDate) return false;
  const ms = Date.now() - new Date(isoDate).getTime();
  return ms >= 0 && ms <= days * 86_400_000;
}

function inferActivity(
  stats: TableActivity,
  tableComment: string | null,
): { activelyUpdated: boolean; activityStatus: 'active' | 'inactive' | 'unknown'; activityReason: string } {
  if (isDeprecatedComment(tableComment)) {
    return {
      activelyUpdated: false,
      activityStatus: 'inactive',
      activityReason: 'table comment marks deprecated/legacy',
    };
  }

  const recentVacuum = withinDays(stats.lastAutovacuum, ACTIVE_WINDOW_DAYS) || withinDays(stats.lastVacuum, ACTIVE_WINDOW_DAYS);
  const recentAnalyze = withinDays(stats.lastAutoanalyze, ACTIVE_WINDOW_DAYS) || withinDays(stats.lastAnalyze, ACTIVE_WINDOW_DAYS);

  if (stats.totalWrites > 0) {
    const parts = [`${stats.totalWrites} writes since stats reset`];
    if (stats.updates > 0) parts.push(`${stats.updates} updates`);
    if (stats.inserts > 0) parts.push(`${stats.inserts} inserts`);
    if (recentVacuum) parts.push('recent vacuum');
    if (recentAnalyze) parts.push('recent analyze');
    return {
      activelyUpdated: true,
      activityStatus: 'active',
      activityReason: parts.join('; '),
    };
  }

  if (recentVacuum || recentAnalyze) {
    return {
      activelyUpdated: true,
      activityStatus: 'active',
      activityReason: recentVacuum
        ? `autovacuum/vacuum within ${ACTIVE_WINDOW_DAYS}d`
        : `analyze within ${ACTIVE_WINDOW_DAYS}d`,
    };
  }

  if (stats.statsResetAt === null && stats.rowEstimate === 0) {
    return {
      activelyUpdated: false,
      activityStatus: 'unknown',
      activityReason: 'no stats collected yet (empty or never scanned)',
    };
  }

  return {
    activelyUpdated: false,
    activityStatus: 'inactive',
    activityReason: `no writes since stats reset${stats.statsResetAt ? ` (${stats.statsResetAt})` : ''}`,
  };
}

function emptyActivity(): TableActivity {
  return {
    inserts: 0,
    updates: 0,
    deletes: 0,
    totalWrites: 0,
    liveRows: 0,
    deadRows: 0,
    rowEstimate: 0,
    lastVacuum: null,
    lastAutovacuum: null,
    lastAnalyze: null,
    lastAutoanalyze: null,
    statsResetAt: null,
  };
}

function statFromRow(row: StatRow | undefined): TableActivity {
  if (!row) return emptyActivity();
  const inserts = Number(row.n_tup_ins);
  const updates = Number(row.n_tup_upd);
  const deletes = Number(row.n_tup_del);
  return {
    inserts,
    updates,
    deletes,
    totalWrites: inserts + updates + deletes,
    liveRows: Number(row.n_live_tup),
    deadRows: Number(row.n_dead_tup),
    rowEstimate: Number(row.n_live_tup),
    lastVacuum: iso(row.last_vacuum),
    lastAutovacuum: iso(row.last_autovacuum),
    lastAnalyze: iso(row.last_analyze),
    lastAutoanalyze: iso(row.last_autoanalyze),
    statsResetAt: iso(row.stats_reset),
  };
}

/** Introspect all non-system schemas/tables in a Postgres database. */
export async function fetchPgCatalog(client: pg.Client, target: PgTarget, generatedAt: string): Promise<PgCatalog> {
  const schemaList = `(${EXCLUDED_SCHEMAS.map((_, i) => `$${i + 1}`).join(', ')})`;

  const { rows: tables } = await client.query<TableRow>(
    `SELECT table_schema, table_name, table_type
       FROM information_schema.tables
      WHERE table_schema NOT IN ${schemaList}
      ORDER BY table_schema, table_name`,
    [...EXCLUDED_SCHEMAS],
  );

  const { rows: columns } = await client.query<ColumnRow>(
    `SELECT table_schema, table_name, column_name, data_type, udt_name,
            is_nullable, column_default, ordinal_position
       FROM information_schema.columns
      WHERE table_schema NOT IN ${schemaList}
      ORDER BY table_schema, table_name, ordinal_position`,
    [...EXCLUDED_SCHEMAS],
  );

  const { rows: comments } = await client.query<CommentRow>(
    `SELECT n.nspname AS table_schema,
            c.relname AS table_name,
            obj_description(c.oid, 'pg_class') AS table_comment,
            a.attname AS column_name,
            col_description(c.oid, a.attnum) AS column_comment,
            a.attnum AS ordinal_position
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
        AND n.nspname NOT IN ${schemaList}
      ORDER BY n.nspname, c.relname, a.attnum NULLS FIRST`,
    [...EXCLUDED_SCHEMAS],
  );

  const { rows: pks } = await client.query<PkRow>(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema NOT IN ${schemaList}`,
    [...EXCLUDED_SCHEMAS],
  );

  const { rows: fks } = await client.query<FkRow>(
    `SELECT tc.table_schema, tc.table_name, kcu.column_name,
            ccu.table_schema AS foreign_table_schema,
            ccu.table_name   AS foreign_table_name,
            ccu.column_name  AS foreign_column_name
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ${schemaList}`,
    [...EXCLUDED_SCHEMAS],
  );

  const { rows: indexes } = await client.query<IndexRow>(
    `SELECT schemaname, tablename, indexname, indexdef
       FROM pg_indexes
      WHERE schemaname NOT IN ${schemaList}
      ORDER BY schemaname, tablename, indexname`,
    [...EXCLUDED_SCHEMAS],
  );

  const { rows: stats } = await client.query<StatRow>(
    `SELECT schemaname, relname,
            n_tup_ins::text, n_tup_upd::text, n_tup_del::text,
            n_live_tup::text, n_dead_tup::text,
            last_vacuum, last_autovacuum, last_analyze, last_autoanalyze,
            stats_reset
       FROM pg_stat_user_tables
      WHERE schemaname NOT IN ${schemaList}`,
    [...EXCLUDED_SCHEMAS],
  );

  const pkSet = new Set(pks.map((p) => `${p.table_schema}.${p.table_name}.${p.column_name}`));
  const tableComments = new Map<string, string | null>();
  const columnComments = new Map<string, string | null>();

  for (const row of comments) {
    const key = `${row.table_schema}.${row.table_name}`;
    if (row.table_comment !== undefined) {
      tableComments.set(key, row.table_comment);
    }
    if (row.column_name && row.column_comment) {
      columnComments.set(`${key}.${row.column_name}`, row.column_comment);
    }
  }

  const statsByTable = new Map(stats.map((s) => [`${s.schemaname}.${s.relname}`, s]));
  const byTable = new Map<string, TableMeta>();

  for (const t of tables) {
    const qualified = `${t.table_schema}.${t.table_name}`;
    const comment = tableComments.get(qualified) ?? null;
    const activity = statFromRow(statsByTable.get(qualified));
    const { activelyUpdated, activityStatus, activityReason } = inferActivity(activity, comment);

    byTable.set(qualified, {
      schema: t.table_schema,
      name: t.table_name,
      qualifiedName: qualified,
      type: t.table_type,
      comment,
      deprecated: isDeprecatedComment(comment),
      activelyUpdated,
      activityStatus,
      activityReason,
      activity,
      columns: [],
      foreignKeys: [],
      indexes: [],
    });
  }

  for (const c of columns) {
    const meta = byTable.get(`${c.table_schema}.${c.table_name}`);
    if (!meta) continue;
    const colComment = columnComments.get(`${c.table_schema}.${c.table_name}.${c.column_name}`) ?? null;
    meta.columns.push({
      name: c.column_name,
      dataType: c.data_type,
      udtName: c.udt_name,
      nullable: c.is_nullable === 'YES',
      default: c.column_default,
      primaryKey: pkSet.has(`${c.table_schema}.${c.table_name}.${c.column_name}`),
      ordinalPosition: c.ordinal_position,
      comment: colComment,
      deprecated: isDeprecatedComment(colComment),
    });
  }

  for (const fk of fks) {
    const meta = byTable.get(`${fk.table_schema}.${fk.table_name}`);
    if (!meta) continue;
    meta.foreignKeys.push({
      column: fk.column_name,
      references: `${fk.foreign_table_schema}.${fk.foreign_table_name}.${fk.foreign_column_name}`,
    });
  }

  for (const idx of indexes) {
    const meta = byTable.get(`${idx.schemaname}.${idx.tablename}`);
    if (!meta) continue;
    meta.indexes.push({ name: idx.indexname, definition: idx.indexdef });
  }

  const allTables = [...byTable.values()];
  const schemas = [...new Set(allTables.map((t) => t.schema))].sort();

  return {
    target,
    connectionLabel: target === 'dwh' ? 'DWH_DATABASE_URL' : 'MYTRION_OPS_DATABASE_URL',
    generatedAt,
    schemaCount: schemas.length,
    tableCount: allTables.length,
    foreignKeyCount: fks.length,
    indexCount: indexes.length,
    schemas,
    tables: allTables,
  };
}

/** Find tables matching a name across schemas (case-insensitive). */
export function findTables(catalog: PgCatalog, tableName: string, schema?: string): TableMeta[] {
  const needle = tableName.toLowerCase();
  return catalog.tables.filter((t) => {
    if (schema && t.schema !== schema) return false;
    return t.name.toLowerCase() === needle;
  });
}

export function renderCatalogMarkdown(catalog: PgCatalog): string {
  const lines: string[] = [
    `# Postgres metadata (${catalog.target})`,
    '',
    `Generated: ${catalog.generatedAt}`,
    `Connection: \`${catalog.connectionLabel}\``,
    `Schemas: ${catalog.schemaCount} · Tables/views: ${catalog.tableCount} · FKs: ${catalog.foreignKeyCount} · Indexes: ${catalog.indexCount}`,
    '',
    '## Activity legend',
    '',
    '- **active** — writes since stats reset and/or vacuum/analyze within 30 days',
    '- **inactive** — no writes since stats reset; or table comment marks deprecated',
    '- **unknown** — no stats yet (often empty/new tables)',
    '',
  ];

  for (const schema of catalog.schemas) {
    lines.push(`## Schema: \`${schema}\``, '');
    for (const t of catalog.tables.filter((x) => x.schema === schema)) {
      const status = t.deprecated ? 'deprecated' : t.activityStatus;
      lines.push(
        `### \`${t.name}\` (${t.type}) — ${status}${t.activelyUpdated ? ' · actively updated' : ''}`,
        '',
        t.comment ? `> ${t.comment}` : '',
        t.comment ? '' : '',
        `Activity: ${t.activityReason}`,
        '',
        '| Column | Type | UDT | Nullable | PK | Deprecated | FK→ |',
        '| --- | --- | --- | --- | --- | --- | --- |',
      );
      const fkByCol = new Map(t.foreignKeys.map((fk) => [fk.column, fk.references]));
      for (const col of t.columns) {
        const ref = fkByCol.get(col.name);
        lines.push(
          `| \`${col.name}\` | ${col.dataType} | ${col.udtName} | ${col.nullable ? 'yes' : 'no'} | ${col.primaryKey ? 'yes' : ''} | ${col.deprecated ? 'yes' : ''} | ${ref ? `\`${ref}\`` : ''} |`,
        );
      }
      if (t.indexes.length > 0) {
        lines.push('', `Indexes: ${t.indexes.map((i) => `\`${i.name}\``).join(', ')}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

export function renderTableMarkdown(table: TableMeta, catalog: Pick<PgCatalog, 'target' | 'generatedAt' | 'connectionLabel'>): string {
  const status = table.deprecated ? 'deprecated' : table.activityStatus;
  const lines: string[] = [
    `# Table \`${table.qualifiedName}\``,
    '',
    `Target: ${catalog.target} · Generated: ${catalog.generatedAt}`,
    `Connection: \`${catalog.connectionLabel}\``,
    `Type: ${table.type} · Status: **${status}** · Actively updated: ${table.activelyUpdated ? 'yes' : 'no'}`,
    '',
    table.comment ? `> ${table.comment}` : '',
    table.comment ? '' : '',
    `Activity: ${table.activityReason}`,
    '',
    `- Inserts: ${table.activity.inserts} · Updates: ${table.activity.updates} · Deletes: ${table.activity.deletes}`,
    `- Row estimate: ${table.activity.rowEstimate}`,
    `- Last autovacuum: ${table.activity.lastAutovacuum ?? '—'}`,
    `- Last autoanalyze: ${table.activity.lastAutoanalyze ?? '—'}`,
    '',
    '| # | Column (API) | Data type | UDT | Nullable | PK | Deprecated | Default |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];

  for (const col of table.columns) {
    lines.push(
      `| ${col.ordinalPosition} | \`${col.name}\` | ${col.dataType} | ${col.udtName} | ${col.nullable ? 'yes' : 'no'} | ${col.primaryKey ? 'yes' : ''} | ${col.deprecated ? 'yes' : ''} | ${col.default ? `\`${col.default}\`` : ''} |`,
    );
  }

  if (table.foreignKeys.length > 0) {
    lines.push('', '## Foreign keys', '');
    for (const fk of table.foreignKeys) {
      lines.push(`- \`${fk.column}\` → \`${fk.references}\``);
    }
  }

  if (table.indexes.length > 0) {
    lines.push('', '## Indexes', '');
    for (const idx of table.indexes) {
      lines.push(`- \`${idx.name}\`: ${idx.definition}`);
    }
  }

  return lines.join('\n');
}
