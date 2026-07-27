import { and, desc, eq, inArray, sql, sum } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionReferralBonuses,
  mytrionReferralCalcRuns,
  type MytrionReferralBonus,
  type MytrionReferralCalcRun,
  type NewMytrionReferralBonus,
  type NewMytrionReferralCalcRun,
  type ReferralBonusResolution,
  type ReferralBonusStatus,
  type ReferralBonusType,
  type ReferralCalcRunTrigger,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, normalizePagination } from './util.js';

/** One computed ledger row, as handed to the repo. `tenantId` is set here, never by the caller. */
export interface UpsertReferralBonusInput {
  bonusType: ReferralBonusType;
  /** First day of the period month, 'YYYY-MM-DD'. */
  periodMonth: string;
  childReferralId: string;
  parentReferrerId?: string | null;
  childName?: string | null;
  parentName?: string | null;
  carrierId?: number | null;
  zohoDealId?: string | null;
  resolution: ReferralBonusResolution;
  recipientKind: MytrionReferralBonus['recipientKind'];
  recipientName?: string | null;
  /** Numerics are strings end-to-end — never round-trip money through a JS float. */
  qtyGallons?: string | null;
  qtyNewCards?: number | null;
  cumulativeGallons?: string | null;
  rate?: string | null;
  amountUsd: string;
  calcRunId?: string | null;
}

export interface ListReferralBonusOpts {
  periodMonth?: string;
  bonusType?: ReferralBonusType;
  status?: ReferralBonusStatus;
  resolution?: ReferralBonusResolution;
  childReferralId?: string;
  parentReferrerId?: string;
  limit?: number;
  offset?: number;
}

/** Roll-up for one bonus type within a period — drives the card's summary tiles and the export header. */
export interface ReferralBonusTotals {
  bonusType: ReferralBonusType;
  rows: number;
  amountUsd: string;
}

/** Statuses a recalculation is allowed to overwrite. Once money has moved, the row is frozen. */
const RECALCULABLE_STATUSES: readonly ReferralBonusStatus[] = ['calculated'];

function tenantScope(ctx: TenantContext) {
  return eq(mytrionReferralBonuses.tenantId, ctx.tenantId);
}

/**
 * mytrion_referral_bonuses / mytrion_referral_calc_runs — the referral bonus ledger.
 *
 * Every read and write is tenant-scoped on `ctx.tenantId`; there are no DB foreign keys, so
 * isolation lives here (CLAUDE.md rule 2). Read-only by default — the only writers are the
 * calculation run and an explicit admin status change.
 */
