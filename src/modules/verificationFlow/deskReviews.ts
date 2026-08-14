/**
 * Phase 6 and Phase 9 writes — credit review, banking review, and the capacity computation.
 *
 * Split out of `deskService` for the 600-line cap. These are the money-critical writes, and two
 * rules live here rather than in a route or a form:
 *
 *  - `avgWeeklyNetCashFlow` is DERIVED from the two recurring inputs, never accepted from the
 *    client. It gates the unsecured LOC, so it must equal what its inputs say.
 *  - capacity is computed from the STORED banking review, so a recommended limit always traces to
 *    numbers an analyst actually recorded.
 */
import { AppError, NotFoundError } from '../../lib/errors.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import { verificationScreeningRepo } from '../../repos/verificationScreeningRepo.js';
import {
  toNumber,
  verificationPolicyRepo,
  verificationReviewRepo,
} from '../../repos/verificationReviewRepo.js';
import type { VerificationRiskTier } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { zohoFromCtx } from './applicationService.js';
import { computeRecommendedLimit } from './capacity.js';
import { screeningVerdictSummary } from './screening.js';

export async function saveCreditReview(
  ctx: TenantContext,
  caseId: string,
  input: Record<string, unknown>,
) {
    await verificationReviewRepo.saveCredit(ctx, caseId, {
      ...input,
      reviewedBy: zohoFromCtx(ctx) ?? ctx.userId,
      reviewedAt: new Date(),
    });
}

/**
 * Banking review. `avgWeeklyNetCashFlow` is DERIVED from the two recurring inputs rather than
 * accepted from the client — it gates the unsecured LOC, so it must equal what its inputs say.
 */
export async function saveBankingReview(
ctx: TenantContext,
caseId: string,
input: Record<string, unknown>,
) {
    const income = toNumber(input.recurringWeeklyIncome as string | null);
    const expenses = toNumber(input.recurringWeeklyExpenses as string | null);
    const derived =
      income !== null && expenses !== null ? (Math.round((income - expenses) * 100) / 100).toFixed(2) : null;

    await verificationReviewRepo.saveBanking(ctx, caseId, {
      ...input,
      ...(derived === null ? {} : { avgWeeklyNetCashFlow: derived }),
      reviewedBy: zohoFromCtx(ctx) ?? ctx.userId,
      reviewedAt: new Date(),
    });
}

/**
 * Phase 9. Computes capacity from the STORED banking review, not from client input — so the limit
 * always traces to the numbers an analyst actually recorded. Refuses when the tier has no approved
 * factor, and says which tier.
 */
export async function saveRiskAssessment(
  ctx: TenantContext,
  caseId: string,
  input: {
    riskTier: VerificationRiskTier;
    businessAgeMonths?: number | undefined;
    authorityAgeMonths?: number | undefined;
    analystRecommendation?: string | undefined;
    keyRisks?: string[] | undefined;
  },
) {
  const row = await verificationFlowRepo.findById(ctx, caseId);
  if (!row) throw new NotFoundError('Verification case not found');
    const banking = await verificationReviewRepo.findBanking(ctx, caseId);
    if (!banking) {
      throw new AppError(
        'Record the banking review before assessing capacity — the recommended limit is derived from it.',
        { statusCode: 409, code: 'VERIFICATION_BANKING_REQUIRED', expose: true },
      );
    }
    const income = toNumber(banking.recurringWeeklyIncome);
    const expenses = toNumber(banking.recurringWeeklyExpenses);
    const fuel = toNumber(banking.avgWeeklyFuelExpense);
    if (income === null || expenses === null || fuel === null) {
      throw new AppError(
        'The banking review needs recurring weekly income, recurring weekly expenses and average weekly fuel before capacity can be computed.',
        { statusCode: 409, code: 'VERIFICATION_BANKING_INCOMPLETE', expose: true },
      );
    }

    const factors = await verificationPolicyRepo.factors(ctx);
    const result = computeRecommendedLimit(
      {
        avgWeeklyRecurringIncome: income,
        avgWeeklyRecurringExpenses: expenses,
        avgWeeklyFuelExpense: fuel,
      },
      input.riskTier,
      factors,
    );

    await verificationReviewRepo.saveRisk(ctx, caseId, {
      riskTier: input.riskTier,
      businessAgeMonths: input.businessAgeMonths ?? null,
      authorityAgeMonths: input.authorityAgeMonths ?? null,
      avgWeeklyNetCashFlow: result.avgWeeklyNetCashFlow.toFixed(2),
      avgWeeklyFuelExpense: fuel.toFixed(2),
      adjustedWeeklyCapacity: result.adjustedWeeklyCapacity.toFixed(2),
      riskFactor: result.riskFactor.toFixed(3),
      recommendedLimit: result.recommendedLimit.toFixed(2),
      requestedLimit: row.requestedLimit,
      analystRecommendation: input.analystRecommendation ?? null,
      keyRisks: input.keyRisks ?? [],
      summary: await buildSummary(ctx, caseId, result),
      computedAt: new Date(),
      assessedBy: zohoFromCtx(ctx) ?? ctx.userId,
    });
}

/** The "Underwriting summary in Mytrion" the SOP enumerates, assembled from stored state. */
export async function buildSummary(
  ctx: TenantContext,
  caseId: string,
  capacity?: { adjustedWeeklyCapacity: number; riskFactor: number; recommendedLimit: number },
): Promise<Record<string, unknown>> {
  const [row, credit, banking, hits] = await Promise.all([
    verificationFlowRepo.findById(ctx, caseId),
    verificationReviewRepo.findCredit(ctx, caseId),
    verificationReviewRepo.findBanking(ctx, caseId),
    verificationScreeningRepo.listHits(ctx, caseId),
  ]);
  if (!row) throw new NotFoundError('Verification case not found');
  return {
    applicantType: row.applicantType,
    underwritingRoute: row.underwritingRoute,
    screening: screeningVerdictSummary(hits),
    credit: credit
      ? { score: credit.creditScore, outcome: credit.outcome, bureauNoHit: credit.bureauNoHit }
      : null,
    banking: banking
      ? {
          avgWeeklyNetCashFlow: banking.avgWeeklyNetCashFlow,
          avgWeeklyFuelExpense: banking.avgWeeklyFuelExpense,
          avgDailyBalance: banking.avgDailyBalance,
          nsfCount: banking.nsfCount,
        }
      : null,
    capacity: capacity ?? null,
    requestedLimit: row.requestedLimit,
    generatedAt: new Date().toISOString(),
  };
}

