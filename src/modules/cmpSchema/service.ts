/**
 * CMP database schema introspection — a read-only, live view of the external AWS RDS/Aurora MySQL
 * (`cmpDb`, integrations/awsMysql.ts) for the Mytrion Admin "CMP Database" developer tab. Reads
 * `information_schema` only (never table data), so it exposes structure — tables, columns, data
 * types, approximate row counts, and each table's last-write time — without touching sensitive rows.
 *
 * Raw SQL lives here (a module), NOT in routes/ (repo rule 2). Everything runs through `cmpDb.query`,
 * which pins a read-only session (AWS_MYSQL_READONLY).
 */
import { env } from '../../config/env.js';
import { cmpDb } from '../../integrations/awsMysql.js';
import { cmpTunnelRequired, ensureCmpTunnel } from '../../integrations/cmpTunnel.js';
import { AppError } from '../../lib/errors.js';

export interface CmpColumn {
  name: string;
  /** Full SQL type incl. length/enum members, e.g. `varchar(255)`, `enum('A','B')`. */
  type: string;
  /** Base data type without modifiers, e.g. `varchar`, `decimal`, `enum`. */
  dataType: string;
  nullable: boolean;
  /** '', 'PRI', 'UNI', or 'MUL'. */
  key: string;
  default: string | null;
  /** e.g. `auto_increment`, `on update CURRENT_TIMESTAMP`. */
  extra: string;
  comment: string;
}

export interface CmpTable {
  name: string;
  /** 'BASE TABLE' or 'VIEW'. */
  type: string;
  /** Engine-estimated row count (approximate for InnoDB); null for views. */
  approxRows: number | null;
  /** ISO timestamp of the last write MySQL recorded for the table; null when unknown (e.g. views). */
  updateTime: string | null;
  createTime: string | null;
  comment: string;
  columns: CmpColumn[];
}

export interface CmpSchemaSnapshot {
  database: string;
  /** When this snapshot was read from the DB (ISO). */
  fetchedAt: string;
  tableCount: number;
  columnCount: number;
  tables: CmpTable[];
}

interface TableRow {
  tableName: string;
  tableType: string;
  approxRows: number | string | null;
  updateTime: Date | string | null;
  createTime: Date | string | null;
  comment: string | null;
}

interface ColumnRow {
  tableName: string;
  columnName: string;
  columnType: string;
  dataType: string;
  isNullable: string;
  columnKey: string;
  columnDefault: string | null;
  extra: string;
  comment: string | null;
}

/** Coerce a MySQL DATETIME (mysql2 returns a Date, or a string with dateStrings) to ISO, else null. */
function toIso(value: Date | string | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * The schema we introspect. Prefer the configured database; otherwise ask the live session
 * (`SELECT DATABASE()`), which is set when connecting via the URI form (mysql://…/tss_db).
 */
async function resolveDatabase(): Promise<string> {
  if (env.AWS_MYSQL_DATABASE) return env.AWS_MYSQL_DATABASE;
  const rows = await cmpDb.query<{ db: string | null }>('SELECT DATABASE() AS db');
  const db = rows[0]?.db;
  if (!db) {
    throw new AppError('CMP database name is not resolvable — set AWS_MYSQL_DATABASE.', {
      statusCode: 503,
      code: 'CMP_DB_UNCONFIGURED',
    });
  }
  return db;
}

/**
 * Read the full structure of the CMP MySQL database from `information_schema`. Two queries (tables,
 * then columns) are stitched into one nested snapshot; a table with no columns still appears.
 */
export async function getCmpSchema(): Promise<CmpSchemaSnapshot> {
  if (!cmpDb.isConfigured()) {
    throw new AppError('CMP database is not configured.', {
      statusCode: 503,
      code: 'CMP_DB_UNCONFIGURED',
    });
  }

  if (cmpTunnelRequired()) {
    const tunnel = await ensureCmpTunnel();
    if (!tunnel.ready) {
      throw new AppError(tunnel.message, {
        statusCode: 503,
        code: 'CMP_TUNNEL_UNAVAILABLE',
      });
    }
  }

  const database = await resolveDatabase();

  const [tableRows, columnRows] = await Promise.all([
    cmpDb.query<TableRow>(
      `SELECT table_name AS tableName, table_type AS tableType, table_rows AS approxRows,
              update_time AS updateTime, create_time AS createTime, table_comment AS comment
         FROM information_schema.tables
        WHERE table_schema = ?
        ORDER BY table_name`,
      [database],
    ),
    cmpDb.query<ColumnRow>(
      `SELECT table_name AS tableName, column_name AS columnName, column_type AS columnType,
              data_type AS dataType, is_nullable AS isNullable, column_key AS columnKey,
              column_default AS columnDefault, extra AS extra, column_comment AS comment
         FROM information_schema.columns
        WHERE table_schema = ?
        ORDER BY table_name, ordinal_position`,
      [database],
    ),
  ]);

  const columnsByTable = new Map<string, CmpColumn[]>();
  for (const c of columnRows) {
    const list = columnsByTable.get(c.tableName) ?? [];
    list.push({
      name: c.columnName,
      type: c.columnType,
      dataType: c.dataType,
      nullable: c.isNullable === 'YES',
      key: c.columnKey ?? '',
      default: c.columnDefault,
      extra: c.extra ?? '',
      comment: c.comment ?? '',
    });
    columnsByTable.set(c.tableName, list);
  }

  const tables: CmpTable[] = tableRows.map((t) => {
    const approx = t.approxRows == null ? null : Number(t.approxRows);
    return {
      name: t.tableName,
      type: t.tableType,
      approxRows: approx == null || Number.isNaN(approx) ? null : approx,
      updateTime: toIso(t.updateTime),
      createTime: toIso(t.createTime),
      comment: t.comment ?? '',
      columns: columnsByTable.get(t.tableName) ?? [],
    };
  });

  return {
    database,
    fetchedAt: new Date().toISOString(),
    tableCount: tables.length,
    columnCount: columnRows.length,
    tables,
  };
}
