import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { RBACError } from '../../lib/errors.js';
import { addCalendarDays, reportingDate } from '../../modules/kpi/time.js';
import {
  KPI_ADMIN_TABLES,
  kpiAdminRepo,
} from '../../repos/kpiAdminRepo.js';
import { kpiMappingRepo } from '../../repos/kpiMappingRepo.js';
import { kpiRepo } from '../../repos/kpiRepo.js';
import { requireContext } from './helpers.js';

const rangeSchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
});

const factsQuerySchema = rangeSchema.extend({
  source: z.string().trim().min(1).max(80).optional(),
  metricKey: z.string().trim().min(1).max(100).optional(),
  workerId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function requireKpiAdmin(request: FastifyRequest) {
  const ctx = requireContext(request);
  if (
    ctx.audience !== 'internal' ||
    (!ctx.allDepartmentAccess && !ctx.bypassRbac && ctx.role !== 'admin')
  ) {
    throw new RBACError('Mytrion Admin access is required for KPI data');
  }
  return ctx;
}

export async function kpiAdminRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/admin/kpi/overview', guard, async (request) => {
    const ctx = requireKpiAdmin(request);
    const query = rangeSchema.parse(request.query ?? {});
    const bounds = await kpiAdminRepo.dateBounds(ctx);
    const today = reportingDate(new Date(), env.KPI_REPORTING_TZ);
    const to = query.to ?? bounds.to ?? today;
    const from = query.from ?? bounds.from ?? addCalendarDays(to, -29);
    const [counts, metrics, ingestionRuns, unresolvedWorkerMappings] =
      await Promise.all([
        kpiAdminRepo.tableCounts(ctx),
        kpiAdminRepo.aggregateMetrics(ctx, from, to),
        kpiAdminRepo.ingestionRuns(ctx, 200),
        kpiMappingRepo.listUnresolved(ctx, 500),
      ]);
    return {
      enabled: env.FF_KPI_COLLECTION_ENABLED,
      reportingTimezone: env.KPI_REPORTING_TZ,
      range: { from, to, availableFrom: bounds.from, availableTo: bounds.to },
      tables: KPI_ADMIN_TABLES.map((table) => ({
        ...table,
        rowCount: counts[table.name] ?? 0,
      })),
      metrics,
      ingestionRuns,
      unresolvedWorkerMappings,
    };
  });

  app.get('/admin/kpi/workers', guard, async (request) => {
    const ctx = requireKpiAdmin(request);
    return { workers: await kpiAdminRepo.workers(ctx) };
  });

  app.get('/admin/kpi/workers/:workerId/daily', guard, async (request) => {
    const ctx = requireKpiAdmin(request);
    const workerId = z
      .string()
      .min(1)
      .parse((request.params as { workerId?: string }).workerId);
    const range = rangeSchema
      .required({ from: true, to: true })
      .parse(request.query ?? {});
    return {
      days: await kpiRepo.listDaily(ctx, workerId, range.from, range.to),
    };
  });

  app.get('/admin/kpi/workers/:workerId/monthly', guard, async (request) => {
    const ctx = requireKpiAdmin(request);
    const workerId = z
      .string()
      .min(1)
      .parse((request.params as { workerId?: string }).workerId);
    return { snapshots: await kpiRepo.listMonthly(ctx, workerId) };
  });

  app.get('/admin/kpi/facts', guard, async (request) => {
    const ctx = requireKpiAdmin(request);
    const query = factsQuerySchema.parse(request.query ?? {});
    return {
      facts: await kpiAdminRepo.facts(ctx, {
        ...(query.source !== undefined ? { source: query.source } : {}),
        ...(query.metricKey !== undefined ? { metricKey: query.metricKey } : {}),
        ...(query.workerId !== undefined ? { workerId: query.workerId } : {}),
        ...(query.from !== undefined ? { from: query.from } : {}),
        ...(query.to !== undefined ? { to: query.to } : {}),
        ...(query.limit !== undefined ? { limit: query.limit } : {}),
        ...(query.offset !== undefined ? { offset: query.offset } : {}),
      }),
    };
  });
}
