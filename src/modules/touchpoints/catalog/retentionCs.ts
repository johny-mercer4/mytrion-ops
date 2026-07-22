/**
 * Customer Service Retention touchpoints — Open Pool activity logs, Phase 2 desk, CITI Folder.
 */
import { z } from 'zod';
import { AppError, RBACError } from '../../../lib/errors.js';
import {
  CS_DESK_FILTERS,
  CS_DESK_PHASES,
  CS_DESK_STATUSES,
  retentionCaseCsRepo,
  type CsDeskFilter,
  type CsDeskPhase,
  type CsDeskStatus,
} from '../../../repos/retentionCaseCsRepo.js';
import { retentionPoolClaimRepo } from '../../../repos/retentionPoolClaimRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import type { Phase2Outcome } from '../../retention/phase2.js';
import type { LocalTouchpoint } from '../types.js';
import { idString, limit as limitSchema } from './common.js';

const csDept = ['customer-service'] as const;

const CHANNELS = [
  'telegram',
  'whatsapp',
  'sms',
  'ringcentral',
  'instagram',
  'facebook',
  'email',
] as const;

const P2_OUTCOMES = [
  'claim',
  'start_working',
  'mark_pending',
  'saved',
  'refused',
  'out_of_business',
  'escalate_citi',
] as const satisfies readonly Exclude<Phase2Outcome, 'no_response'>[];

function zohoFromCtx(ctx: TenantContext): string | undefined {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : undefined;
}

function isAdmin(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess === true;
}

function requireZoho(params: Record<string, unknown>, ctx: TenantContext): string {
  const zohoUserId = String(params.zohoUserId ?? zohoFromCtx(ctx) ?? '');
  if (!zohoUserId) {
    throw new AppError('zohoUserId is required', {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      expose: true,
    });
  }
  return zohoUserId;
}

/**
 * Non-admins only see cases assigned to them (Open Pool stays shared).
 * Returns `null` for admin (no filter). Missing Zoho id → empty desk (fail closed).
 */
function assigneeScope(ctx: TenantContext): string | null {
  if (isAdmin(ctx)) return null;
  return zohoFromCtx(ctx) ?? '';
}

