/**
 * Comms analytics (/v1/comms/analytics) — the read-only figures behind the Desk Analytics & SLA tab.
 *
 * Internal-only with NO department requirement, for the same reason the ticket list is: the reader filter
 * inside `commsAnalyticsRepo.summary` already scopes every count to what this worker may see, and pinning a
 * department here would either lock a queue out of its own numbers or force one route per Mytrion. A
 * `department=` query param NARROWS within that gate; it can never widen it.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { commsAnalyticsRepo, type AnalyticsFilter } from '../../repos/commsAnalyticsRepo.js';
import { requireInternal } from './helpers.js';

const query = z.object({
  kind: z.enum(['ticket', 'request', 'escalation']).optional(),
  department: z.string().max(60).optional(),
  /** Trailing window for volume + resolution-time stats. */
  sinceDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function commsAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/comms/analytics', guard, async (request) => {
    const ctx = requireInternal(request, 'Comms analytics');
    const q = query.parse(request.query);
    const filter: AnalyticsFilter = {};
    if (q.kind) filter.kind = q.kind;
    if (q.department) filter.department = q.department;
    if (q.sinceDays) filter.sinceDays = q.sinceDays;
    return commsAnalyticsRepo.summary(ctx, filter);
  });
}
