import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { AppError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { getVerificationSchema } from '../../modules/verificationSchema/service.js';
import { requireContext } from './helpers.js';

/**
 * Verification DB schema inspector for the Mytrion Admin "Verification DB" developer tab.
 *
 * GET /v1/admin/verification-schema — the live structure (schemas, tables, columns, data types,
 * key roles, row estimates, last vacuum/analyze activity) of the credit_platform Postgres, read
 * from pg_catalog only. Never returns table data. Same "true admin" gate as the DWH/CMP schema
 * inspectors (allDepartmentAccess on the internal audience).
 */
export async function verificationSchemaRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = {
    onRequest: [app.authenticate],
    preHandler: [app.requireAudience('internal')],
  };

  app.get('/admin/verification-schema', guard, async (request) => {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      await auditFromContext(ctx, {
        action: 'admin.verification_schema.read',
        status: 'denied',
        resourceType: 'verification_schema',
      });
      throw new RBACError('Admin (all-department) access required to inspect the Verification DB schema.');
    }

    let snapshot;
    try {
      snapshot = await getVerificationSchema();
    } catch (err) {
      // A configuration gap (503) is the service's own AppError — surface as-is. Anything else means
      // the DB is unreachable: report 502 without leaking internals.
      if (err instanceof AppError) throw err;
      await auditFromContext(ctx, {
        action: 'admin.verification_schema.read',
        status: 'error',
        resourceType: 'verification_schema',
      });
      throw new AppError('Verification DB is unavailable.', {
        statusCode: 502,
        code: 'VERIFICATION_DB_UNAVAILABLE',
        cause: err,
      });
    }

    await auditFromContext(ctx, {
      action: 'admin.verification_schema.read',
      status: 'ok',
      resourceType: 'verification_schema',
      detail: { database: snapshot.database, schemas: snapshot.schemas.length, tables: snapshot.tableCount },
    });
    return snapshot;
  });
}
