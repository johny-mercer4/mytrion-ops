import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { getMytrionSchema } from '../../modules/mytrionSchema/service.js';
import { requireContext } from './helpers.js';

/**
 * GET /v1/admin/mytrion-schema
 *
 * Live, read-only metadata for Mytrion's own PostgreSQL: schemas, relations, columns/API names,
 * SQL types, keys, row estimates, and pg_stat-derived update frequency. No table rows are read.
 */
export async function mytrionSchemaRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = {
    onRequest: [app.authenticate],
    preHandler: [app.requireAudience('internal')],
  };

  app.get('/admin/mytrion-schema', guard, async (request) => {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      await auditFromContext(ctx, {
        action: 'admin.mytrion_schema.read',
        status: 'denied',
        resourceType: 'mytrion_schema',
      });
      throw new RBACError('Admin (all-department) access required to inspect the Mytrion database schema.');
    }

    let snapshot;
    try {
      snapshot = await getMytrionSchema(ctx);
    } catch (err) {
      await auditFromContext(ctx, {
        action: 'admin.mytrion_schema.read',
        status: 'error',
        resourceType: 'mytrion_schema',
      });
      throw new AppError('Mytrion database metadata is unavailable.', {
        statusCode: 502,
        code: 'MYTRION_SCHEMA_UNAVAILABLE',
        cause: err,
      });
    }

    await auditFromContext(ctx, {
      action: 'admin.mytrion_schema.read',
      status: 'ok',
      resourceType: 'mytrion_schema',
      detail: {
        database: snapshot.database,
        schemas: snapshot.schemas.length,
        tables: snapshot.tableCount,
        columns: snapshot.columnCount,
      },
    });
    return snapshot;
  });
}
