import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, NotFoundError, RBACError } from '../../lib/errors.js';
import { getAnalyticsSnapshot } from '../../modules/analytics/cache.js';
import { resolveMytrionUsageWindow } from '../../modules/analytics/mytrionUsageDates.js';
import { getSalesMytrionUsage } from '../../modules/analytics/mytrionUsageService.js';
import {
  ANALYTICS_DATE_RANGES,
  type AnalyticsFilters,
} from '../../modules/analytics/filters.js';
import { isReportId, listReports } from '../../modules/analytics/reports/definitions.js';
import { runAnalyticsReport } from '../../modules/analytics/reports/service.js';
import { isAnalyticsDimension } from '../../modules/analytics/types.js';
import { requireContext, requireDepartment } from './helpers.js';

const paramsSchema = z.object({ dimension: z.string().min(1).max(40) });
const reportParamsSchema = z.object({ reportId: z.string().min(1).max(40) });
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
const mytrionUsageQuerySchema = z.object({
  fresh: z.enum(['0', '1']).optional(),
  range: z.enum(['today', 'last_7_days', 'this_month', 'custom']).optional(),
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

  /**
   * Reports are management-only.
   *
   * They are cross-agent extracts — an org-wide fuel-volume or client-health sheet is every
   * carrier's book in one file, which is a different exposure from the per-agent dashboards. Same
   * gate as the Manager Mytrion (`requireDepartment(…, 'management')`): admin / all-department /
   * bypass / the `management` department. Hiding the sidebar card is NOT the boundary; this is.
   *
   * Note this composes with "View as": an admin acting as a sales rep runs with the REP's grant and
   * loses report access, which is the point of impersonation — you see what they see.
   */
  const requireReportsAccess = (request: Parameters<typeof requireContext>[0]) =>
    requireDepartment(request, 'management', 'Analytics reports');

  /** The standing report catalog — static metadata, no warehouse hit. */
  app.get('/analytics/reports', guard, async (request) => {
    requireReportsAccess(request);
    return { reports: listReports() };
  });

  /**
   * Run one standing report for a date window (and the caller's agent scope) and return its rows.
   * The CRM turns this into an .xlsx client-side; keeping the endpoint JSON means the same data is
   * available to any other consumer without a file-format dependency here.
   */
  app.get('/analytics/reports/:reportId', guard, async (request) => {
    const { reportId } = reportParamsSchema.parse(request.params);
    const q = querySchema.parse(request.query);
    // Authorize BEFORE resolving the id or checking config: if an unknown id 404'd first, an
    // unauthorized caller could enumerate the catalog by status code (404 = no such report,
    // 403 = real one they cannot have). Everyone unauthorized gets the same 403.
    const ctx = requireReportsAccess(request);
    if (!isReportId(reportId)) throw new NotFoundError(`Unknown report: ${reportId}`);
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('Analytics DWH is not configured', {
        statusCode: 503,
        code: 'ANALYTICS_UNCONFIGURED',
      });
    }

    const filters = resolveFilters(ctx, q);
    try {
      return await runAnalyticsReport(reportId, filters);
    } catch (err) {
      const causeMsg = err instanceof Error ? err.message : String(err);
      request.log.error({ err, causeMsg, reportId, filters }, 'analytics report failed');
      throw new AppError(
        causeMsg.includes('does not exist') ? `Report query failed: ${causeMsg}` : 'Report source unavailable',
        { statusCode: 502, code: 'ANALYTICS_DWH_ERROR', cause: err, expose: true },
      );
    }
  });

  /** Internal product-usage analytics: verified session plus Analytics department/admin access. */
  app.get('/analytics/mytrion/sales', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireDepartment(request, 'analytics', 'Mytrion usage analytics');
    const q = mytrionUsageQuerySchema.parse(request.query);
    const window = resolveMytrionUsageWindow({
      ...(q.range ? { preset: q.range } : {}),
      ...(q.from ? { from: q.from } : {}),
      ...(q.to ? { to: q.to } : {}),
    });
    try {
      return await getSalesMytrionUsage(ctx, window, q.fresh === '1');
    } catch (error) {
      request.log.error({ err: error }, 'Sales Mytrion usage snapshot failed');
      if (error instanceof AppError) throw error;
      throw new AppError('Mytrion usage analytics are unavailable', {
        statusCode: 503,
        code: 'MYTRION_USAGE_UNAVAILABLE',
        cause: error,
        expose: true,
      });
    }
  });

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
export function resolveFilters(
  ctx: { userId: string; allDepartmentAccess?: boolean; role?: string; bypassRbac?: boolean },
  q: z.infer<typeof querySchema>,
): AnalyticsFilters {
  const elevated =
    ctx.allDepartmentAccess === true || ctx.role === 'admin' || ctx.bypassRbac === true;
  const selfId = ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null;

  let agentId = q.agent?.trim() || null;
  let agentName = q.agent_name?.trim() || null;

  if (!elevated && !selfId) {
    throw new RBACError('Analytics require a verified Zoho worker identity');
  }
  if (!elevated && selfId) {
    // A worker always sees only their own book, including when they omit every agent filter.
    agentId = selfId;
    // A caller-supplied name must not survive beside the forced id and accidentally narrow the
    // result to another person's display name in a dimension that supports name fallback.
    agentName = null;
  }

  const filters: AnalyticsFilters = {};
  if (agentId) filters.agentId = agentId;
  if (agentName) filters.agentName = agentName;
  if (q.range) filters.range = q.range;
  if (q.from) filters.from = q.from;
  if (q.to) filters.to = q.to;
  return filters;
}
