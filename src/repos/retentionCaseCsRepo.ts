/**
 * Customer Service Retention desk — all-phase case browse + Phase 2 actions + CITI Folder.
 */
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  RETENTION_PHASE,
  retentionCaseEvents,
  retentionCases,
  type CommunicationChannel,
} from '../db/schema/index.js';
import { AppError, NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { patchToUpdateInput } from '../modules/retention/deadlines.js';
import {
  resolvePhase2Transition,
  type Phase2Outcome,
} from '../modules/retention/phase2.js';
import { setDealAssignmentStageCiti } from '../modules/retention/zohoOwnership.js';
import type { TenantContext } from '../types/tenantContext.js';
import {
  appendRetentionEvent,
  retentionCaseRepo,
  toRetentionCaseDto,
  toRetentionCaseEventDto,
  type RetentionCaseDto,
  type RetentionCaseEventDto,
} from './retentionCaseRepo.js';

/** Phase 2 desk status buckets (claim / outcomes only apply in Retention phase). */
const P2_STATUS = {
  new: ['p2_new'] as const,
  working: ['p2_working', 'p2_handoff_citi'] as const,
  offerPending: ['p2_offer_pending'] as const,
  closed: [
    'p2_saved',
    'p2_refused',
    'p2_lost',
    'p2_out_of_business',
    'p2_no_response',
  ] as const,
  open: ['p2_new', 'p2_working', 'p2_offer_pending', 'p2_handoff_citi'] as const,
} as const;

const P1_STATUS = {
  calling: ['p1_new', 'p1_in_progress', 'p1_pool_assigned'] as const,
  reached: ['p1_reached'] as const,
  outOfReach: ['p1_out_of_reach'] as const,
  openPool: ['p1_open_pool', 'p1_pool_claim_pending'] as const,
  vacation: ['p1_vacation', 'p1_vacation_followup', 'p1_awaiting_ops'] as const,
} as const;

const CITI_OPEN = ['p3_hold', 'p3_review'] as const;

/**
 * Legacy flat filters (still accepted). Prefer phase + status.
 */
export const CS_DESK_FILTERS = [
  'all_open',
  'all',
  'sales',
  'retention',
  'citi',
  'new',
  'working',
  'closed',
] as const;

export type CsDeskFilter = (typeof CS_DESK_FILTERS)[number];
/** @deprecated Use CsDeskFilter — kept for existing imports. */
export type CsPhase2Filter = CsDeskFilter;

export const CS_DESK_PHASES = ['any', 'sales', 'retention', 'citi'] as const;
export type CsDeskPhase = (typeof CS_DESK_PHASES)[number];

export const CS_DESK_STATUSES = [
  'open',
  'closed',
  'all',
  'to_claim',
  'working',
  'offer_pending',
  'calling',
  'reached',
  'out_of_reach',
  'open_pool',
  'vacation',
  'hold',
  'review',
] as const;
export type CsDeskStatus = (typeof CS_DESK_STATUSES)[number];

const CLOSED_LOOKBACK = sql`${retentionCases.closedAt} >= now() - interval '90 days'`;

function phaseClause(phase: CsDeskPhase): SQL | null {
  if (phase === 'sales') return eq(retentionCases.phaseCode, RETENTION_PHASE.agent);
  if (phase === 'retention') return eq(retentionCases.phaseCode, RETENTION_PHASE.retention);
  if (phase === 'citi') return eq(retentionCases.phaseCode, RETENTION_PHASE.citi);
  return null;
}

function deskQueryClauses(phase: CsDeskPhase, status: CsDeskStatus): SQL[] {
  const out: SQL[] = [];
  const pc = phaseClause(phase);
  if (pc) out.push(pc);

  if (status === 'all') {
    out.push(
      sql`(${retentionCases.closedAt} IS NULL OR ${retentionCases.closedAt} >= now() - interval '90 days')`,
    );
    return out;
  }
  if (status === 'closed') {
    out.push(sql`${retentionCases.closedAt} IS NOT NULL`, CLOSED_LOOKBACK);
    return out;
  }

  out.push(isNull(retentionCases.closedAt));

  if (status === 'open') {
    if (phase === 'retention') out.push(inArray(retentionCases.statusCode, [...P2_STATUS.open]));
    if (phase === 'citi') out.push(inArray(retentionCases.statusCode, [...CITI_OPEN]));
    return out;
  }

  if (phase === 'retention') {
    if (status === 'to_claim') out.push(inArray(retentionCases.statusCode, [...P2_STATUS.new]));
    else if (status === 'working') out.push(inArray(retentionCases.statusCode, [...P2_STATUS.working]));
    else if (status === 'offer_pending') {
      out.push(inArray(retentionCases.statusCode, [...P2_STATUS.offerPending]));
    }
    return out;
  }

  if (phase === 'sales') {
    if (status === 'calling') out.push(inArray(retentionCases.statusCode, [...P1_STATUS.calling]));
    else if (status === 'reached') out.push(inArray(retentionCases.statusCode, [...P1_STATUS.reached]));
    else if (status === 'out_of_reach') {
      out.push(inArray(retentionCases.statusCode, [...P1_STATUS.outOfReach]));
    } else if (status === 'open_pool') {
      out.push(inArray(retentionCases.statusCode, [...P1_STATUS.openPool]));
    } else if (status === 'vacation') {
      out.push(inArray(retentionCases.statusCode, [...P1_STATUS.vacation]));
    }
    return out;
  }

  if (phase === 'citi') {
    if (status === 'hold') out.push(eq(retentionCases.statusCode, 'p3_hold'));
    else if (status === 'review') out.push(eq(retentionCases.statusCode, 'p3_review'));
    return out;
  }

  return out;
}

/** Map legacy flat filter → phase/status. */
function legacyToPhaseStatus(filter: CsDeskFilter): { phase: CsDeskPhase; status: CsDeskStatus } {
  switch (filter) {
    case 'all_open':
      return { phase: 'any', status: 'open' };
    case 'all':
      return { phase: 'any', status: 'all' };
    case 'sales':
      return { phase: 'sales', status: 'open' };
    case 'retention':
      return { phase: 'retention', status: 'open' };
    case 'citi':
      return { phase: 'citi', status: 'open' };
    case 'new':
      return { phase: 'retention', status: 'to_claim' };
    case 'working':
      return { phase: 'retention', status: 'working' };
    case 'closed':
      return { phase: 'any', status: 'closed' };
    default:
      return { phase: 'any', status: 'open' };
  }
}

function deskFilterClauses(filter: CsDeskFilter): SQL[] {
  const { phase, status } = legacyToPhaseStatus(filter);
  return deskQueryClauses(phase, status);
}

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export const retentionCaseCsRepo = {
  /**
   * CS browse — any phase (details via getWithEvents). Write actions remain Phase 2-gated.
   * Prefer `phase` + `status`; legacy `filter` still works.
   */
  async listForCs(
    ctx: TenantContext,
    opts: {
      filter?: CsDeskFilter;
      phase?: CsDeskPhase;
      status?: CsDeskStatus;
      limit?: number;
      /**
       * When set, restrict to this assignee (CS agent desk).
       * Open Pool (`sales` + `open_pool`) stays shared — no assignee filter.
       */
      assignedAgentZohoUserId?: string;
    } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const resolved =
      opts.phase != null || opts.status != null
        ? {
            phase: opts.phase ?? 'any',
            status: opts.status ?? 'open',
          }
        : legacyToPhaseStatus(opts.filter ?? 'all_open');
    const isOpenPool =
      resolved.phase === 'sales' && resolved.status === 'open_pool';
    const assignee = opts.assignedAgentZohoUserId?.trim();
    const clauses = [
      eq(retentionCases.tenantId, ctx.tenantId),
      ...deskQueryClauses(resolved.phase, resolved.status),
      ...(assignee && !isOpenPool
        ? [eq(retentionCases.assignedAgentZohoUserId, assignee)]
        : []),
    ];
    const where = and(...clauses);
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.gallons90d), desc(retentionCases.updatedAt))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
  },

  /** @deprecated Prefer listForCs — same implementation. */
  async listPhase2(
    ctx: TenantContext,
    opts: { filter?: CsDeskFilter; limit?: number } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    return this.listForCs(ctx, opts);
  },

  async recordPhase2Outcome(
    ctx: TenantContext,
    id: string,
    outcome: Phase2Outcome,
    opts: {
      actorZohoUserId: string;
      agentName?: string | undefined;
      notes?: string | undefined;
    },
  ): Promise<RetentionCaseDto> {
    const existing = await retentionCaseRepo.findById(ctx, id);
    if (!existing) throw new NotFoundError('Retention case not found');

    const {
      assertUnderDailyCap,
      assertPendingCap,
      assertTwoCallComplete,
    } = await import('../modules/retention/csCaps.js');

    if (outcome === 'claim' || outcome === 'start_working') {
      await assertUnderDailyCap(ctx, opts.actorZohoUserId);
    } else if (!existing.assignedAgentZohoUserId?.trim()) {
      throw new AppError('Claim this case before setting a status', {
        statusCode: 409,
        code: 'RETENTION_UNASSIGNED',
        expose: true,
      });
    }
    if (outcome === 'mark_pending') {
      const agent = existing.assignedAgentZohoUserId ?? opts.actorZohoUserId;
      await assertPendingCap(ctx, agent, {
        alreadyPending: existing.statusCode === 'p2_offer_pending',
      });
    }
    if (outcome === 'saved' || outcome === 'refused') {
      await assertTwoCallComplete(existing.id);
    }

    const patch = resolvePhase2Transition(existing, outcome, {
      actorZohoUserId: opts.actorZohoUserId,
      ...(opts.agentName !== undefined ? { agentName: opts.agentName } : {}),
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    });
    const input = {
      ...patchToUpdateInput(patch, opts.actorZohoUserId),
      ...(opts.agentName?.trim() && (outcome === 'claim' || outcome === 'start_working')
        ? { agentName: opts.agentName.trim() }
        : {}),
    };
    const updated = await retentionCaseRepo.update(ctx, id, input);
    if (!updated) throw new NotFoundError('Retention case not found');
    const { afterRetentionPhaseSideEffects } = await import(
      '../modules/retention/csRoundRobin.js'
    );
    await afterRetentionPhaseSideEffects(existing.phaseCode, updated, {
      previousAssigneeZohoUserId: existing.assignedAgentZohoUserId,
      tenantId: ctx.tenantId,
      actorZohoUserId: opts.actorZohoUserId,
      actorName: opts.agentName ?? null,
    });
    // Out of Business → Zoho Deal Stage Closed Lost (exclude from future retention).
    if (updated.statusCode === 'p2_out_of_business' && updated.zohoDealId) {
      const { setDealStageClosedLost } = await import('../modules/retention/zohoOwnership.js');
      await setDealStageClosedLost(updated.zohoDealId);
    }
    if (updated.statusCode === 'p1_open_pool') {
      const { notifyOpenPoolOpened } = await import('../modules/retention/notify.js');
      await notifyOpenPoolOpened(ctx, {
        caseId: updated.id,
        carrierId: updated.carrierId,
        companyName: updated.companyName,
        reason: 'phase2',
        previousOwnerZohoUserId: existing.assignedAgentZohoUserId,
        zohoDealId: updated.zohoDealId,
      });
    }
    return updated;
  },

  /** Phase 2 contact attempt — audit only (does not drive OoR → Pool). */
  async logAttempt(
    ctx: TenantContext,
    id: string,
    input: {
      channel: CommunicationChannel;
      notes?: string | undefined;
      evidenceUrl?: string | undefined;
      actorZohoUserId?: string | undefined;
      /** Two-call rule role (Call 1 listen / Call 2 solution). */
      callRole?: 'listen' | 'solution' | undefined;
    },
  ): Promise<RetentionCaseDto> {
    const existing = await retentionCaseRepo.findById(ctx, id);
    if (!existing) throw new NotFoundError('Retention case not found');
    if (existing.closedAt != null) {
      throw new AppError('Case is already closed', {
        statusCode: 409,
        code: 'RETENTION_CLOSED',
        expose: true,
      });
    }
    if (existing.phaseCode !== RETENTION_PHASE.retention) {
      throw new AppError('Case is not in Phase 2 Retention', {
        statusCode: 409,
        code: 'RETENTION_WRONG_PHASE',
        expose: true,
      });
    }
    if (!existing.assignedAgentZohoUserId?.trim()) {
      throw new AppError('Claim this case before logging calls', {
        statusCode: 409,
        code: 'RETENTION_UNASSIGNED',
        expose: true,
      });
    }
    const noteTrim = input.notes?.trim() || undefined;
    const evidenceUrl = input.evidenceUrl?.trim() || undefined;
    if (input.channel !== 'ringcentral' && !evidenceUrl && !noteTrim) {
      throw new AppError('Add a screenshot or a short note as proof for this channel', {
        statusCode: 400,
        code: 'RETENTION_EVIDENCE_REQUIRED',
        expose: true,
      });
    }
    const { formatCallRoleNote } = await import('../modules/retention/csCaps.js');
    const { stampPhase2Working } = await import('../modules/retention/phase2.js');
    const notes = input.callRole
      ? formatCallRoleNote(input.callRole, noteTrim)
      : (noteTrim ?? `CS contact via ${input.channel}`);
    await appendRetentionEvent({
      caseId: existing.id,
      fromStatus: existing.statusCode,
      toStatus: existing.statusCode,
      eventType: 'comms_attempt',
      actorZohoUserId: input.actorZohoUserId,
      notes,
      channel: input.channel,
      evidenceUrl,
    });
    if (existing.statusCode === 'p2_new') {
      const next = await retentionCaseRepo.update(
        ctx,
        id,
        patchToUpdateInput(
          stampPhase2Working({ notes: 'First CS contact — working' }),
          input.actorZohoUserId,
        ),
      );
      if (next) return next;
    }
    return toRetentionCaseDto(existing);
  },

  async getWithEvents(
    ctx: TenantContext,
    id: string,
  ): Promise<{ case: RetentionCaseDto; events: RetentionCaseEventDto[] } | null> {
    const row = await retentionCaseRepo.findById(ctx, id);
    if (!row) return null;
    const events = await db
      .select()
      .from(retentionCaseEvents)
      .where(eq(retentionCaseEvents.caseId, row.id))
      .orderBy(desc(retentionCaseEvents.occurredAt))
      .limit(100);
    return {
      case: toRetentionCaseDto(row),
      events: events.map(toRetentionCaseEventDto),
    };
  },

  async listCitiFolder(
    ctx: TenantContext,
    opts: { limit?: number; statusCode?: string } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const clauses = [
      eq(retentionCases.tenantId, ctx.tenantId),
      eq(retentionCases.phaseCode, RETENTION_PHASE.citi),
      isNull(retentionCases.closedAt),
    ];
    if (opts.statusCode) {
      clauses.push(eq(retentionCases.statusCode, opts.statusCode));
    } else {
      clauses.push(inArray(retentionCases.statusCode, [...CITI_OPEN]));
    }
    const where = and(...clauses);
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.citiFolderEnteredAt), desc(retentionCases.updatedAt))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
  },

  /** Confirm selected CITI holds for batch review → p3_review. */
  async confirmCitiBatch(
    ctx: TenantContext,
    caseIds: string[],
    opts: { actorZohoUserId: string; salesManagerZohoUserId?: string | undefined } = {
      actorZohoUserId: '',
    },
  ): Promise<{ updated: RetentionCaseDto[]; skipped: number }> {
    const updated: RetentionCaseDto[] = [];
    let skipped = 0;
    for (const id of caseIds) {
      const row = await retentionCaseRepo.findById(ctx, id);
      if (!row || row.phaseCode !== RETENTION_PHASE.citi || row.statusCode !== 'p3_hold') {
        skipped += 1;
        continue;
      }
      const next = await retentionCaseRepo.update(ctx, id, {
        phaseCode: RETENTION_PHASE.citi,
        statusCode: 'p3_review',
        ...(opts.salesManagerZohoUserId
          ? { salesManagerZohoUserId: opts.salesManagerZohoUserId }
          : {}),
        lastReviewCycleAt: new Date(),
        actorZohoUserId: opts.actorZohoUserId,
        eventType: 'status_change',
        eventNotes: 'Confirmed for CITI export batch',
      });
      if (next) updated.push(next);
      else skipped += 1;
    }
    return { updated, skipped };
  },

  /**
   * Export selected CITI cases: write Assignment_Stage=CITI on each Deal, return CSV.
   * Does not close cases — use markCitiBatchSent after ops confirm.
   */
  async exportCitiBatch(
    ctx: TenantContext,
    caseIds: string[],
    opts: { actorZohoUserId: string } = { actorZohoUserId: '' },
  ): Promise<{
    csv: string;
    exported: number;
    zohoFailures: Array<{ caseId: string; error: string }>;
  }> {
    const header = [
      'case_id',
      'carrier_id',
      'company_name',
      'zoho_deal_id',
      'assignment_count',
      'status_code',
      'citi_entered_at',
      'hold_until',
      'days_inactive',
      'gallons_90d',
    ];
    const lines = [header.join(',')];
    const zohoFailures: Array<{ caseId: string; error: string }> = [];
    let exported = 0;

    for (const id of caseIds) {
      const row = await retentionCaseRepo.findById(ctx, id);
      if (!row || row.phaseCode !== RETENTION_PHASE.citi || row.closedAt != null) continue;
      if (row.zohoDealId?.trim()) {
        try {
          await setDealAssignmentStageCiti(row.zohoDealId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          zohoFailures.push({ caseId: id, error: message });
          logger.warn(
            { caseId: id, dealId: row.zohoDealId, err: message },
            'CITI export: Assignment_Stage write failed',
          );
        }
      }
      lines.push(
        [
          row.id,
          row.carrierId,
          csvEscape(row.companyName ?? ''),
          row.zohoDealId ?? '',
          row.assignmentCount,
          row.statusCode,
          row.citiFolderEnteredAt?.toISOString() ?? '',
          row.citiFolderHoldUntil?.toISOString() ?? '',
          row.daysInactive ?? '',
          row.gallons90d ?? '',
        ].join(','),
      );
      await appendRetentionEvent({
        caseId: row.id,
        fromStatus: row.statusCode,
        toStatus: row.statusCode,
        eventType: 'note',
        actorZohoUserId: opts.actorZohoUserId,
        notes: 'Included in CITI CSV export batch',
      });
      exported += 1;
    }

    if (exported === 0) {
      throw new AppError('No CITI cases selected for export', {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }

    return { csv: `${lines.join('\n')}\n`, exported, zohoFailures };
  },

  /** Mark exported batch as sent → p3_closed (terminal). */
  async markCitiBatchSent(
    ctx: TenantContext,
    caseIds: string[],
    opts: { actorZohoUserId: string },
  ): Promise<{ closed: RetentionCaseDto[]; skipped: number }> {
    const closed: RetentionCaseDto[] = [];
    let skipped = 0;
    for (const id of caseIds) {
      const row = await retentionCaseRepo.findById(ctx, id);
      if (
        !row ||
        row.phaseCode !== RETENTION_PHASE.citi ||
        (row.statusCode !== 'p3_hold' && row.statusCode !== 'p3_review')
      ) {
        skipped += 1;
        continue;
      }
      const next = await retentionCaseRepo.update(ctx, id, {
        phaseCode: RETENTION_PHASE.citi,
        statusCode: 'p3_closed',
        currentDeadlineAt: null,
        currentDeadlineType: null,
        actorZohoUserId: opts.actorZohoUserId,
        eventType: 'status_change',
        eventNotes: 'CITI batch marked sent — closed',
      });
      if (next) closed.push(next);
      else skipped += 1;
    }
    return { closed, skipped };
  },
};

/** Count pending claims for CS nav badge. */
export async function countPendingPoolClaims(ctx: TenantContext): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(retentionCases)
    .where(
      and(
        eq(retentionCases.tenantId, ctx.tenantId),
        eq(retentionCases.statusCode, 'p1_pool_claim_pending'),
        isNull(retentionCases.closedAt),
      ),
    );
  return rows[0]?.n ?? 0;
}
