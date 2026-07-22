/**
 * DWH schema introspection — a read-only, live view of the Data Warehouse Postgres (`dwh`,
 * integrations/dwh.ts) for the Mytrion Admin "Data Warehouse" developer tab. Delegates to the
 * shared pg_catalog introspector (modules/dbSchema/pgIntrospect) so the DWH and Verification-DB
 * tabs return the identical snapshot shape. Reads pg_catalog only — never table data.
 */
import { dwh } from '../../integrations/dwh.js';
import { AppError } from '../../lib/errors.js';
import { introspectPgSchema, type PgSchemaSnapshot } from '../dbSchema/pgIntrospect.js';

export type DwhSchemaSnapshot = PgSchemaSnapshot;

export async function getDwhSchema(): Promise<DwhSchemaSnapshot> {
  if (!dwh.isConfigured()) {
    throw new AppError('Data Warehouse is not configured.', {
      statusCode: 503,
      code: 'DWH_UNCONFIGURED',
    });
  }
  return introspectPgSchema(dwh, 'dwh');
}
