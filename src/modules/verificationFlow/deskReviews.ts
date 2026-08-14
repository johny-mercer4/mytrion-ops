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
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
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

  /**
   * SOP Phase 5: "Both reviews must be completed before final risk assessment unless the applicant
   * is declined earlier." Banking alone would still produce a number, which is exactly why it has
   * to be refused — a capacity computed without the credit profile looks just as authoritative.
   */
  const [banking, credit] = await Promise.all([
    verificationReviewRepo.findBanking(ctx, caseId),
    verificationReviewRepo.findCredit(ctx, caseId),
  ]);
  const outstanding = [!credit ? 'credit' : null, !banking ? 'banking' : null].filter(Boolean);
  if (outstanding.length > 0) {
    throw new AppError(
      `Both reviews must be completed before the risk assessment — the ${outstanding.join(' and ')} review ${outstanding.length === 1 ? 'is' : 'are'} still outstanding.`,
      { statusCode: 409, code: 'VERIFICATION_REVIEWS_REQUIRED', expose: true },
    );
  }
  if (!banking) {
    throw new AppError('Record the banking review before assessing capacity.', {
      statusCode: 409,
      code: 'VERIFICATION_BANKING_REQUIRED',
      expose: true,
    });
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

/**
 * The "Underwriting summary in Mytrion" the SOP enumerates, assembled from stored state.
 *
 * The SOP names sixteen things it must carry, and every one is below in that order: applicant type,
 * duplicate/blacklist findings, credit findings, banking findings, weekly income / expenses / net
 * cash flow / fuel, Highway findings, average daily balance, adjusted capacity, risk tier, risk
 * factor, requested and recommended limit, analyst recommendation, key risks, supporting documents,
 * and management exceptions.
 *
 * Assembled from what is STORED rather than from what a form posted, so the summary and the case
 * cannot disagree. Highway and management exceptions come off the phase rail — Phase 8's findings
 * and every phase whose outcome needed a human.
 */
export async function buildSummary(
  ctx: TenantContext,
  caseId: string,
  capacity?: { adjustedWeeklyCapacity: number; riskFactor: number; recommendedLimit: number },
): Promise<Record<string, unknown>> {
  const [row, credit, banking, hits, phases, documents] = await Promise.all([
    verificationFlowRepo.findById(ctx, caseId),
    verificationReviewRepo.findCredit(ctx, caseId),
    verificationReviewRepo.findBanking(ctx, caseId),
    verificationScreeningRepo.listHits(ctx, caseId),
    verificationCaseAssetRepo.listPhases(ctx, caseId),
    verificationCaseAssetRepo.listDocuments(ctx, caseId),
  ]);
  if (!row) throw new NotFoundError('Verification case not found');

  const highway = phases.find((p) => p.phaseCode === 'p8_highway');
  const exceptions = phases
    .filter((p) => p.status === 'manager_review' || p.outcome === 'additional_verification')
    .map((p) => ({ phase: p.phaseCode, outcome: p.outcome, note: p.note, decidedAt: p.decidedAt }));

  return {
    applicantType: row.applicantType,
    underwritingRoute: row.underwritingRoute,
    screening: {
      ...screeningVerdictSummary(hits),
      hits: hits.map((h) => ({
        check: h.checkType,
        identifier: h.entryType,
        matched: h.matchedValueDisplay ?? h.matchedCaseLabel,
        verdict: h.verdict,
      })),
    },
    credit: credit
      ? {
          score: credit.creditScore,
          outcome: credit.outcome,
          bureauNoHit: credit.bureauNoHit,
          utilizationPct: credit.utilizationPct,
          latePayments: credit.latePayments,
          collections: credit.collections,
          totalDebt: credit.totalDebt,
          recentTrend: credit.recentTrend,
        }
      : null,
    banking: banking
      ? {
          periodStart: banking.periodStart,
          periodEnd: banking.periodEnd,
          accountOwnershipVerified: banking.accountOwnershipVerified,
          recurringWeeklyIncome: banking.recurringWeeklyIncome,
          recurringWeeklyExpenses: banking.recurringWeeklyExpenses,
          avgWeeklyNetCashFlow: banking.avgWeeklyNetCashFlow,
          avgWeeklyFuelExpense: banking.avgWeeklyFuelExpense,
          avgDailyBalance: banking.avgDailyBalance,
          minimumBalance: banking.minimumBalance,
          negativeBalanceDays: banking.negativeBalanceDays,
          nsfCount: banking.nsfCount,
          achReturnCount: banking.achReturnCount,
          revenueTrend: banking.revenueTrend,
          cashFlowVolatility: banking.cashFlowVolatility,
        }
      : null,
    highway: highway
      ? { status: highway.status, outcome: highway.outcome, note: highway.note, findings: highway.findings }
      : null,
    capacity: capacity ?? null,
    requestedLimit: row.requestedLimit,
    supportingDocuments: documents
      .filter((d) => d.status === 'received')
      .map((d) => ({ docType: d.docType, fileName: d.fileName, uploadedBy: d.uploadedByName })),
    outstandingDocuments: documents
      .filter((d) => d.status === 'requested')
      .map((d) => ({ docType: d.docType, label: d.label, requestedInPhase: d.requestedInPhase })),
    managementExceptions: exceptions,
    generatedAt: new Date().toISOString(),
  };
}

