/**
 * Mytrion Watch — behavioural scoring for existing carriers.
 *
 * VERIFICATION-gated: this lives inside the Verification Mytrion, beside new-applicant
 * underwriting. Reads come from OUR snapshot table, never the warehouse, so the desk is fast and
 * still renders when the DWH is unavailable.
 *
 * Re-scoring is a write and is admin-only: it hits a shared analytics database and rewrites a
 * dated snapshot, which is not something a queue view should be able to trigger by accident.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { watchService } from '../../modules/mytrionWatch/watchService.js';
import { WATCH_BANDS } from '../../db/schema/mytrion_watch.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireWatchRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Mytrion Watch');
}
function requireWatchWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Mytrion Watch');
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  band: z.enum(WATCH_BANDS).optional(),
  movement: z.enum(['worsened', 'improved']).optional(),
  search: z.string().trim().min(1).max(120).optional(),
  scoringDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'scoringDate must be YYYY-MM-DD')
    .optional(),
});

const carrierParams = z.object({ carrierId: z.string().trim().min(1).max(64) });

const runBody = z.object({
  scoringDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'scoringDate must be YYYY-MM-DD')
    .optional(),
  carrierId: z.string().trim().min(1).max(64).optional(),
});

export async function mytrionWatchRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/watch/scores', auth, async (request) => {
    const ctx = requireWatchRead(request);
    return watchService.queue(ctx, listQuery.parse(request.query));
  });

  app.get<{ Params: { carrierId: string } }>(
    '/verification/watch/scores/:carrierId',
    auth,
    async (request) => {
      const ctx = requireWatchRead(request);
      const { carrierId } = carrierParams.parse(request.params);
      return watchService.carrier(ctx, carrierId);
    },
  );

  app.get('/verification/watch/runs', auth, async (request) => {
    const ctx = requireWatchRead(request);
    return { runs: await watchService.runs(ctx) };
  });

  /**
   * Re-score. Admin-only as a preHandler so the check cannot be skipped by an early return, and
   * because a full run queries a shared analytics database for several seconds.
   */
  app.post(
    '/verification/watch/run',
    { onRequest: [app.authenticate], preHandler: [app.requireRole('admin')] },
    async (request) => {
      const ctx = requireWatchWrite(request);
      const body = runBody.parse(request.body ?? {});
      const result = await watchService.runScoring(ctx, {
        trigger: 'manual',
        ...(body.scoringDate ? { scoringDate: body.scoringDate } : {}),
        ...(body.carrierId ? { carrierId: body.carrierId } : {}),
      });
      await auditFromContext(ctx, {
        action: 'mytrion_watch.scoring_run',
        status: 'ok',
        resourceType: 'mytrion_watch_run',
        resourceId: result.scoringDate,
        detail: {
          scored: result.scored,
          durationMs: result.durationMs,
          carrierId: body.carrierId ?? null,
          unmatchedFeatures: result.unmatchedFeatures,
        },
      });
      return result;
    },
  );
}
