import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pingDb } from '../../db/client.js';
import { registerAllWrappers } from '../../integrations/core/registerAll.js';
import { wrapperHealthAll } from '../../integrations/core/registry.js';
import { RBACError } from '../../lib/errors.js';
import { requireContext } from './helpers.js';

const integrationsQuery = z.object({
  // live=1 runs each wrapper's cheap probe (SELECT 1 / ping). Off by default: Zoho probes
  // cost API credits and readiness checks must stay cheap.
  live: z.coerce.boolean().optional(),
});

/** Readiness probe (DB-aware) at GET /v1/health. The liveness probe is GET /health. */
export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async () => {
    let db = false;
    try {
      db = await pingDb();
    } catch {
      db = false;
    }
    return { ok: db, db, time: new Date().toISOString() };
  });

  /**
   * Per-vendor wrapper health (admin/API-key only — reveals which integrations are configured).
   * Default reports configured-only; `?live=1` runs the cheap probes. Never throws per-wrapper —
   * failures land in that wrapper's `ok:false` + `detail`.
   */
  app.get('/health/integrations', { onRequest: [app.sessionOrApiKey] }, async (request) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) {
      throw new RBACError('Integration health requires admin access');
    }
    const q = integrationsQuery.parse(request.query);
    registerAllWrappers();
    const integrations = await wrapperHealthAll(q.live ? { live: true } : {});
    return { integrations, live: Boolean(q.live), time: new Date().toISOString() };
  });
}
