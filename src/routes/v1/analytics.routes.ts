import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { getAnalyticsSnapshot } from '../../modules/analytics/cache.js';
import { isAnalyticsDimension } from '../../modules/analytics/types.js';

const paramsSchema = z.object({ dimension: z.string().min(1).max(40) });
const querySchema = z.object({
  /** fresh=1 bypasses the snapshot cache (the dashboard's Refresh button). */
  fresh: z.enum(['0', '1']).optional(),
});

/**
 * Live analytics snapshots for the dashboard (and anything else that wants them). Served from
 * the 2h snapshot cache — a normal GET never touches the DWH when the cache is warm. Internal
 * workers only: customer (carrier-client) sessions are denied by audience.
 */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const guard = {
    onRequest: [app.sessionOrApiKey],
    preHandler: [app.requireAudience('internal')],
  };

  app.get('/analytics/:dimension', guard, async (request) => {
    const { dimension } = paramsSchema.parse(request.params);
    const { fresh } = querySchema.parse(request.query);
    if (!isAnalyticsDimension(dimension)) {
      throw new NotFoundError(`Unknown analytics dimension: ${dimension}`);
    }
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('Analytics DWH is not configured', {
        statusCode: 503,
        code: 'ANALYTICS_UNCONFIGURED',
      });
    }
    try {
      return await getAnalyticsSnapshot(dimension, { force: fresh === '1' });
    } catch (err) {
      throw new AppError('Analytics source unavailable', {
        statusCode: 502,
        code: 'ANALYTICS_DWH_ERROR',
        cause: err,
      });
    }
  });
}
