/**
 * Mytrion database schema service. Runtime catalog reads stay behind the tenant-scoped repository;
 * the route owns the true-admin gate and audit trail.
 */
import { mytrionSchemaRepo } from '../../repos/mytrionSchemaRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { PgSchemaSnapshot } from '../dbSchema/pgIntrospect.js';

export type MytrionSchemaSnapshot = PgSchemaSnapshot;

export function getMytrionSchema(ctx: TenantContext): Promise<MytrionSchemaSnapshot> {
  return mytrionSchemaRepo.inspect(ctx);
}
