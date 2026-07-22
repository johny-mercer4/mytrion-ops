/**
 * Retention Phase 2 process caps (RetentionFinal):
 * - Max 40 deals assigned/claimed per agent per UTC day
 * - Max 15% of an agent's open Phase 2 portfolio in p2_offer_pending
 * - Two-call rule: listen then solution before Saved / Refused
 */
import { and, eq, gte, inArray, isNull, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import {
  RETENTION_PHASE,
  retentionCaseEvents,
  retentionCases,
} from '../../db/schema/index.js';
import { AppError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';

export const CS_MAX_DEALS_PER_DAY = 40;
export const CS_MAX_PENDING_RATIO = 0.15;

export type CsCallRole = 'listen' | 'solution';

const CALL_ROLE_RE = /\[call_role:(listen|solution)\]/i;

export function formatCallRoleNote(role: CsCallRole, notes?: string): string {
  const body = notes?.trim();
  return body ? `[call_role:${role}] ${body}` : `[call_role:${role}]`;
}

export function parseCallRoleFromNotes(notes: string | null | undefined): CsCallRole | null {
  if (!notes) return null;
  const m = CALL_ROLE_RE.exec(notes);
  if (!m?.[1]) return null;
  return m[1].toLowerCase() === 'solution' ? 'solution' : 'listen';
}

export function utcDayStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Distinct Phase 2 cases reassigned to working for this agent today (UTC). */
export async function countCsAssignmentsToday(
  ctx: TenantContext,
  zohoUserId: string,
  now: Date = new Date(),
): Promise<number> {
  const agent = zohoUserId.trim();
  if (!agent) return 0;
  const dayStart = utcDayStart(now);
  const like = `%${agent}%`;
  const rows = await db
    .select({
      n: sql<number>`count(distinct ${retentionCaseEvents.caseId})::int`,
    })
    .from(retentionCaseEvents)
    .innerJoin(retentionCases, eq(retentionCases.id, retentionCaseEvents.caseId))
    .where(
      and(
        eq(retentionCases.tenantId, ctx.tenantId),
        gte(retentionCaseEvents.occurredAt, dayStart),
        eq(retentionCaseEvents.eventType, 'reassigned'),
        eq(retentionCaseEvents.toStatus, 'p2_working'),
        sql`(
          ${retentionCaseEvents.actorZohoUserId} = ${agent}
          OR ${retentionCaseEvents.notes} ILIKE ${like}
        )`,
      ),
    );
  return Number(rows[0]?.n ?? 0);
}

export async function assertUnderDailyCap(
  ctx: TenantContext,
  zohoUserId: string,
  now: Date = new Date(),
): Promise<number> {
  const used = await countCsAssignmentsToday(ctx, zohoUserId, now);
  if (used >= CS_MAX_DEALS_PER_DAY) {
    throw new AppError(
      `Daily Retention cap reached (${CS_MAX_DEALS_PER_DAY} deals/day). Try again tomorrow.`,
      {
        statusCode: 409,
        code: 'RETENTION_DAILY_CAP',
        expose: true,
      },
    );
  }
  return used;
}

export interface CsPortfolioCounts {
  open: number;
  pending: number;
  pendingRatio: number;
}

export async function getCsPortfolioCounts(
  ctx: TenantContext,
  zohoUserId: string,
): Promise<CsPortfolioCounts> {
  const agent = zohoUserId.trim();
  if (!agent) return { open: 0, pending: 0, pendingRatio: 0 };
  const rows = await db
    .select({
      open: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${retentionCases.statusCode} = 'p2_offer_pending')::int`,
    })
    .from(retentionCases)
    .where(
      and(
        eq(retentionCases.tenantId, ctx.tenantId),
        eq(retentionCases.phaseCode, RETENTION_PHASE.retention),
        eq(retentionCases.assignedAgentZohoUserId, agent),
        isNull(retentionCases.closedAt),
        inArray(retentionCases.statusCode, [
          'p2_new',
          'p2_working',
          'p2_offer_pending',
          'p2_handoff_citi',
        ]),
      ),
    );
  const open = Number(rows[0]?.open ?? 0);
  const pending = Number(rows[0]?.pending ?? 0);
  return {
    open,
    pending,
    pendingRatio: open === 0 ? 0 : pending / open,
  };
}

/**
 * Before moving another case into p2_offer_pending, ensure pending/open would stay ≤ 15%.
 * `alreadyPending` = case is already pending (idempotent re-mark).
 */
export async function assertPendingCap(
  ctx: TenantContext,
  zohoUserId: string,
  opts: { alreadyPending?: boolean } = {},
): Promise<CsPortfolioCounts> {
  const counts = await getCsPortfolioCounts(ctx, zohoUserId);
  if (opts.alreadyPending) return counts;
  const nextPending = counts.pending + 1;
  const open = Math.max(counts.open, 1);
  // If case is open but not yet counted as this agent's (unassigned mark), use open+1.
  const denom = counts.open > 0 ? counts.open : open;
  if (nextPending / denom > CS_MAX_PENDING_RATIO + 1e-9) {
    throw new AppError(
      `Pending portfolio cap reached (max ${Math.round(CS_MAX_PENDING_RATIO * 100)}% in Offer pending).`,
      {
        statusCode: 409,
        code: 'RETENTION_PENDING_CAP',
        expose: true,
      },
    );
  }
  return counts;
}

export async function caseHasTwoCallRoles(
  caseId: string | number,
): Promise<{ listen: boolean; solution: boolean }> {
  const numericId = typeof caseId === 'number' ? caseId : Number(caseId);
  if (!Number.isFinite(numericId)) return { listen: false, solution: false };
  const events = await db
    .select({ notes: retentionCaseEvents.notes })
    .from(retentionCaseEvents)
    .where(
      and(
        eq(retentionCaseEvents.caseId, numericId),
        eq(retentionCaseEvents.eventType, 'comms_attempt'),
      ),
    );
  let listen = false;
  let solution = false;
  for (const ev of events) {
    const role = parseCallRoleFromNotes(ev.notes);
    if (role === 'listen') listen = true;
    if (role === 'solution') solution = true;
  }
  return { listen, solution };
}

export async function assertTwoCallComplete(caseId: string | number): Promise<void> {
  const { listen, solution } = await caseHasTwoCallRoles(caseId);
  if (!listen || !solution) {
    throw new AppError(
      'Two-call rule: log Call 1 (listen) and Call 2 (solution) before Saved or Refused.',
      {
        statusCode: 409,
        code: 'RETENTION_TWO_CALL_SHORT',
        expose: true,
      },
    );
  }
}
