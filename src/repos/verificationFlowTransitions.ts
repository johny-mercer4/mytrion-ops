/**
 * Phase and status TRANSITIONS on a verification case, plus the append-only event log.
 *
 * Split out of `verificationFlowRepo.ts` for the 600-line cap, and they belong together: every
 * transition here writes the `verification_case_events` row IN THE SAME CALL, which is the whole
 * reason nothing outside this file may update `phase_code` / `status_code` directly. A phase change
 * with no event is a case whose history has a hole in it.
 *
 * Still reached through `verificationFlowRepo` — these are referenced onto that object rather than
 * imported by callers, so the repo stays the single door and no route learns two names for one thing.
 */
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationCaseEvents,
  verificationCases,
  type VerificationCase,
  type VerificationCaseEvent,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrUndefined } from './util.js';
import { verificationCaseAssetRepo } from './verificationCaseAssetRepo.js';
import type { TransitionInput } from './verificationFlowRepo.js';

const tenant = (ctx: TenantContext) => eq(verificationCases.tenantId, ctx.tenantId);

/** The pre-image read every transition needs, so the event can record what it moved FROM. */
async function findCaseById(ctx: TenantContext, id: string): Promise<VerificationCase | undefined> {
  const rows = await db
    .select()
    .from(verificationCases)
    .where(and(tenant(ctx), eq(verificationCases.id, id)))
    .limit(1);
  return firstOrUndefined(rows);
}

export async function listEvents(
  ctx: TenantContext,
  caseId: string,
  limit = 100,
): Promise<VerificationCaseEvent[]> {
  return db
    .select()
    .from(verificationCaseEvents)
    .where(
      and(eq(verificationCaseEvents.tenantId, ctx.tenantId), eq(verificationCaseEvents.caseId, caseId)),
    )
    .orderBy(desc(verificationCaseEvents.occurredAt))
    .limit(Math.min(Math.max(limit, 1), 500));
}

/**
 * Move a case BACK to a phase, withdrawing the decision that carried it forward.
 *
 * Deliberately not a flag on `applyTransition`: that method exists to RECORD a decision, and it
 * hardcodes `decidedAt: now` on the phase row it writes. A reopen has to clear those fields, so
 * folding it in would mean every forward caller carrying a concept it never uses. The phase rows
 * themselves are `verificationCaseAssetRepo.reopenPhase`'s — this is the case row and the event.
 *
 * `outcomeCode` / `decidedAt` / `decidedBy` / `closedAt` are all cleared: a case that has re-entered
 * phase 3 has no outcome, and leaving a stale `decidedAt` on it is what makes a reopened file still
 * read as decided in every list that sorts on it.
 */
export async function reopenTo(
  ctx: TenantContext,
  id: string,
  input: {
    phaseCode: string;
    statusCode: string;
    reason: string;
    actorZohoUserId?: string | undefined;
    actorName?: string | undefined;
  },
): Promise<VerificationCase | undefined> {
  const before = await findCaseById(ctx, id);
  if (!before) return undefined;

  const now = new Date();
  const rows = await db
    .update(verificationCases)
    .set({
      phaseCode: input.phaseCode,
      statusCode: input.statusCode,
      phaseChangedAt: now,
      closedAt: null,
      outcomeCode: null,
      decidedAt: null,
      decidedBy: null,
      updatedAt: now,
    })
    .where(and(tenant(ctx), eq(verificationCases.id, id)))
    .returning();
  const row = firstOrUndefined(rows);
  if (!row) return undefined;

  await appendEvent(ctx, {
    caseId: id,
    fromPhase: before.phaseCode,
    toPhase: row.phaseCode,
    fromStatus: before.statusCode,
    toStatus: row.statusCode,
    eventType: 'phase_reopened',
    actorZohoUserId: input.actorZohoUserId ?? null,
    actorName: input.actorName ?? null,
    notes: input.reason,
  });

  return row;
}

/**
 * THE transition. Moves the case, stamps the phase row the decision was made on, and writes the
 * event — one call, so none of the three can happen without the others.
 */
export async function applyTransition(
  ctx: TenantContext,
  id: string,
  input: TransitionInput,
): Promise<VerificationCase | undefined> {
  const before = await findCaseById(ctx, id);
  if (!before) return undefined;

  const now = new Date();
  const set: Partial<typeof verificationCases.$inferInsert> = {
    phaseCode: input.phaseCode,
    statusCode: input.statusCode,
    updatedAt: now,
  };
  if (before.phaseCode !== input.phaseCode) set.phaseChangedAt = now;
  // closed_at is derived from terminality, and CLEARED when a case reopens — otherwise a
  // reopened application keeps a close date and drops out of every open-case filter.
  set.closedAt = input.closed ? now : null;
  if (input.closed) {
    set.outcomeCode = input.statusCode;
    set.decidedAt = now;
    if (input.actorZohoUserId) set.decidedBy = input.actorZohoUserId;
  }

  const rows = await db
    .update(verificationCases)
    .set(set)
    .where(and(tenant(ctx), eq(verificationCases.id, id)))
    .returning();
  const row = firstOrUndefined(rows);
  if (!row) return undefined;

  await verificationCaseAssetRepo.upsertPhase(ctx, id, {
    phaseCode: input.decidedPhase,
    status: input.phaseStatus,
    outcome: input.outcome ?? null,
    decidedAt: now,
    decidedBy: input.actorZohoUserId ?? null,
    note: input.eventNotes ?? null,
    findings: input.findings,
  });

  await appendEvent(ctx, {
    caseId: id,
    fromPhase: before.phaseCode,
    toPhase: row.phaseCode,
    fromStatus: before.statusCode,
    toStatus: row.statusCode,
    eventType: input.eventType,
    actorZohoUserId: input.actorZohoUserId ?? null,
    actorName: input.actorName ?? null,
    notes: input.eventNotes ?? null,
  });

  return row;
}

// ---- events ----

/**
 * Append-only. Exported through the repo object as well so callers never reach for the table.
 * Tenant id comes from ctx, never from the caller's payload.
 */
export async function appendEvent(
  ctx: TenantContext,
  input: {
    caseId: string;
    fromPhase?: string | null;
    toPhase?: string | null;
    fromStatus?: string | null;
    toStatus?: string | null;
    eventType: string;
    actorZohoUserId?: string | null;
    actorName?: string | null;
    notes?: string | null;
  },
): Promise<void> {
  await db.insert(verificationCaseEvents).values({
    tenantId: ctx.tenantId,
    caseId: input.caseId,
    fromPhase: input.fromPhase ?? null,
    toPhase: input.toPhase ?? null,
    fromStatus: input.fromStatus ?? null,
    toStatus: input.toStatus ?? null,
    eventType: input.eventType,
    actorZohoUserId: input.actorZohoUserId ?? null,
    actorName: input.actorName ?? null,
    notes: input.notes ?? null,
  });
}

