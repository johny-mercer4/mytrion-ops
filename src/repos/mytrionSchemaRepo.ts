/**
 * Read-only catalog access for Mytrion's own PostgreSQL database.
 *
 * This repository is the only runtime layer that touches the app database for schema inspection.
 * It reads pg_catalog/statistics only; no tenant row data is selected. A TenantContext is still
 * mandatory so callers cannot bypass the normal tenant-scoped repository boundary.
 */
import { pg } from '../db/client.js';
import { introspectPgSchema, type PgQueryRunner, type PgSchemaSnapshot } from '../modules/dbSchema/pgIntrospect.js';
import type { TenantContext } from '../types/tenantContext.js';

const catalogRunner: PgQueryRunner = {
  async query<T extends object>(text: string): Promise<T[]> {
    return pg.unsafe<T[]>(text);
  },
};

export const mytrionSchemaRepo = {
  async inspect(ctx: TenantContext): Promise<PgSchemaSnapshot> {
    if (!ctx.tenantId.trim()) throw new Error('Tenant context is required for schema inspection');
    return introspectPgSchema(catalogRunner, 'mytrion');
  },
};
