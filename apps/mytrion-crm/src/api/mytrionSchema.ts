/**
 * Mytrion database metadata (GET /v1/admin/mytrion-schema). The backend only reads PostgreSQL
 * catalog/statistics views and requires the real Admin identity (never View-as).
 */
import { request } from './transport';
import type { DbSchemaSnapshot } from './schema';

export async function getMytrionSchema(): Promise<DbSchemaSnapshot> {
  return (await request('GET', '/admin/mytrion-schema', {
    impersonate: false,
  })) as DbSchemaSnapshot;
}
