/**
 * Retention setup (/v1/retention) — CRUD over retention_cases (v2 workflow) plus lookup
 * lists and the on-demand DWH sync trigger. Reads and case-work writes require the
 * 'retention' department (or admin / all-department access). Delete + sync are admin-only.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { notifyCaseCreated } from '../../modules/retention/notify.js';
import { syncRetentionCases } from '../../modules/retention/retentionSync.js';
import { env } from '../../config/env.js';
import { retentionCaseRepo, toRetentionCaseDto } from '../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, requireDepartment } from './helpers.js';

const idString = z.union([z.string().max(120), z.number()]).transform(String);

const PHASE_CODES = ['phase_1_agent', 'phase_2_retention', 'phase_3_citi'] as const;
const AGENT_OUTCOMES = [
  'out_of_reach',
  'returned',
  'dissatisfied',
  'vacation',
  'no_action_2bd',
] as const;
const DISSATISFACTION = [
  'low_discounts',
  'payment_cycle',
  'cs_service',
  'trust_issues',
  'switched_other',
] as const;

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  phase_code: z.string().max(80).optional(),
  status_code: z.string().max(80).optional(),
  open: z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true' || v === '1')),
  carrier_id: z.string().max(120).optional(),
});

const createSchema = z.object({
  carrier_id: idString,
  zoho_deal_id: idString.optional(),
  company_name: z.string().max(300).optional(),
  application_id: idString.optional(),
  agent_name: z.string().max(200).optional(),
  assigned_agent_zoho_user_id: idString.optional(),
  phase_code: z.enum(PHASE_CODES).default('phase_1_agent'),
  status_code: z.string().max(80).default('p1_new'),
  dissatisfaction_reason: z.enum(DISSATISFACTION).optional(),
  reason_note: z.string().max(2000).optional(),
});

const updateSchema = z
  .object({
    phase_code: z.enum(PHASE_CODES).optional(),
    status_code: z.string().max(80).optional(),
    agent_outcome: z.enum(AGENT_OUTCOMES).nullable().optional(),
    dissatisfaction_reason: z.enum(DISSATISFACTION).nullable().optional(),
    reason_note: z.string().max(2000).nullable().optional(),
    assigned_agent_zoho_user_id: idString.nullable().optional(),
    assignment_count: z.coerce.number().int().min(1).max(3).optional(),
    open_pool_attempt_count: z.coerce.number().int().min(0).max(20).optional(),
    out_of_reach_attempts: z.coerce.number().int().min(0).max(5).optional(),
    deal_owner_changed: z.boolean().optional(),
    current_deadline_at: z.string().datetime().nullable().optional(),
    current_deadline_type: z.string().max(80).nullable().optional(),
    vacation_countdown_end: z.string().datetime().nullable().optional(),
    citi_folder_entered_at: z.string().datetime().nullable().optional(),
    citi_folder_hold_until: z.string().datetime().nullable().optional(),
    last_review_cycle_at: z.string().datetime().nullable().optional(),
    sales_manager_zoho_user_id: idString.nullable().optional(),
    agent_name: z.string().max(200).nullable().optional(),
    zoho_deal_id: idString.nullable().optional(),
    event_type: z.string().max(80).optional(),
    event_notes: z.string().max(2000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

const syncSchema = z.object({
  lookback_days: z.coerce.number().int().min(3).max(365).optional(),
  limit: z.coerce.number().int().min(1).max(2000).optional(),
});

function requireRetentionAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'retention', 'Retention cases');
}

function requireAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.role !== 'admin' && !ctx.bypassRbac) {
    throw new RBACError('This retention operation requires admin access');
  }
  return ctx;
}

function actorZohoUserId(ctx: TenantContext): string | undefined {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : undefined;
}

function parseOptionalDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

export async function retentionRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/retention/phases', guard, async (request) => {
    requireRetentionAccess(request);
    return { phases: await retentionCaseRepo.listPhases() };
  });

  app.get('/retention/statuses', guard, async (request) => {
    requireRetentionAccess(request);
    const q = z.object({ phase_code: z.string().max(80).optional() }).parse(request.query);
    return { statuses: await retentionCaseRepo.listStatuses(q.phase_code) };
  });

  app.get('/retention/cases', guard, async (request) => {
    const ctx = requireRetentionAccess(request);
    const query = listQuerySchema.parse(request.query);
    return retentionCaseRepo.list(ctx, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.phase_code ? { phaseCode: query.phase_code } : {}),
      ...(query.status_code ? { statusCode: query.status_code } : {}),
      ...(query.open !== undefined ? { open: query.open } : {}),
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

  app.post('/retention/cases', guard, async (request, reply) => {
    const ctx = requireRetentionAccess(request);
    const body = createSchema.parse(request.body);
    const created = await retentionCaseRepo.create(ctx, {
      carrierId: body.carrier_id,
      zohoDealId: body.zoho_deal_id,
      companyName: body.company_name,
      applicationId: body.application_id,
      agentName: body.agent_name,
      assignedAgentZohoUserId: body.assigned_agent_zoho_user_id,
      phaseCode: body.phase_code,
      statusCode: body.status_code,
      dissatisfactionReason: body.dissatisfaction_reason,
      reasonNote: body.reason_note,
      source: 'manual',
      actorZohoUserId: actorZohoUserId(ctx),
    });
    await notifyCaseCreated(ctx, {
      caseId: created.id,
      carrierId: created.carrierId,
      companyName: created.companyName,
      assignedAgentZohoUserId: created.assignedAgentZohoUserId,
      daysInactive: created.daysInactive,
      thresholdDays: created.thresholdDays,
    });
    await auditFromContext(ctx, {
      action: 'retention.case.create',
      status: 'ok',
      resourceType: 'retention_case',
      resourceId: created.id,
      detail: {
        carrierId: created.carrierId,
        phaseCode: created.phaseCode,
        statusCode: created.statusCode,
      },
    });
    return reply.code(201).send({ case: created });
  });

  app.post('/retention/cases/:id', guard, async (request) => {
    const ctx = requireRetentionAccess(request);
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const updated = await retentionCaseRepo.update(ctx, id, {
      ...(body.phase_code !== undefined ? { phaseCode: body.phase_code } : {}),
      ...(body.status_code !== undefined ? { statusCode: body.status_code } : {}),
      ...(body.agent_outcome !== undefined ? { agentOutcome: body.agent_outcome } : {}),
      ...(body.dissatisfaction_reason !== undefined
        ? { dissatisfactionReason: body.dissatisfaction_reason }
        : {}),
      ...(body.reason_note !== undefined ? { reasonNote: body.reason_note } : {}),
      ...(body.assigned_agent_zoho_user_id !== undefined
        ? { assignedAgentZohoUserId: body.assigned_agent_zoho_user_id }
        : {}),
      ...(body.assignment_count !== undefined ? { assignmentCount: body.assignment_count } : {}),
      ...(body.open_pool_attempt_count !== undefined
        ? { openPoolAttemptCount: body.open_pool_attempt_count }
        : {}),
      ...(body.out_of_reach_attempts !== undefined
        ? { outOfReachAttempts: body.out_of_reach_attempts }
        : {}),
      ...(body.deal_owner_changed !== undefined
        ? { dealOwnerChanged: body.deal_owner_changed }
        : {}),
      ...(body.current_deadline_at !== undefined
        ? { currentDeadlineAt: parseOptionalDate(body.current_deadline_at) }
        : {}),
      ...(body.current_deadline_type !== undefined
        ? { currentDeadlineType: body.current_deadline_type }
        : {}),
      ...(body.vacation_countdown_end !== undefined
        ? { vacationCountdownEnd: parseOptionalDate(body.vacation_countdown_end) }
        : {}),
      ...(body.citi_folder_entered_at !== undefined
        ? { citiFolderEnteredAt: parseOptionalDate(body.citi_folder_entered_at) }
        : {}),
      ...(body.citi_folder_hold_until !== undefined
        ? { citiFolderHoldUntil: parseOptionalDate(body.citi_folder_hold_until) }
        : {}),
      ...(body.last_review_cycle_at !== undefined
        ? { lastReviewCycleAt: parseOptionalDate(body.last_review_cycle_at) }
        : {}),
      ...(body.sales_manager_zoho_user_id !== undefined
        ? { salesManagerZohoUserId: body.sales_manager_zoho_user_id }
        : {}),
      ...(body.agent_name !== undefined ? { agentName: body.agent_name } : {}),
      ...(body.zoho_deal_id !== undefined ? { zohoDealId: body.zoho_deal_id } : {}),
      ...(body.event_type !== undefined ? { eventType: body.event_type } : {}),
      ...(body.event_notes !== undefined ? { eventNotes: body.event_notes } : {}),
      actorZohoUserId: actorZohoUserId(ctx),
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
