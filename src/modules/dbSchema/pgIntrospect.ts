/**
 * Generic, read-only Postgres schema introspection (pg_catalog only — never table data). Shared by
 * the Mytrion Admin "Data Warehouse" and "Verification DB" tabs so both surface the identical
 * snapshot shape (schemas, tables, columns, key roles, row estimates, freshness) through one UI.
 *
 * Postgres has no per-table "last write"; `updateTime` is the most recent of a table's
 * vacuum/analyze timestamps (pg_stat_all_tables) — a reliable "recently active" proxy (autovacuum/
 * autoanalyze fire as a table is written). Covers ALL non-system schemas and all relation kinds
 * (incl. materialized views, which information_schema omits).
 */
export interface PgColumn {
  name: string;
  /** Full SQL type via format_type, e.g. `character varying(255)`, `numeric(12,2)`, `text[]`. */
  type: string;
  /** Base type name (pg_type.typname), e.g. `int8`, `text`, `numeric`, `jsonb`. */
  dataType: string;
  nullable: boolean;
  /** '', 'PRI' (primary key), 'UNI' (unique), or 'MUL' (foreign key). */
  key: string;
  default: string | null;
  extra: string;
  comment: string;
}

export interface PgTable {
  schema: string;
  name: string;
  /** 'BASE TABLE', 'VIEW', 'MATERIALIZED VIEW', or 'FOREIGN'. */
  type: string;
  approxRows: number | null;
  /** ISO timestamp of the most recent vacuum/analyze — the "recently active" signal; null if none. */
  updateTime: string | null;
  createTime: string | null;
  comment: string;
  columns: PgColumn[];
}

export interface PgSchemaSnapshot {
  database: string;
  fetchedAt: string;
  schemas: string[];
  tableCount: number;
  columnCount: number;
  tables: PgTable[];
}

/** A read-only query runner (the dwh / verificationDb wrappers both satisfy this). */
export interface PgQueryRunner {
  query<T extends object = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<T[]>;
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
 * Read the full structure of a Postgres database from pg_catalog: relations (with freshness + row
 * estimates), columns, and key roles (PK/UNIQUE/FK), stitched into one nested snapshot across all
 * non-system schemas. `runner` MUST be a read-only pool.
 */
export async function introspectPgSchema(
  runner: PgQueryRunner,
  dbFallback: string,
): Promise<PgSchemaSnapshot> {
  const [dbRow, relations, columns, keys, fks] = await Promise.all([
    runner.query<{ db: string }>('SELECT current_database() AS db'),
    runner.query<RelationRow>(RELATIONS_SQL),
    runner.query<ColumnRow>(COLUMNS_SQL),
    runner.query<KeyRow>(KEYS_SQL),
    runner.query<FkRow>(FKS_SQL),
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

  const columnsByTable = new Map<string, PgColumn[]>();
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

  const tables: PgTable[] = relations.map((r) => {
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
    database: dbRow[0]?.db ?? dbFallback,
    fetchedAt: new Date().toISOString(),
    schemas,
    tableCount: tables.length,
    columnCount: columns.length,
    tables,
  };
}
