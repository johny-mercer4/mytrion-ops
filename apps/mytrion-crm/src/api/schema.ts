/**
 * Shared shape for the Admin database-schema browsers (CMP MySQL + DWH Postgres). Both backends
 * return this identical structure so a single <SchemaBrowser> renders either. Multi-schema sources
 * (the DWH) additionally populate `schemas` and each table's `schema`; single-database sources
 * (CMP) leave them absent, and the UI hides the schema dimension.
 */
export interface DbColumn {
  name: string;
  /** Full SQL type, e.g. `varchar(255)`, `numeric(12,2)`, `text[]`. */
  type: string;
  /** Base type without modifiers, e.g. `varchar`, `int8`, `jsonb`. */
  dataType: string;
  nullable: boolean;
  /** '', 'PRI', 'UNI', or 'MUL'. */
  key: string;
  default: string | null;
  extra: string;
  comment: string;
}

export interface DbTable {
  /** Present for multi-schema sources (DWH); absent for single-database sources (CMP). */
  schema?: string | null;
  name: string;
  /** 'BASE TABLE', 'VIEW', 'MATERIALIZED VIEW', or 'FOREIGN'. */
  type: string;
  approxRows: number | null;
  /** ISO timestamp of the last recorded write/activity; null when unknown (e.g. views). */
  updateTime: string | null;
  createTime: string | null;
  comment: string;
  columns: DbColumn[];
}

export interface DbSchemaSnapshot {
  database: string;
  fetchedAt: string;
  /** Distinct schemas present, sorted — populated only by multi-schema sources (DWH). */
  schemas?: string[];
  tableCount: number;
  columnCount: number;
  tables: DbTable[];
}
