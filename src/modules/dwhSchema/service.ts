/**
 * DWH schema introspection — a read-only, live view of the Data Warehouse Postgres (`dwh`,
 * integrations/dwh.ts) for the Mytrion Admin "Data Warehouse" developer tab. The Postgres
 * counterpart to modules/cmpSchema (which introspects the CMP MySQL); it returns the SAME snapshot
 * shape so the two tabs share one UI, plus a `schema` per relation and a `schemas` list — DWH spans
 * many schemas, not one database.
 *
 * Reads pg_catalog only (never table data), so it covers ALL schemas and ALL relation kinds —
 * including materialized views, which Postgres omits from information_schema. Postgres has no
 * per-table "last write" like MySQL's UPDATE_TIME, so `updateTime` is the most recent of a table's
 * vacuum/analyze timestamps (pg_stat_all_tables) — a reliable "recently active" signal for a DWH
 * that autoanalyzes on each dbt rebuild. Raw SQL lives here (a module), NOT in routes/ (repo rule
 * 2); everything runs through the enforced read-only `dwh` pool.
 */
import { dwh } from '../../integrations/dwh.js';
import { AppError } from '../../lib/errors.js';

export interface DwhColumn {
  name: string;
  /** Full SQL type via format_type, e.g. `character varying(255)`, `numeric(12,2)`, `text[]`. */
  type: string;
  /** Base type name (pg_type.typname), e.g. `int8`, `text`, `numeric`, `jsonb`. */
  dataType: string;
  nullable: boolean;
  /** '', 'PRI' (primary key), 'UNI' (unique), or 'MUL' (foreign key) — mirrors the MySQL wrapper. */
  key: string;
  default: string | null;
  /** Reserved for parity with the MySQL side (auto_increment etc.); always '' for Postgres. */
  extra: string;
  comment: string;
}

export interface DwhTable {
  schema: string;
  name: string;
  /** 'BASE TABLE', 'VIEW', 'MATERIALIZED VIEW', or 'FOREIGN'. */
  type: string;
  /** Planner row estimate (pg_class.reltuples / pg_stat n_live_tup); null for views. */
  approxRows: number | null;
  /** ISO timestamp of the most recent vacuum/analyze — the "recently active" signal; null if none. */
  updateTime: string | null;
  /** Postgres exposes no cheap per-relation creation time; always null (kept for shape parity). */
  createTime: string | null;
  comment: string;
  columns: DwhColumn[];
}

export interface DwhSchemaSnapshot {
  database: string;
  fetchedAt: string;
  /** Distinct non-system schemas present, sorted. */
  schemas: string[];
  tableCount: number;
  columnCount: number;
  tables: DwhTable[];
}

/** Exclude system schemas (pg_catalog, pg_toast, pg_temp_*, information_schema) everywhere. */
const NON_SYSTEM = `n.nspname <> 'information_schema' AND n.nspname !~ '^pg_'`;

const RELATIONS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS name,
         CASE c.relkind
           WHEN 'r' THEN 'BASE TABLE' WHEN 'p' THEN 'BASE TABLE'
           WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW'
           WHEN 'f' THEN 'FOREIGN' ELSE c.relkind::text
         END AS type,
         CASE WHEN c.relkind IN ('r','p','m')
              THEN COALESCE(NULLIF(c.reltuples, -1)::bigint, s.n_live_tup)
              ELSE NULL END AS approx_rows,
         GREATEST(s.last_vacuum, s.last_autovacuum, s.last_analyze, s.last_autoanalyze) AS update_time,
         obj_description(c.oid, 'pg_class') AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
   WHERE c.relkind IN ('r','p','v','m','f') AND ${NON_SYSTEM}
   ORDER BY n.nspname, c.relname`;

const COLUMNS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         a.attname AS name,
         format_type(a.atttypid, a.atttypmod) AS type,
         t.typname AS data_type,
         (NOT a.attnotnull) AS nullable,
         pg_get_expr(ad.adbin, ad.adrelid) AS col_default,
         col_description(c.oid, a.attnum) AS comment
    FROM pg_attribute a
    JOIN pg_class c ON c.oid = a.attrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_type t ON t.oid = a.atttypid
    LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
   WHERE c.relkind IN ('r','p','v','m','f')
     AND a.attnum > 0 AND NOT a.attisdropped AND ${NON_SYSTEM}
   ORDER BY n.nspname, c.relname, a.attnum`;

