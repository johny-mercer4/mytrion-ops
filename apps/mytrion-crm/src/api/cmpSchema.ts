/**
 * CMP database schema (GET /v1/admin/cmp-schema) — the live structure of the external CMP MySQL
 * (tables, columns, data types, approximate row counts, last-write times) for the Admin developer
 * tab. Schema only, never row data. Admin-only on the backend. Returns the shared DbSchemaSnapshot
 * shape (single-database: no `schemas`/per-table `schema`).
 */
import { request } from './transport';
import type { DbSchemaSnapshot } from './schema';

export async function getCmpSchema(): Promise<DbSchemaSnapshot> {
  return (await request('GET', '/admin/cmp-schema', {
    impersonate: false, // always inspect as the real admin, never as an acted-as agent
  })) as DbSchemaSnapshot;
}
