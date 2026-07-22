/**
 * Customer Service Retention touchpoints — Phase 2 desk, CITI Folder, Open Pool (read-only).
 * Open Pool claim approve/decline lives on Sales (prior owner), not CS.
 */
import { z } from 'zod';
import { AppError } from '../../../lib/errors.js';
import {
  CS_DESK_FILTERS,
  CS_DESK_PHASES,
  CS_DESK_STATUSES,
  retentionCaseCsRepo,
  type CsDeskFilter,
  type CsDeskPhase,
  type CsDeskStatus,
} from '../../../repos/retentionCaseCsRepo.js';
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
] as const satisfies readonly Phase2Outcome[];

function zohoFromCtx(ctx: TenantContext): string | undefined {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : undefined;
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

export const retentionCsTouchpoints: LocalTouchpoint[] = [
  {
    kind: 'local',
    key: 'retention.cs_pool_list',
    title: 'CS Open Pool view (read-only — no claim)',
    riskClass: 'read',
    departments: csDept,
    paramsSchema: z.object({
      limit: limitSchema(500, 200).optional(),
    }),
    handler: async (ctx, params) => {
      // Full pool visibility (available + claim-pending); CS cannot claim or approve.
      return retentionCaseCsRepo.listForCs(ctx, {
        filter: 'open_pool',
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
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
      return retentionCaseCsRepo.listForCs(ctx, {
        ...(typeof params.filter === 'string'
          ? { filter: params.filter as CsDeskFilter }
          : {}),
        ...(typeof params.phase === 'string' ? { phase: params.phase as CsDeskPhase } : {}),
        ...(typeof params.status === 'string' ? { status: params.status as CsDeskStatus } : {}),
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
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