/** Primary-key / unique columns, one row per (schema, table, column). */
const KEYS_SQL = `
  SELECT n.nspname AS schema,
         c.relname AS table_name,
         a.attname AS name,
         bool_or(i.indisprimary) AS is_pk,
         bool_or(i.indisunique AND NOT i.indisprimary) AS is_unique
    FROM pg_index i
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(i.indkey::int2[])
   WHERE (i.indisprimary OR i.indisunique) AND ${NON_SYSTEM}
   GROUP BY n.nspname, c.relname, a.attname`;

/** Foreign-key columns, one row per (schema, table, column). */
const FKS_SQL = `
  SELECT DISTINCT n.nspname AS schema,
         c.relname AS table_name,
         a.attname AS name
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
   WHERE con.contype = 'f' AND ${NON_SYSTEM}`;

interface RelationRow {
  schema: string;
  name: string;
  type: string;
  approx_rows: string | number | null;
  update_time: Date | string | null;
  comment: string | null;
}
interface ColumnRow {
  schema: string;
  table_name: string;
  name: string;
  type: string;
  data_type: string;
  nullable: boolean;
  col_default: string | null;
  comment: string | null;
}
interface KeyRow {
  schema: string;
  table_name: string;
  name: string;
  is_pk: boolean;
  is_unique: boolean;
}
interface FkRow {
  schema: string;
  table_name: string;
  name: string;
}

/** Coerce a Postgres timestamptz (node-pg returns a Date) to ISO, else null. */
function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Unambiguous composite map key from parts — JSON so (schema, table[, column]) never collide. */
function keyOf(...parts: string[]): string {
  return JSON.stringify(parts);
}

/**
 * Read the full structure of the DWH from pg_catalog: relations (with freshness + row estimates),
 * columns, and key roles (PK/UNIQUE/FK), stitched into one nested snapshot across all schemas.
 */
export async function getDwhSchema(): Promise<DwhSchemaSnapshot> {
  if (!dwh.isConfigured()) {
    throw new AppError('Data Warehouse is not configured.', {
      statusCode: 503,
      code: 'DWH_UNCONFIGURED',
    });
  }

  const [dbRow, relations, columns, keys, fks] = await Promise.all([
    dwh.query<{ db: string }>('SELECT current_database() AS db'),
    dwh.query<RelationRow>(RELATIONS_SQL),
    dwh.query<ColumnRow>(COLUMNS_SQL),
    dwh.query<KeyRow>(KEYS_SQL),
    dwh.query<FkRow>(FKS_SQL),
  ]);

  // Column key role: PK wins over UNIQUE wins over FK. Map keyed by (schema, table, column).
  const keyRole = new Map<string, string>();
  for (const k of keys) {
    keyRole.set(keyOf(k.schema, k.table_name, k.name), k.is_pk ? 'PRI' : k.is_unique ? 'UNI' : '');
  }
  for (const f of fks) {
    const id = keyOf(f.schema, f.table_name, f.name);
    if (!keyRole.get(id)) keyRole.set(id, 'MUL'); // don't overwrite a PK/UNIQUE role
  }

  const columnsByTable = new Map<string, DwhColumn[]>();
  for (const c of columns) {
    const id = keyOf(c.schema, c.table_name);
    const list = columnsByTable.get(id) ?? [];
    list.push({
      name: c.name,
      type: c.type,
      dataType: c.data_type,
      nullable: c.nullable,
      key: keyRole.get(keyOf(c.schema, c.table_name, c.name)) ?? '',
      default: c.col_default,
      extra: '',
      comment: c.comment ?? '',
    });
    columnsByTable.set(id, list);
  }

  const tables: DwhTable[] = relations.map((r) => {
    const approx = r.approx_rows == null ? null : Number(r.approx_rows);
    return {
      schema: r.schema,
      name: r.name,
      type: r.type,
      approxRows: approx == null || Number.isNaN(approx) ? null : approx,
      updateTime: toIso(r.update_time),
      createTime: null,
      comment: r.comment ?? '',
      columns: columnsByTable.get(keyOf(r.schema, r.name)) ?? [],
    };
  });

  const schemas = [...new Set(tables.map((t) => t.schema))].sort();

  return {
    database: dbRow[0]?.db ?? 'dwh',
    fetchedAt: new Date().toISOString(),
    schemas,
    tableCount: tables.length,
    columnCount: columns.length,
    tables,
  };
}
