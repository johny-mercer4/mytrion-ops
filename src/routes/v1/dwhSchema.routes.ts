import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { getDwhSchema } from '../../modules/dwhSchema/service.js';
import { requireContext } from './helpers.js';

/**
 * Data Warehouse schema inspector for the Mytrion Admin "Data Warehouse" developer tab.
 *
 * GET /v1/admin/dwh-schema — returns the live structure (schemas, tables, columns, data types,
 * key roles, row estimates, last vacuum/analyze activity) of the DWH Postgres across ALL schemas,
 * read from pg_catalog only. Never returns table data. Same "true admin" gate as the CMP schema
 * inspector (allDepartmentAccess on the internal audience).
 */
export async function dwhSchemaRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = {
    onRequest: [app.authenticate],
    preHandler: [app.requireAudience('internal')],
  };

  app.get('/admin/dwh-schema', guard, async (request) => {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      await auditFromContext(ctx, {
        action: 'admin.dwh_schema.read',
        status: 'denied',
        resourceType: 'dwh_schema',
      });
      throw new RBACError('Admin (all-department) access required to inspect the DWH schema.');
    }

    let snapshot;
    try {
      snapshot = await getDwhSchema();
    } catch (err) {
      // A configuration gap (503) is the service's own AppError — surface as-is. Anything else means
      // the DWH is unreachable: report 502 without leaking internals.
      if (err instanceof AppError) throw err;
      await auditFromContext(ctx, {
        action: 'admin.dwh_schema.read',
        status: 'error',
        resourceType: 'dwh_schema',
      });
      throw new AppError('Data Warehouse is unavailable.', {
        statusCode: 502,
        code: 'DWH_UNAVAILABLE',
        cause: err,
      });
    }

    await auditFromContext(ctx, {
      action: 'admin.dwh_schema.read',
      status: 'ok',
      resourceType: 'dwh_schema',
      detail: { database: snapshot.database, schemas: snapshot.schemas.length, tables: snapshot.tableCount },
    });
    return snapshot;
  });
}
