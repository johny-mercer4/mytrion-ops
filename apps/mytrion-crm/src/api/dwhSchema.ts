/**
 * DWH schema (GET /v1/admin/dwh-schema) — the live structure of the Data Warehouse Postgres across
 * ALL schemas (schemas, tables, columns, data types, key roles, row estimates, last vacuum/analyze
 * activity) for the Admin developer tab. Schema only, never row data. Admin-only on the backend.
 * Returns the shared DbSchemaSnapshot shape, with `schemas` + per-table `schema` populated.
 */
import { request } from './transport';
import type { DbSchemaSnapshot } from './schema';

export async function getDwhSchema(): Promise<DbSchemaSnapshot> {
  return (await request('GET', '/admin/dwh-schema', {
    impersonate: false, // always inspect as the real admin, never as an acted-as agent
  })) as DbSchemaSnapshot;
}