export const referralBonusRepo = {
  /**
   * Insert-or-update one computed row, keyed by (tenant, child, type, month).
   *
   * Recalculation is expected to be run repeatedly over the same month, so this is an upsert rather
   * than an insert. `status` is deliberately NOT in the update set: a row already moved to
   * approved/paid/void keeps its status and is refreshed only in its computed figures.
   *
   * NOTE the one-time types (gallons_parent / gallons_child) additionally carry a partial unique
   * index on (tenant, child, type) with no month. If a recompute decides the threshold was crossed
   * in a DIFFERENT month than the stored row, this upsert's (…, period_month) conflict target will
   * not match and the insert raises 23505 against the one-time index instead. That is intentional:
   * paying the same one-time bonus under two months is exactly the failure the PDF asks us to
   * prevent, so it surfaces loudly rather than being silently absorbed. Callers that legitimately
   * need to re-date a one-time award must `deleteForRun`/void the old row first.
   */
  async upsert(
    ctx: TenantContext,
    input: UpsertReferralBonusInput,
  ): Promise<MytrionReferralBonus> {
    // Null-normalized up front: under `exactOptionalPropertyTypes` an `X | undefined` value cannot
    // be handed to drizzle's update-set, so every optional lands as an explicit null here and both
    // the INSERT and the DO UPDATE branch reuse the exact same values.
    const mutable = {
      parentReferrerId: input.parentReferrerId ?? null,
      childName: input.childName ?? null,
      parentName: input.parentName ?? null,
      carrierId: input.carrierId ?? null,
      zohoDealId: input.zohoDealId ?? null,
      resolution: input.resolution,
      recipientKind: input.recipientKind,
      recipientName: input.recipientName ?? null,
      qtyGallons: input.qtyGallons ?? null,
      qtyNewCards: input.qtyNewCards ?? null,
      cumulativeGallons: input.cumulativeGallons ?? null,
      rate: input.rate ?? null,
      amountUsd: input.amountUsd,
      calcRunId: input.calcRunId ?? null,
    };
    const row: NewMytrionReferralBonus = {
      tenantId: ctx.tenantId,
      bonusType: input.bonusType,
      periodMonth: input.periodMonth,
      childReferralId: input.childReferralId,
      ...mutable,
    };
    const now = new Date();
    const rows = await db
      .insert(mytrionReferralBonuses)
      .values(row)
      .onConflictDoUpdate({
        target: [
          mytrionReferralBonuses.tenantId,
          mytrionReferralBonuses.childReferralId,
          mytrionReferralBonuses.bonusType,
          mytrionReferralBonuses.periodMonth,
        ],
        set: { ...mutable, computedAt: now, updatedAt: now },
        // Frozen once money has moved — recompute refreshes 'calculated' rows only.
        setWhere: inArray(mytrionReferralBonuses.status, [...RECALCULABLE_STATUSES]),
      })
      .returning();
    return firstOrThrow(rows, 'mytrion_referral_bonuses upsert returned no row');
  },

  /** Filtered ledger page, newest period first. Always tenant-scoped. */
  async list(ctx: TenantContext, opts?: ListReferralBonusOpts): Promise<MytrionReferralBonus[]> {
    const { limit, offset } = normalizePagination(opts);
    const filters = [tenantScope(ctx)];
    if (opts?.periodMonth) filters.push(eq(mytrionReferralBonuses.periodMonth, opts.periodMonth));
    if (opts?.bonusType) filters.push(eq(mytrionReferralBonuses.bonusType, opts.bonusType));
    if (opts?.status) filters.push(eq(mytrionReferralBonuses.status, opts.status));
    if (opts?.resolution) filters.push(eq(mytrionReferralBonuses.resolution, opts.resolution));
    if (opts?.childReferralId) {
      filters.push(eq(mytrionReferralBonuses.childReferralId, opts.childReferralId));
    }
    if (opts?.parentReferrerId) {
      filters.push(eq(mytrionReferralBonuses.parentReferrerId, opts.parentReferrerId));
    }
    return db
      .select()
      .from(mytrionReferralBonuses)
      .where(and(...filters))
      .orderBy(desc(mytrionReferralBonuses.periodMonth), desc(mytrionReferralBonuses.computedAt))
      .limit(limit)
      .offset(offset);
  },

  /** Per-type totals for a period (or across all periods when `periodMonth` is omitted). */
  async totals(ctx: TenantContext, periodMonth?: string): Promise<ReferralBonusTotals[]> {
    const filters = [tenantScope(ctx)];
    if (periodMonth) filters.push(eq(mytrionReferralBonuses.periodMonth, periodMonth));
    const rows = await db
      .select({
        bonusType: mytrionReferralBonuses.bonusType,
        rows: sql<string>`count(*)`,
        amountUsd: sum(mytrionReferralBonuses.amountUsd),
      })
      .from(mytrionReferralBonuses)
      .where(and(...filters))
      .groupBy(mytrionReferralBonuses.bonusType);
    return rows.map((r) => ({
      bonusType: r.bonusType,
      rows: Number(r.rows ?? 0),
      amountUsd: r.amountUsd ?? '0',
    }));
  },

  /** Set the lifecycle status of specific rows (admin action: approve / mark paid / void). */
  async setStatus(
    ctx: TenantContext,
    ids: string[],
    status: ReferralBonusStatus,
  ): Promise<MytrionReferralBonus[]> {
    if (ids.length === 0) return [];
    return db
      .update(mytrionReferralBonuses)
      .set({ status, updatedAt: new Date() })
      .where(and(tenantScope(ctx), inArray(mytrionReferralBonuses.id, ids)))
      .returning();
  },

  /**
   * Drop still-`calculated` rows written by a given run — the rollback path for a failed or
   * superseded recompute. Approved/paid/void rows are never removed.
   */
  async deleteForRun(ctx: TenantContext, calcRunId: string): Promise<number> {
    const rows = await db
      .delete(mytrionReferralBonuses)
      .where(
        and(
          tenantScope(ctx),
          eq(mytrionReferralBonuses.calcRunId, calcRunId),
          inArray(mytrionReferralBonuses.status, [...RECALCULABLE_STATUSES]),
        ),
      )
      .returning({ id: mytrionReferralBonuses.id });
    return rows.length;
  },

  // --- Calculation runs -------------------------------------------------------------------------

  /** Open a run row (status 'running'); the engine finishes it via `finishRun`. */
  async startRun(
    ctx: TenantContext,
    input: { periodMonth?: string | null; trigger: ReferralCalcRunTrigger; triggeredBy?: string | null },
  ): Promise<MytrionReferralCalcRun> {
    const row: NewMytrionReferralCalcRun = {
      tenantId: ctx.tenantId,
      periodMonth: input.periodMonth ?? null,
      trigger: input.trigger,
      triggeredBy: input.triggeredBy ?? null,
    };
    const rows = await db.insert(mytrionReferralCalcRuns).values(row).returning();
    return firstOrThrow(rows, 'mytrion_referral_calc_runs insert returned no row');
  },

  /** Close a run with its outcome + counters. Tenant-scoped so a run id alone can't cross tenants. */
  async finishRun(
    ctx: TenantContext,
    runId: string,
    input: {
      status: MytrionReferralCalcRun['status'];
      rowsWritten?: number;
      amountTotalUsd?: string;
      unresolvedCount?: number;
      error?: string | null;
    },
  ): Promise<MytrionReferralCalcRun | undefined> {
    const rows = await db
      .update(mytrionReferralCalcRuns)
      .set({
        status: input.status,
        rowsWritten: input.rowsWritten ?? 0,
        amountTotalUsd: input.amountTotalUsd ?? '0',
        unresolvedCount: input.unresolvedCount ?? 0,
        error: input.error ?? null,
        finishedAt: new Date(),
      })
      .where(
        and(eq(mytrionReferralCalcRuns.tenantId, ctx.tenantId), eq(mytrionReferralCalcRuns.id, runId)),
      )
      .returning();
    return rows[0];
  },

  /** Recent runs, newest first — powers "last calculated" in the Manager card. */
  async listRuns(
    ctx: TenantContext,
    opts?: { periodMonth?: string; limit?: number; offset?: number },
  ): Promise<MytrionReferralCalcRun[]> {
    const { limit, offset } = normalizePagination(opts);
    const filters = [eq(mytrionReferralCalcRuns.tenantId, ctx.tenantId)];
    if (opts?.periodMonth) filters.push(eq(mytrionReferralCalcRuns.periodMonth, opts.periodMonth));
    return db
      .select()
      .from(mytrionReferralCalcRuns)
      .where(and(...filters))
      .orderBy(desc(mytrionReferralCalcRuns.startedAt))
      .limit(limit)
      .offset(offset);
  },
};
