/**
 * Retention Phase-1 touchpoints (Sales Mytrion) — DB-backed local handlers over
 * retention_cases. Scoped to the caller's Zoho id via identityParam (admins may act-as).
 */
import { z } from 'zod';
import { env } from '../../../config/env.js';
import { getDwhCompanyDetails } from '../../../integrations/dwhCards.js';
import { AppError, NotFoundError, RBACError } from '../../../lib/errors.js';
import { retentionCasePhase1Repo } from '../../../repos/retentionCasePhase1Repo.js';
import { retentionCaseRepo } from '../../../repos/retentionCaseRepo.js';
import type { TenantContext } from '../../../types/tenantContext.js';
import {
  afterRetentionPhaseSideEffects,
  enrichHandoffWithRoundRobin,
  scheduleRetentionPostCommit,
} from '../../retention/csRoundRobin.js';
import { notifyOpenPoolOpened } from '../../retention/notify.js';
import { resolvePhase1Transition, type Phase1Outcome } from '../../retention/phase1.js';
import { RETENTION_PHASE } from '../../../db/schema/index.js';
import type { LocalTouchpoint } from '../types.js';
import { idString, limit as limitSchema } from './common.js';

const CHANNELS = [
  'telegram',
  'whatsapp',
  'sms',
  'ringcentral',
  'instagram',
  'facebook',
  'email',
] as const;

const DISSATISFACTION = [
  'low_discounts',
  'payment_cycle',
  'cs_service',
  'trust_issues',
  'switched_other',
] as const;

/** Agent-selectable outcomes — terminal `returned` (fuel again) is sync-only. */
const OUTCOMES = [
  'reached',
  'out_of_reach',
  'dissatisfied',
  'vacation',
  'no_action_2bd',
  'escalate_retention',
  'send_to_open_pool',
  'start_working',
  'ops_confirm_vacation',
  'ops_deny_vacation',
] as const satisfies readonly Exclude<Phase1Outcome, 'returned'>[];

function isAdmin(ctx: TenantContext): boolean {
  return ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess === true;
}

function zohoFromCtx(ctx: TenantContext): string | undefined {
  return ctx.userId.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : undefined;
}

/** Non-admins may only act on cases assigned to them. */
async function requireOwnedCase(ctx: TenantContext, caseId: string) {
  const row = await retentionCaseRepo.findById(ctx, caseId);
  if (!row) throw new NotFoundError('Retention case not found');
  if (row.phaseCode !== RETENTION_PHASE.agent) {
    throw new AppError('Case is with Customer Service (Retention / CITI) — Sales cannot act', {
      statusCode: 409,
      code: 'RETENTION_WRONG_PHASE',
      expose: true,
    });
  }
  if (!isAdmin(ctx)) {
    const self = zohoFromCtx(ctx);
    if (!self || row.assignedAgentZohoUserId !== self) {
      throw new RBACError('You can only act on retention cases assigned to you');
    }
  }
  return row;
}

const salesDept = ['sales'] as const;

