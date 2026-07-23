/**
 * Verification DB schema (GET /v1/admin/verification-schema) — the live structure of the
 * credit_platform Postgres (tables, columns, data types, key roles, row estimates, last
 * vacuum/analyze activity) for the Admin "Verification DB" tab. Schema only, never row data.
 * Admin-only on the backend. Returns the shared DbSchemaSnapshot shape.
 */
import { request } from './transport';
import type { DbSchemaSnapshot } from './schema';

export async function getVerificationSchema(): Promise<DbSchemaSnapshot> {
  return (await request('GET', '/admin/verification-schema', {
    impersonate: false, // always inspect as the real admin, never as an acted-as agent
  })) as DbSchemaSnapshot;
}
