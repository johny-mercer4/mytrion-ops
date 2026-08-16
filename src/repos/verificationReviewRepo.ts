/**
 * Phase 6 and Phase 9 persistence — credit review, banking review, risk assessment, and the tenant
 * underwriting policy.
 *
 * All three review tables are unique on (tenant, case), so saving a review is an upsert: a credit
 * agent revising their own numbers must correct the row, not add a second one the capacity formula
 * could then pick the wrong version of.
 *
 * Money is `numeric`, which the pg driver returns as a STRING to avoid float loss. Callers get
 * helpers here (`toNumber`) rather than each doing their own parse and disagreeing about null.
 */
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  verificationBankingReviews,
  verificationCreditReviews,
  verificationPolicy,
  verificationRiskAssessments,
  type VerificationBankingReview,
  type VerificationCreditReview,
  type VerificationPolicyRow,
  type VerificationRiskAssessment,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow, firstOrUndefined } from './util.js';

/** `numeric` arrives as a string. Null and unparseable both become null — never NaN, never 0. */
export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

type CreditInsert = typeof verificationCreditReviews.$inferInsert;
type BankingInsert = typeof verificationBankingReviews.$inferInsert;
type RiskInsert = typeof verificationRiskAssessments.$inferInsert;

export const verificationReviewRepo = {
  // ---- credit ----

  async findCredit(ctx: TenantContext, caseId: string): Promise<VerificationCreditReview | undefined> {
    const rows = await db
      .select()
      .from(verificationCreditReviews)
      .where(
        and(
          eq(verificationCreditReviews.tenantId, ctx.tenantId),
          eq(verificationCreditReviews.caseId, caseId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async saveCredit(
    ctx: TenantContext,
    caseId: string,
    input: Omit<CreditInsert, 'tenantId' | 'caseId' | 'id'>,
  ): Promise<VerificationCreditReview> {
    const now = new Date();
    const rows = await db
      .insert(verificationCreditReviews)
      .values({ ...input, tenantId: ctx.tenantId, caseId, updatedAt: now })
      .onConflictDoUpdate({
        target: [verificationCreditReviews.tenantId, verificationCreditReviews.caseId],
        set: { ...input, updatedAt: now },
      })
      .returning();
    return firstOrThrow(rows, 'Failed to save credit review');
  },

  // ---- banking ----

  async findBanking(ctx: TenantContext, caseId: string): Promise<VerificationBankingReview | undefined> {
    const rows = await db
      .select()
      .from(verificationBankingReviews)
      .where(
        and(
          eq(verificationBankingReviews.tenantId, ctx.tenantId),
          eq(verificationBankingReviews.caseId, caseId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async saveBanking(
    ctx: TenantContext,
    caseId: string,
    input: Omit<BankingInsert, 'tenantId' | 'caseId' | 'id'>,
  ): Promise<VerificationBankingReview> {
    const now = new Date();
    const rows = await db
      .insert(verificationBankingReviews)
      .values({ ...input, tenantId: ctx.tenantId, caseId, updatedAt: now })
      .onConflictDoUpdate({
        target: [verificationBankingReviews.tenantId, verificationBankingReviews.caseId],
        set: { ...input, updatedAt: now },
      })
      .returning();
    return firstOrThrow(rows, 'Failed to save banking review');
  },

  // ---- risk ----

  async findRisk(ctx: TenantContext, caseId: string): Promise<VerificationRiskAssessment | undefined> {
    const rows = await db
      .select()
      .from(verificationRiskAssessments)
      .where(
        and(
          eq(verificationRiskAssessments.tenantId, ctx.tenantId),
          eq(verificationRiskAssessments.caseId, caseId),
        ),
      )
      .limit(1);
    return firstOrUndefined(rows);
  },

  async saveRisk(
    ctx: TenantContext,
    caseId: string,
    input: Omit<RiskInsert, 'tenantId' | 'caseId' | 'id'>,
  ): Promise<VerificationRiskAssessment> {
    const now = new Date();
    const rows = await db
      .insert(verificationRiskAssessments)
      .values({ ...input, tenantId: ctx.tenantId, caseId, updatedAt: now })
      .onConflictDoUpdate({
        target: [verificationRiskAssessments.tenantId, verificationRiskAssessments.caseId],
        set: { ...input, updatedAt: now },
      })
      .returning();
    return firstOrThrow(rows, 'Failed to save risk assessment');
  },
};

export const verificationPolicyRepo = {
  /**
   * The tenant's policy, creating the row on first read.
   *
   * The DEFAULTS here match migration 0121 exactly — Strong 0.800, Moderate and Weak NULL. A tenant
   * that has never opened the policy screen must behave identically to the seeded one, which means
   * it must also REFUSE to price moderate and weak. Defaulting those to a number here would be a
   * second, invisible policy.
   */
  async get(ctx: TenantContext): Promise<VerificationPolicyRow> {
    const rows = await db
      .select()
      .from(verificationPolicy)
      .where(eq(verificationPolicy.tenantId, ctx.tenantId))
      .limit(1);
    const existing = firstOrUndefined(rows);
    if (existing) return existing;

    const created = await db
      .insert(verificationPolicy)
      .values({ tenantId: ctx.tenantId })
      .onConflictDoNothing({ target: verificationPolicy.tenantId })
      .returning();
    const row = firstOrUndefined(created);
    if (row) return row;

    // Lost the insert race — read the winner.
    const reread = await db
      .select()
      .from(verificationPolicy)
      .where(eq(verificationPolicy.tenantId, ctx.tenantId))
      .limit(1);
    return firstOrThrow(reread, 'Failed to resolve verification policy');
  },

  async update(
    ctx: TenantContext,
    patch: Partial<Omit<typeof verificationPolicy.$inferInsert, 'tenantId'>>,
    actor?: string,
  ): Promise<VerificationPolicyRow> {
    await this.get(ctx);
    const rows = await db
      .update(verificationPolicy)
      .set({ ...patch, updatedBy: actor ?? null, updatedAt: new Date() })
      .where(eq(verificationPolicy.tenantId, ctx.tenantId))
      .returning();
    return firstOrThrow(rows, 'Failed to update verification policy');
  },

  /** Risk factors in the shape `capacity.ts` expects — strings coerced, nulls preserved. */
  async factors(ctx: TenantContext): Promise<{
    strongFactor: number | null;
    moderateFactor: number | null;
    weakFactor: number | null;
  }> {
    const row = await this.get(ctx);
    return {
      strongFactor: toNumber(row.strongFactor),
      moderateFactor: toNumber(row.moderateFactor),
      weakFactor: toNumber(row.weakFactor),
    };
  },

  /** Routing thresholds in the shape `stateMachine.ts` expects. */
  async routing(ctx: TenantContext): Promise<{ bankFirstTruckMin: number; wexCardCutoff: number }> {
    const row = await this.get(ctx);
    return {
      bankFirstTruckMin: row.bankFirstTruckMin,
      wexCardCutoff: row.wexCardCutoff,
    };
  },

  /** Indicator thresholds in the shape `hardStops.ts` expects. */
  async indicatorThresholds(
    ctx: TenantContext,
  ): Promise<{ adbReviewThreshold: number; nsfReviewThreshold: number }> {
    const row = await this.get(ctx);
    return {
      adbReviewThreshold: toNumber(row.adbReviewThreshold) ?? 500,
      nsfReviewThreshold: row.nsfReviewThreshold,
    };
  },
};