export const retentionTouchpoints: LocalTouchpoint[] = [
  {
    kind: 'local',
    key: 'retention.my_cases',
    title: 'My retention cases (Phase 1)',
    riskClass: 'read',
    departments: salesDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      open: z.boolean().optional(),
      phase_code: z.string().max(80).optional(),
      limit: limitSchema(500, 200).optional(),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = String(params.zohoUserId ?? '');
      if (!zohoUserId) {
        throw new AppError('zohoUserId is required', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          expose: true,
        });
      }
      // Omit phase_code → all phases for this agent (New…Closed Kanban needs Dissatisfied/Closed).
      return retentionCasePhase1Repo.listForAgent(ctx, zohoUserId, {
        ...(typeof params.open === 'boolean' ? { open: params.open } : {}),
        ...(typeof params.phase_code === 'string' ? { phaseCode: params.phase_code } : {}),
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.case_get',
    title: 'Retention case detail + events',
    riskClass: 'read',
    departments: salesDept,
    paramsSchema: z.object({ caseId: idString }),
    handler: async (ctx, params) => {
      const caseId = String(params.caseId);
      const detail = await retentionCasePhase1Repo.getWithEvents(ctx, caseId);
      if (!detail) throw new NotFoundError('Retention case not found');
      // Open-pool: any sales agent may view (claim browse). Former owner may
      // view their locked Open Pool / Retention / CITI card (read-only).
      if (!isAdmin(ctx) && detail.case.statusCode !== 'p1_open_pool') {
        const self = zohoFromCtx(ctx);
        const assigned = self && detail.case.assignedAgentZohoUserId === self;
        const formerOwner =
          self &&
          detail.case.poolOwnerZohoUserId === self &&
          (detail.case.statusCode === 'p1_pool_claim_pending' ||
            detail.case.phaseCode === RETENTION_PHASE.retention ||
            detail.case.phaseCode === RETENTION_PHASE.citi);
        if (!assigned && !formerOwner) {
          throw new RBACError('You can only view retention cases assigned to you');
        }
      }
      // Prefer denormalized phone from sync; FE falls back to retention.case_contact if null.
      return { ...detail, contactPhone: detail.case.contactPhone ?? null };
    },
  },

  {
    kind: 'local',
    key: 'retention.case_contact',
    title: 'Retention case contact phone (DWH)',
    riskClass: 'read',
    departments: salesDept,
    paramsSchema: z.object({ caseId: idString }),
    handler: async (ctx, params) => {
      const caseId = String(params.caseId);
      const row = await retentionCaseRepo.findById(ctx, caseId);
      if (!row) throw new NotFoundError('Retention case not found');
      if (!isAdmin(ctx) && row.statusCode !== 'p1_open_pool') {
        const self = zohoFromCtx(ctx);
        const assigned = self && row.assignedAgentZohoUserId === self;
        const formerOwner =
          self &&
          row.poolOwnerZohoUserId === self &&
          (row.statusCode === 'p1_pool_claim_pending' ||
            row.phaseCode === RETENTION_PHASE.retention ||
            row.phaseCode === RETENTION_PHASE.citi);
        if (!assigned && !formerOwner) {
          throw new RBACError('You can only view retention cases assigned to you');
        }
      }
      if (!env.DWH_DATABASE_URL) return { contactPhone: null as string | null };
      try {
        const company = await getDwhCompanyDetails(row.carrierId);
        return { contactPhone: company?.phone ?? null };
      } catch {
        return { contactPhone: null as string | null };
      }
    },
  },

  {
    kind: 'local',
    key: 'retention.record_outcome',
    title: 'Record Phase 1 agent outcome',
    riskClass: 'write',
    departments: salesDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      caseId: idString,
      outcome: z.enum(OUTCOMES),
      dissatisfaction_reason: z.enum(DISSATISFACTION).optional(),
      reason_note: z.string().max(2000).optional(),
    }),
    handler: async (ctx, params) => {
      const caseId = String(params.caseId);
      const outcome = params.outcome as Phase1Outcome;
      const isOpsOutcome =
        outcome === 'ops_confirm_vacation' || outcome === 'ops_deny_vacation';
      let row;
      if (isOpsOutcome) {
        row = await retentionCaseRepo.findById(ctx, caseId);
        if (!row) throw new NotFoundError('Retention case not found');
        const self = zohoFromCtx(ctx);
        const opsId = env.RETENTION_OPS_MANAGER_ZOHO_USER_ID.trim();
        if (!isAdmin(ctx) && (!self || !opsId || self !== opsId)) {
          throw new RBACError('Only the Ops Manager (or admin) can confirm vacation');
        }
      } else {
        row = await requireOwnedCase(ctx, caseId);
      }
      let transition = resolvePhase1Transition(row, {
        outcome,
        dissatisfactionReason: params.dissatisfaction_reason as
          | (typeof DISSATISFACTION)[number]
          | undefined,
        reasonNote: typeof params.reason_note === 'string' ? params.reason_note : undefined,
      });
      if (transition.phaseCode === RETENTION_PHASE.retention) {
        transition = await enrichHandoffWithRoundRobin(ctx, transition, {
          isSpanishDesk: row.isSpanishDesk,
        });
      }
      const previousOwner = row.assignedAgentZohoUserId;
      const beforePhase = row.phaseCode;
      const updated = await retentionCaseRepo.update(ctx, caseId, {
        phaseCode: transition.phaseCode,
        statusCode: transition.statusCode,
        agentOutcome: transition.agentOutcome,
        ...(transition.dissatisfactionReason !== undefined
          ? { dissatisfactionReason: transition.dissatisfactionReason }
          : {}),
        ...(transition.reasonNote !== undefined ? { reasonNote: transition.reasonNote } : {}),
        ...(transition.vacationCountdownEnd !== undefined
          ? { vacationCountdownEnd: transition.vacationCountdownEnd }
          : {}),
        ...(transition.currentDeadlineAt !== undefined
          ? { currentDeadlineAt: transition.currentDeadlineAt }
          : {}),
        ...(transition.currentDeadlineType !== undefined
          ? { currentDeadlineType: transition.currentDeadlineType }
          : {}),
        ...(transition.assignedAgentZohoUserId !== undefined
          ? { assignedAgentZohoUserId: transition.assignedAgentZohoUserId }
          : {}),
        ...(transition.agentName !== undefined ? { agentName: transition.agentName } : {}),
        ...(transition.poolOwnerZohoUserId !== undefined
          ? { poolOwnerZohoUserId: transition.poolOwnerZohoUserId }
          : {}),
        ...(transition.pendingClaimantZohoUserId !== undefined
          ? { pendingClaimantZohoUserId: transition.pendingClaimantZohoUserId }
          : {}),
        ...(transition.outOfReachAttempts !== undefined
          ? { outOfReachAttempts: transition.outOfReachAttempts }
          : {}),
        ...(transition.citiFolderEnteredAt !== undefined
          ? { citiFolderEnteredAt: transition.citiFolderEnteredAt }
          : {}),
        ...(transition.citiFolderHoldUntil !== undefined
          ? { citiFolderHoldUntil: transition.citiFolderHoldUntil }
          : {}),
        eventType: transition.eventType,
        eventNotes: transition.eventNotes,
        actorZohoUserId: String(params.zohoUserId ?? zohoFromCtx(ctx) ?? ''),
      });
      if (!updated) throw new NotFoundError('Retention case not found');
      // Zoho ownership + inbox notify after response — do not block the Sales modal.
      scheduleRetentionPostCommit('retention.record_outcome', async () => {
        await afterRetentionPhaseSideEffects(beforePhase, updated, {
          previousAssigneeZohoUserId: previousOwner,
          tenantId: ctx.tenantId,
          actorZohoUserId: String(params.zohoUserId ?? zohoFromCtx(ctx) ?? ''),
        });
        if (updated.statusCode === 'p1_open_pool') {
          await notifyOpenPoolOpened(ctx, {
            caseId: updated.id,
            carrierId: updated.carrierId,
            companyName: updated.companyName,
            reason: updated.agentOutcome === 'reached' ? 'reached' : 'out_of_reach',
            previousOwnerZohoUserId: previousOwner,
            zohoDealId: updated.zohoDealId,
          });
        }
      });
      return { case: updated };
    },
  },

  {
    kind: 'local',
    key: 'retention.log_attempt',
    title: 'Log OoR channel attempt (1 BD each, max 5)',
    riskClass: 'write',
    departments: salesDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      caseId: idString,
      channel: z.enum(CHANNELS),
      notes: z.string().max(2000).optional(),
      /** Screenshot proof for non-RC channels (data URL or https). */
      evidence_url: z.string().max(1_800_000).optional(),
    }),
    handler: async (ctx, params) => {
      const caseId = String(params.caseId);
      await requireOwnedCase(ctx, caseId);
      const updated = await retentionCasePhase1Repo.logCommsAttempt(ctx, caseId, {
        channel: params.channel as (typeof CHANNELS)[number],
        notes: typeof params.notes === 'string' ? params.notes : undefined,
        evidenceUrl:
          typeof params.evidence_url === 'string' ? params.evidence_url : undefined,
        actorZohoUserId: String(params.zohoUserId ?? zohoFromCtx(ctx) ?? ''),
      });
      return { case: updated };
    },
  },

  {
    kind: 'local',
    key: 'retention.pool_list',
    title: 'Sales Open Pool cases',
    riskClass: 'read',
    departments: salesDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      limit: limitSchema(500, 200).optional(),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = String(params.zohoUserId ?? zohoFromCtx(ctx) ?? '');
      return retentionCasePhase1Repo.listOpenPool(ctx, {
        ...(typeof params.limit === 'number' ? { limit: params.limit } : {}),
        ...(zohoUserId
          ? {
              pendingForZohoUserId: zohoUserId,
              // Agents only see others' deals in Open Pool — never their own.
              excludePoolOwnerZohoUserId: zohoUserId,
            }
          : {}),
      });
    },
  },

  {
    kind: 'local',
    key: 'retention.pool_claim',
    title: 'Claim Open Pool deal (instant Zoho + Kanban New)',
    riskClass: 'write',
    departments: salesDept,
    identityParam: 'zohoUserId',
    agentNameParam: 'agentName',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
      agentName: z.string().max(200).optional(),
      caseId: idString,
      reason: z.string().min(1).max(2000),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = String(params.zohoUserId ?? '');
      if (!zohoUserId) {
        throw new AppError('zohoUserId is required', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          expose: true,
        });
      }
      const updated = await retentionCasePhase1Repo.claimFromPool(
        ctx,
        String(params.caseId),
        zohoUserId,
        {
          reason: String(params.reason),
          agentName: typeof params.agentName === 'string' ? params.agentName : undefined,
        },
      );
      return { case: updated, pendingApproval: false };
    },
  },

  {
    kind: 'local',
    key: 'retention.pool_quota',
    title: 'Open Pool daily claim quota (2/day)',
    riskClass: 'read',
    departments: salesDept,
    identityParam: 'zohoUserId',
    paramsSchema: z.object({
      zohoUserId: z.string().max(120).optional(),
    }),
    handler: async (ctx, params) => {
      const zohoUserId = String(params.zohoUserId ?? zohoFromCtx(ctx) ?? '');
      if (!zohoUserId) {
        throw new AppError('zohoUserId is required', {
          statusCode: 400,
          code: 'VALIDATION_ERROR',
          expose: true,
        });
      }
      const { getOpenPoolDailyQuota } = await import('../../retention/openPoolCaps.js');
      return getOpenPoolDailyQuota(ctx, zohoUserId);
    },
  },

  {
    kind: 'local',
    key: 'retention.lookups',
    title: 'Retention phases / statuses / enums',
    riskClass: 'read',
    departments: ['sales', 'customer-service'],
    paramsSchema: z.object({
      phase_code: z.string().max(80).optional(),
    }),
    handler: async (_ctx, params) => {
      const phaseCode =
        typeof params.phase_code === 'string' ? params.phase_code : undefined;
      const [phases, statuses] = await Promise.all([
        retentionCaseRepo.listPhases(),
        retentionCaseRepo.listStatuses(phaseCode),
      ]);
      return {
        phases,
        statuses,
        channels: CHANNELS,
        dissatisfactionReasons: DISSATISFACTION,
        outcomes: OUTCOMES,
      };
    },
  },
];
