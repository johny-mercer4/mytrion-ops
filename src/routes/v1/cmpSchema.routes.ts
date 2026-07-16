import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { getCmpSchema } from '../../modules/cmpSchema/service.js';
import { requireContext } from './helpers.js';

/**
 * CMP database schema inspector for the Mytrion Admin "CMP Database" developer tab.
 *
 * GET /v1/admin/cmp-schema — returns the live structure (tables, columns, data types, approximate
 * row counts, last-write times) of the external CMP MySQL, read from `information_schema` only.
 * Never returns table data. Gated to real admins (allDepartmentAccess) on the internal audience —
 * the same "true admin" bar as /admin/agents, because it reveals the full internal schema.
 */
export async function cmpSchemaRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = {
    onRequest: [app.authenticate],
    preHandler: [app.requireAudience('internal')],
  };

  app.get('/admin/cmp-schema', guard, async (request) => {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      await auditFromContext(ctx, {
        action: 'admin.cmp_schema.read',
        status: 'denied',
        resourceType: 'cmp_schema',
      });
      throw new RBACError('Admin (all-department) access required to inspect the CMP schema.');
    }

    let snapshot;
    try {
      snapshot = await getCmpSchema();
    } catch (err) {
      // A configuration gap (503) is the service's own AppError — surface it as-is. Anything else is
      // the DB being unreachable (tunnel down / RDS unavailable): report 502, don't leak internals.
      if (err instanceof AppError) throw err;
      await auditFromContext(ctx, {
        action: 'admin.cmp_schema.read',
        status: 'error',
        resourceType: 'cmp_schema',
      });
      throw new AppError('CMP database is unavailable.', {
        statusCode: 502,
        code: 'CMP_DB_UNAVAILABLE',
        cause: err,
      });
    }

    await auditFromContext(ctx, {
      action: 'admin.cmp_schema.read',
      status: 'ok',
      resourceType: 'cmp_schema',
      detail: { database: snapshot.database, tables: snapshot.tableCount },
    });
    return snapshot;
  });
}