export const retentionCsTouchpoints: LocalTouchpoint[] = [
  {
    kind: 'local',
    key: 'retention.cs_pool_activity',
    title: 'CS Open Pool activity (claimed + unclaimed logs)',
    riskClass: 'read',
    departments: csDept,
    paramsSchema: z.object({
      limit: limitSchema(500, 100).optional(),
      status: z.enum(['approved', 'expired', 'all']).optional(),
    }),
    handler: async (ctx, params) => {
      return retentionPoolClaimRepo.listPoolActivity(ctx, {
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
        ...(typeof params.status === 'string'
          ? { status: params.status as 'approved' | 'expired' | 'all' }
          : {}),
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_cases',
    title: 'CS Retention cases (all phases)',
    riskClass: 'read',
    departments: csDept,
    paramsSchema: z.object({
      filter: z.enum(CS_DESK_FILTERS).optional(),
      phase: z.enum(CS_DESK_PHASES).optional(),
      status: z.enum(CS_DESK_STATUSES).optional(),
      limit: limitSchema(500, 200).optional(),
    }),
    handler: async (ctx, params) => {
      const mine = assigneeScope(ctx);
      // Non-admin without Zoho identity — empty list (not all records).
      if (mine === '') return { cases: [], total: 0 };
      return retentionCaseCsRepo.listForCs(ctx, {
        ...(typeof params.filter === 'string'
          ? { filter: params.filter as CsDeskFilter }
          : {}),
        ...(typeof params.phase === 'string' ? { phase: params.phase as CsDeskPhase } : {}),
        ...(typeof params.status === 'string' ? { status: params.status as CsDeskStatus } : {}),
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
        ...(mine != null ? { assignedAgentZohoUserId: mine } : {}),
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_desk_quota',
    title: 'CS Retention daily + pending portfolio quota',
    riskClass: 'read',
    departments: csDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = requireZoho(params, ctx);
      const {
        countCsAssignmentsToday,
        getCsPortfolioCounts,
        canAddPending,
        CS_MAX_DEALS_PER_DAY,
        CS_MAX_PENDING_RATIO,
      } = await import('../../retention/csCaps.js');
      const [assignedToday, portfolio] = await Promise.all([
        countCsAssignmentsToday(ctx, zohoUserId),
        getCsPortfolioCounts(ctx, zohoUserId),
      ]);
      return {
        zohoUserId,
        assignedToday,
        maxPerDay: CS_MAX_DEALS_PER_DAY,
        pending: portfolio.pending,
        open: portfolio.open,
        pendingRatio: portfolio.pendingRatio,
        maxPendingRatio: CS_MAX_PENDING_RATIO,
        canClaim: assignedToday < CS_MAX_DEALS_PER_DAY,
        canMarkPending: canAddPending(portfolio.pending, portfolio.open),
      };
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_case_get',
    title: 'CS Retention case detail',
    riskClass: 'read',
    departments: csDept,
    paramsSchema: z.object({ caseId: idString }),
    handler: async (ctx, params) => {
      const detail = await retentionCaseCsRepo.getWithEvents(ctx, String(params.caseId));
      if (!detail) {
        throw new AppError('Retention case not found', {
          statusCode: 404,
          code: 'NOT_FOUND',
          expose: true,
        });
      }
      const mine = assigneeScope(ctx);
      const inOpenPool =
        detail.case.statusCode === 'p1_open_pool' ||
        detail.case.statusCode === 'p1_pool_claim_pending';
      if (
        mine != null &&
        !inOpenPool &&
        (mine === '' || detail.case.assignedAgentZohoUserId?.trim() !== mine)
      ) {
        throw new RBACError('You can only view retention cases assigned to you');
      }
      return detail;
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_case_outcome',
    title: 'CS Phase 2 outcome',
    riskClass: 'write',
    departments: csDept,
    identityParam: 'zohoUserId',
    agentNameParam: 'agentName',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      agentName: z.string().max(200).optional(),
      caseId: idString,
      outcome: z.enum(P2_OUTCOMES),
      notes: z.string().max(2000).optional(),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = requireZoho(params, ctx);
      const updated = await retentionCaseCsRepo.recordPhase2Outcome(
        ctx,
        String(params.caseId),
        params.outcome as Phase2Outcome,
        {
          actorZohoUserId: zohoUserId,
          agentName: typeof params.agentName === 'string' ? params.agentName : undefined,
          notes: typeof params.notes === 'string' ? params.notes : undefined,
        },
      );
      return { case: updated };
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_log_attempt',
    title: 'CS log contact attempt on Retention case',
    riskClass: 'write',
    departments: csDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      caseId: idString,
      channel: z.enum(CHANNELS),
      notes: z.string().max(2000).optional(),
      evidence_url: z.string().max(1_800_000).optional(),
      call_role: z.enum(['listen', 'solution']).optional(),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = requireZoho(params, ctx);
      const updated = await retentionCaseCsRepo.logAttempt(ctx, String(params.caseId), {
        channel: params.channel as (typeof CHANNELS)[number],
        notes: typeof params.notes === 'string' ? params.notes : undefined,
        evidenceUrl:
          typeof params.evidence_url === 'string' ? params.evidence_url : undefined,
        actorZohoUserId: zohoUserId,
        callRole:
          params.call_role === 'listen' || params.call_role === 'solution'
            ? params.call_role
            : undefined,
      });
      return { case: updated };
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_citi_list',
    title: 'CS CITI Folder cases',
    riskClass: 'read',
    departments: csDept,
    paramsSchema: z.object({
      limit: limitSchema(500, 200).optional(),
      status_code: z.string().max(40).optional(),
    }),
    handler: async (ctx, params) => {
      return retentionCaseCsRepo.listCitiFolder(ctx, {
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
        ...(typeof params.status_code === 'string'
          ? { statusCode: params.status_code }
          : {}),
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_citi_confirm',
    title: 'CS confirm CITI batch for review',
    riskClass: 'write',
    departments: csDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      caseIds: z.array(idString).min(1).max(100),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = requireZoho(params, ctx);
      const caseIds = params.caseIds as string[];
      return retentionCaseCsRepo.confirmCitiBatch(ctx, caseIds, {
        actorZohoUserId: zohoUserId,
        salesManagerZohoUserId: zohoUserId,
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_citi_export',
    title: 'CS export CITI batch (CSV + CRM stage)',
    riskClass: 'write',
    departments: csDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      caseIds: z.array(idString).min(1).max(100),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = requireZoho(params, ctx);
      const caseIds = params.caseIds as string[];
      return retentionCaseCsRepo.exportCitiBatch(ctx, caseIds, {
        actorZohoUserId: zohoUserId,
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.cs_citi_mark_sent',
    title: 'CS mark CITI batch sent (close)',
    riskClass: 'write',
    departments: csDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      caseIds: z.array(idString).min(1).max(100),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = requireZoho(params, ctx);
      const caseIds = params.caseIds as string[];
      return retentionCaseCsRepo.markCitiBatchSent(ctx, caseIds, {
        actorZohoUserId: zohoUserId,
      });
    },
  },
];
