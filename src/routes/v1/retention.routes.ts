/**
 * Retention setup (/v1/retention) — CRUD over the single retention_cases entity plus the
 * on-demand auto-generation trigger. Reads and case-work writes require the 'retention'
 * department (or admin / all-department access). Verified sessions derive departments from
 * the Zoho profile/role server-side; only unverified API-key callers may pass departments
 * via x-department-access. Destructive ops (delete) and the DWH sync trigger are admin-only.
 * Every write is audited. Mutations ship POST aliases only (Zoho-proxy-safe), matching the
 * carrier-users convention.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { syncRetentionCases } from '../../modules/retention/retentionSync.js';
import { env } from '../../config/env.js';
import { retentionCaseRepo, toRetentionCaseDto } from '../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, requireDepartment } from './helpers.js';

const idString = z.union([z.string().max(120), z.number()]).transform(String);

const PHASES = ['sales', 'retention', 'open_pool', 'citi'] as const;
const STAGES = [
  'inactive_no_reason',
  'inactive_reason_noted',
  'out_of_reach',
  'pending',
  'assigned_to_agent',
] as const;
const OUTCOMES = [
  'returned',
  'saved',
  'refused_offer',
  'out_of_business',
  'no_response',
  'lost',
] as const;
const POOL_ASSIGNMENTS = ['available', 'requested', 'assigned', 'rejected'] as const;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  phase: z.enum(PHASES).optional(),
  status: z.enum(['open', 'closed']).optional(),
  stage: z.enum(STAGES).optional(),
  carrier_id: z.string().max(120).optional(),
});

const createSchema = z.object({
  carrier_id: idString,
  company_name: z.string().max(300).optional(),
  application_id: idString.optional(),
  agent_name: z.string().max(200).optional(),
  agent_zoho_user_id: idString.optional(),
  phase: z.enum(PHASES).default('sales'),
  stage: z.enum(STAGES).default('inactive_no_reason'),
  inactivity_reason: z.string().max(200).optional(),
  reason_note: z.string().max(2000).optional(),
});

const updateSchema = z
  .object({
    phase: z.enum(PHASES).optional(),
    stage: z.enum(STAGES).optional(),
    status: z.enum(['open', 'closed']).optional(),
    outcome: z.enum(OUTCOMES).nullable().optional(),
    inactivity_reason: z.string().max(200).nullable().optional(),
    reason_note: z.string().max(2000).nullable().optional(),
    out_of_reach_attempts: z.coerce.number().int().min(0).max(100).optional(),
    pool_assignment: z.enum(POOL_ASSIGNMENTS).nullable().optional(),
    pool_taken_by: z.string().max(200).nullable().optional(),
    agent_name: z.string().max(200).nullable().optional(),
    agent_zoho_user_id: idString.nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

const syncSchema = z.object({
  lookback_days: z.coerce.number().int().min(3).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

/**
 * Case-work gate: retention department, all-department access, or admin. Verified sessions
 * are session-authoritative (departments derived from the Zoho profile/role); the
 * x-department-access header is only trusted for unverified API-key callers.
 */
function requireRetentionAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'retention', 'Retention cases');
}

