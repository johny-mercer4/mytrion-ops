import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { getAnalyticsSnapshot } from '../../modules/analytics/cache.js';
import {
  ANALYTICS_DATE_RANGES,
  type AnalyticsFilters,
} from '../../modules/analytics/filters.js';
import { isAnalyticsDimension } from '../../modules/analytics/types.js';
import { requireContext } from './helpers.js';

const paramsSchema = z.object({ dimension: z.string().min(1).max(40) });
const querySchema = z.object({
  /** fresh=1 bypasses the snapshot cache (the dashboard's Refresh button). */
  fresh: z.enum(['0', '1']).optional(),
  /** Zoho user id — scopes KPIs/trend/breakdown/leaderboard to that agent's book. */
  agent: z.string().min(1).max(120).optional(),
  agent_name: z.string().min(1).max(200).optional(),
  range: z.enum(ANALYTICS_DATE_RANGES).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

/**
 * Live analytics snapshots for the dashboard (and anything else that wants them).
 * Unfiltered (org MTD): ~2h snapshot cache / warmer. Filtered (agent / date): ~5min cache with
 * in-flight dedupe so filter switches don't stampede the shared DWH pool. `fresh=1` bypasses
 * both. Internal workers only: customer (carrier-client) sessions are denied by audience.
 */
export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  const guard = {
    onRequest: [app.sessionOrApiKey],
    preHandler: [app.requireAudience('internal')],
  };

  app.get('/analytics/:dimension', guard, async (request) => {
    const { dimension } = paramsSchema.parse(request.params);
    const q = querySchema.parse(request.query);
    if (!isAnalyticsDimension(dimension)) {
      throw new NotFoundError(`Unknown analytics dimension: ${dimension}`);
    }
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('Analytics DWH is not configured', {
        statusCode: 503,
        code: 'ANALYTICS_UNCONFIGURED',
      });
    }

    const ctx = requireContext(request);
    const filters = resolveFilters(ctx, q);

    try {
      return await getAnalyticsSnapshot(dimension, { force: q.fresh === '1', filters });
    } catch (err) {
      const causeMsg = err instanceof Error ? err.message : String(err);
      request.log.error({ err, causeMsg, dimension, filters }, 'analytics DWH compute failed');
      throw new AppError(
        causeMsg.includes('does not exist')
          ? `Analytics query failed: ${causeMsg}`
          : 'Analytics source unavailable',
        {
          statusCode: 502,
          code: 'ANALYTICS_DWH_ERROR',
          cause: err,
          expose: true,
        },
      );
    }
  });
}

/**
 * Non-admins with a Zoho session are locked to their own book — they cannot inspect another
 * agent's numbers via query params. API-key / system callers (no zoho: userId) keep the requested
 * agent filter as-is (trusted server-to-server).
 */
function resolveFilters(
  ctx: { userId: string; allDepartmentAccess?: boolean; role?: string; bypassRbac?: boolean },
  q: z.infer<typeof querySchema>,
): AnalyticsFilters {
  const elevated =
    ctx.allDepartmentAccess === true || ctx.role === 'admin' || ctx.bypassRbac === true;
  const selfId = ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null;

  let agentId = q.agent?.trim() || null;
  const agentName = q.agent_name?.trim() || null;

  if (!elevated && selfId && (agentId || agentName)) {
    // May request a filter, but only for their own book — never another agent's.
    agentId = selfId;
  }

  const filters: AnalyticsFilters = {};
  if (agentId) filters.agentId = agentId;
  if (agentName) filters.agentName = agentName;
  if (q.range) filters.range = q.range;
  if (q.from) filters.from = q.from;
  if (q.to) filters.to = q.to;
  return filters;
}
