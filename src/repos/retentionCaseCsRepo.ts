/**
 * Customer Service Retention desk — Phase 2 cases + CITI Folder (Phase 3) bulk ops.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
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

const P2_FILTERS = {
  new: ['p2_new'] as const,
  working: ['p2_working', 'p2_offer_pending', 'p2_handoff_citi'] as const,
  closed: [
    'p2_saved',
    'p2_refused',
    'p2_lost',
    'p2_out_of_business',
    'p2_no_response',
  ] as const,
  all_open: ['p2_new', 'p2_working', 'p2_offer_pending', 'p2_handoff_citi'] as const,
} as const;

export type CsPhase2Filter = keyof typeof P2_FILTERS;

const CITI_OPEN = ['p3_hold', 'p3_review'] as const;

function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export const retentionCaseCsRepo = {
  async listPhase2(
    ctx: TenantContext,
    opts: { filter?: CsPhase2Filter; limit?: number } = {},
  ): Promise<{ cases: RetentionCaseDto[]; total: number }> {
    const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
    const filter = opts.filter ?? 'all_open';
    const statuses = [...P2_FILTERS[filter]];
    const clauses = [
      eq(retentionCases.tenantId, ctx.tenantId),
      eq(retentionCases.phaseCode, RETENTION_PHASE.retention),
      inArray(retentionCases.statusCode, statuses),
    ];
    if (filter !== 'closed') clauses.push(isNull(retentionCases.closedAt));
    const where = and(...clauses);
    const rows = await db
      .select()
      .from(retentionCases)
      .where(where)
      .orderBy(desc(retentionCases.gallons90d), desc(retentionCases.updatedAt))
      .limit(limit);
    return { cases: rows.map(toRetentionCaseDto), total: rows.length };
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
    if (updated.statusCode === 'p1_open_pool') {
      const { notifyOpenPoolOpened } = await import('../modules/retention/notify.js');
      await notifyOpenPoolOpened(ctx, {
        caseId: updated.id,
        carrierId: updated.carrierId,
        companyName: updated.companyName,
        previousOwnerZohoUserId: existing.assignedAgentZohoUserId,
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
    const noteTrim = input.notes?.trim() || undefined;
    const evidenceUrl = input.evidenceUrl?.trim() || undefined;
    if (input.channel !== 'ringcentral' && !evidenceUrl && !noteTrim) {
      throw new AppError('Add a screenshot or a short note as proof for this channel', {
        statusCode: 400,
        code: 'RETENTION_EVIDENCE_REQUIRED',
        expose: true,
      });
    }
    await appendRetentionEvent({
      caseId: existing.id,
      fromStatus: existing.statusCode,
      toStatus: existing.statusCode,
      eventType: 'comms_attempt',
      actorZohoUserId: input.actorZohoUserId,
      notes: noteTrim ?? `CS contact via ${input.channel}`,
      channel: input.channel,
      evidenceUrl,
    });
    if (existing.statusCode === 'p2_new') {
      const next = await retentionCaseRepo.update(
        ctx,
        id,
        patchToUpdateInput(
          {
            phaseCode: RETENTION_PHASE.retention,
            statusCode: 'p2_working',
            eventType: 'status_change',
            eventNotes: 'First CS contact — working',
          },
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