/** Destructive/system gate: admin or the static API key only. */
function requireAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.role !== 'admin' && !ctx.bypassRbac) {
    throw new RBACError('This retention operation requires admin access');
  }
  return ctx;
}

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/retention/cases', guard, async (request) => {
    const ctx = requireRetentionAccess(request);
    const query = listQuerySchema.parse(request.query);
    return retentionCaseRepo.list(ctx, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.phase ? { phase: query.phase } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.carrier_id ? { carrierId: query.carrier_id } : {}),
    });
  });

  app.get('/retention/cases/:id', guard, async (request) => {
    const ctx = requireRetentionAccess(request);
    const { id } = request.params as { id: string };
    const row = await retentionCaseRepo.findById(ctx, id);
    if (!row) throw new NotFoundError('Retention case not found');
    return { case: toRetentionCaseDto(row) };
  });

  /** Manual case creation (auto-generation is the primary path — see /retention/sync). */
  app.post('/retention/cases', guard, async (request, reply) => {
    const ctx = requireRetentionAccess(request);
    const body = createSchema.parse(request.body);
    const created = await retentionCaseRepo.create(ctx, {
      carrierId: body.carrier_id,
      companyName: body.company_name,
      applicationId: body.application_id,
      agentName: body.agent_name,
      agentZohoUserId: body.agent_zoho_user_id,
      phase: body.phase,
      stage: body.stage,
      inactivityReason: body.inactivity_reason,
      reasonNote: body.reason_note,
      source: 'manual',
    });
    await auditFromContext(ctx, {
      action: 'retention.case.create',
      status: 'ok',
      resourceType: 'retention_case',
      resourceId: created.id,
      detail: { carrierId: created.carrierId, phase: created.phase, stage: created.stage },
    });
    return reply.code(201).send({ case: created });
  });

  /** Partial update — phase/stage moves, reasons, outcomes, open-pool state. */
  app.post('/retention/cases/:id', guard, async (request) => {
    const ctx = requireRetentionAccess(request);
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const updated = await retentionCaseRepo.update(ctx, id, {
      ...(body.phase !== undefined ? { phase: body.phase } : {}),
      ...(body.stage !== undefined ? { stage: body.stage } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.outcome !== undefined ? { outcome: body.outcome } : {}),
      ...(body.inactivity_reason !== undefined
        ? { inactivityReason: body.inactivity_reason }
        : {}),
      ...(body.reason_note !== undefined ? { reasonNote: body.reason_note } : {}),
      ...(body.out_of_reach_attempts !== undefined
        ? { outOfReachAttempts: body.out_of_reach_attempts }
        : {}),
      ...(body.pool_assignment !== undefined ? { poolAssignment: body.pool_assignment } : {}),
      ...(body.pool_taken_by !== undefined ? { poolTakenBy: body.pool_taken_by } : {}),
      ...(body.agent_name !== undefined ? { agentName: body.agent_name } : {}),
      ...(body.agent_zoho_user_id !== undefined
        ? { agentZohoUserId: body.agent_zoho_user_id }
        : {}),
    });
    if (!updated) throw new NotFoundError('Retention case not found');
    await auditFromContext(ctx, {
      action: 'retention.case.update',
      status: 'ok',
      resourceType: 'retention_case',
      resourceId: id,
      detail: {
        fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
      },
    });
    return { case: updated };
  });

  app.post('/retention/cases/:id/delete', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const removed = await retentionCaseRepo.deleteById(ctx, id);
    if (!removed) throw new NotFoundError('Retention case not found');
    await auditFromContext(ctx, {
      action: 'retention.case.delete',
      status: 'ok',
      resourceType: 'retention_case',
      resourceId: id,
    });
    return { deleted: true, id };
  });

  /**
   * Run auto-generation now (the nightly cron runs the same sync). Scans the DWH for
   * frequency breaches, creates/refreshes cases, and closes returned clients.
   */
  app.post('/retention/sync', guard, async (request) => {
    const ctx = requireAdmin(request);
    if (!env.DWH_DATABASE_URL) {
      throw new AppError('The data warehouse is not configured (DWH_DATABASE_URL)', {
        statusCode: 503,
        code: 'DWH_UNCONFIGURED',
        expose: true,
      });
    }
    const body = syncSchema.parse(request.body ?? {});
    try {
      const summary = await syncRetentionCases(ctx, {
        lookbackDays: body.lookback_days,
        limit: body.limit,
      });
      await auditFromContext(ctx, {
        action: 'retention.sync',
        status: 'ok',
        resourceType: 'retention_case',
        detail: { ...summary },
      });
      return { summary };
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError('Data warehouse query failed', {
        statusCode: 502,
        code: 'DWH_ERROR',
        cause: err,
        expose: true,
      });
    }
  });
}
