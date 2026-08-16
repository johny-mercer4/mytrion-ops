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
import { carrierInvoices } from '../../modules/mytrionWatch/invoiceContext.js';
import { triggerCatalogJob } from '../../modules/jobs/adminTrigger.js';
import { mytrionWatchScoringJob } from '../../modules/jobs/catalog.js';
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

  /**
   * Open invoices for a carrier — a LIVE warehouse read, on its own route.
   *
   * Separate from the carrier detail on purpose: the rest of the desk reads our snapshot and never
   * touches the DWH. If the warehouse is slow or down, this panel fails alone rather than taking the
   * score with it.
   */
  app.get<{ Params: { carrierId: string } }>(
    '/verification/watch/scores/:carrierId/invoices',
    auth,
    async (request) => {
      const ctx = requireWatchRead(request);
      void ctx;
      const { carrierId } = carrierParams.parse(request.params);
      return carrierInvoices(carrierId);
    },
  );

  app.get('/verification/watch/runs', auth, async (request) => {
    const ctx = requireWatchRead(request);
    return { runs: await watchService.runs(ctx) };
  });

  /**
   * Re-score the book — the same work the daily cron does.
   *
   * ENQUEUES the job rather than running it inline. A full run takes ~77 seconds against the
   * warehouse, and the previous version awaited it inside the request: any button wired to that
   * would hit the proxy timeout and report failure while the run carried on to completion. The
   * queue is a singleton, so two agents pressing this at once collapse into one run.
   *
   * Gated on verification WRITE, not admin: refreshing the desk you are reading is a desk action,
   * and the singleton policy is what makes it safe to expose.
   */
  app.post('/verification/watch/run', auth, async (request, reply) => {
    const ctx = requireWatchWrite(request);
    const body = runBody.parse(request.body ?? {});
    const job = await triggerCatalogJob(mytrionWatchScoringJob.name, {
      trigger: 'manual',
      ...(body.scoringDate ? { scoringDate: body.scoringDate } : {}),
    });
    await auditFromContext(ctx, {
      action: 'mytrion_watch.scoring_run',
      status: 'ok',
      resourceType: 'mytrion_watch_run',
      resourceId: body.scoringDate ?? 'today',
      detail: { jobId: job.jobId, queue: job.name },
    });
    // 202: accepted, not done. The desk polls the run row for completion.
    return reply.code(202).send({ queued: true, jobId: job.jobId });
  });
}
