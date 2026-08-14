/**
 * Verification-desk underwriting routes — the other door onto the shared case row.
 *
 * VERIFICATION-gated, where `verificationApplications.routes.ts` is SALES-gated. Same rows, two
 * departments, different verbs: Sales fills intake, the desk underwrites.
 *
 * Mounted under `/verification/flow/*` rather than `/verification/cases/*` so the retired
 * credit-platform Decision Desk routes keep working untouched while they are quarantined.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { deskService } from '../../modules/verificationFlow/deskService.js';
import { verificationPolicyRepo } from '../../repos/verificationReviewRepo.js';
import {
  VERIFICATION_APPLICANT_TYPES,
  VERIFICATION_DOC_TYPES,
  VERIFICATION_PHASE_OUTCOMES,
  VERIFICATION_RISK_TIERS,
  VERIFICATION_ROUTES,
  VERIFICATION_SCREENING_VERDICTS,
  VERIFICATION_TRENDS,
  VERIFICATION_VOLATILITY,
  VERIFICATION_CREDIT_OUTCOMES,
} from '../../db/schema/verification_flow.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification underwriting');
}
function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification underwriting');
}

const idParams = z.object({ id: z.string().min(1) });
const phaseParams = z.object({ id: z.string().min(1), phase: z.string().min(1) });
const hitParams = z.object({ id: z.string().min(1), hitId: z.string().min(1) });

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  statusCode: z.string().trim().min(1).optional(),
  phaseCode: z.string().trim().min(1).optional(),
  applicantType: z.enum(VERIFICATION_APPLICANT_TYPES).optional(),
  underwritingRoute: z.enum(VERIFICATION_ROUTES).optional(),
  gate: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  open: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().trim().min(1).max(120).optional(),
});

const decisionBody = z.object({
  outcome: z.enum(VERIFICATION_PHASE_OUTCOMES),
  note: z.string().trim().max(2000).optional(),
});

const verdictBody = z.object({
  verdict: z.enum(VERIFICATION_SCREENING_VERDICTS),
  note: z.string().trim().max(2000).optional(),
});

/** Money arrives as a number and is stored as numeric text; nulls clear a field. */
const money = z.coerce.number().min(-99_999_999).max(99_999_999).nullable().optional();
const count = z.coerce.number().int().min(0).max(100_000).nullable().optional();

const creditBody = z.object({
  creditScore: z.coerce.number().int().min(0).max(900).nullable().optional(),
  latePayments: count,
  collections: count,
  utilizationPct: z.coerce.number().min(0).max(999).nullable().optional(),
  inquiries12m: count,
  historyMonths: count,
  openAccounts: count,
  totalDebt: money,
  revolvingAccounts: count,
  autoLoans: count,
  mortgages: count,
  repaymentBehavior: z.string().trim().max(500).nullable().optional(),
  recentTrend: z.enum(VERIFICATION_TRENDS).nullable().optional(),
  bureauNoHit: z.boolean().optional(),
  outcome: z.enum(VERIFICATION_CREDIT_OUTCOMES).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const bankingBody = z.object({
  periodStart: z.string().trim().max(20).nullable().optional(),
  periodEnd: z.string().trim().max(20).nullable().optional(),
  accountOwnershipVerified: z.boolean().optional(),
  monthlyRevenue: money,
  weeklyRevenue: money,
  revenueTrend: z.enum(VERIFICATION_TRENDS).nullable().optional(),
  recurringWeeklyIncome: money,
  recurringWeeklyExpenses: money,
  avgMonthlyNetCashFlow: money,
  avgDailyBalance: money,
  endingBalance: money,
  minimumBalance: money,
  negativeBalanceDays: count,
  nsfCount: count,
  achReturnCount: count,
  overdraftCount: count,
  avgWeeklyFuelExpense: money,
  existingDebtPayments: money,
  oneTimeDeposits: money,
  unusualTransactions: z.string().trim().max(2000).nullable().optional(),
  cashFlowVolatility: z.enum(VERIFICATION_VOLATILITY).nullable().optional(),
  bankingInconsistentWithOperations: z.boolean().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const riskBody = z.object({
  riskTier: z.enum(VERIFICATION_RISK_TIERS),
  businessAgeMonths: z.coerce.number().int().min(0).max(2400).optional(),
  authorityAgeMonths: z.coerce.number().int().min(0).max(2400).optional(),
  analystRecommendation: z.string().trim().max(4000).optional(),
  keyRisks: z.array(z.string().trim().min(1).max(300)).max(30).optional(),
});

const finalBody = z.object({
  decision: z.enum([
    'approve',
    'deposit_prepaid',
    'manager_review',
    'pending_docs',
    'declined_customer',
    'decline',
    'decline_blacklist',
  ]),
  approvedLimit: z.coerce.number().min(0).max(99_999_999).optional(),
  note: z.string().trim().max(2000).optional(),
});

const docRequestBody = z.object({
  phaseCode: z.string().trim().min(1),
  note: z.string().trim().max(2000).optional(),
  items: z
    .array(
      z.object({
        docType: z.enum(VERIFICATION_DOC_TYPES),
        label: z.string().trim().max(200).optional(),
      }),
    )
    .min(1)
    .max(20),
});

const policyBody = z.object({
  strongFactor: z.coerce.number().min(0).max(10).nullable().optional(),
  moderateFactor: z.coerce.number().min(0).max(10).nullable().optional(),
  weakFactor: z.coerce.number().min(0).max(10).nullable().optional(),
  adbReviewThreshold: z.coerce.number().min(0).max(10_000_000).optional(),
  nsfReviewThreshold: z.coerce.number().int().min(0).max(1000).optional(),
  bankFirstTruckMin: z.coerce.number().int().min(1).max(10_000).optional(),
  wexCardCutoff: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** numeric columns take text; null stays null so a factor can be UNSET, not zeroed. */
const numText = (v: number | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : String(v);

export async function verificationFlowRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  app.get('/verification/flow/cases', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    return deskService.list(ctx, listQuery.parse(request.query));
  });

  app.get<{ Params: { id: string } }>('/verification/flow/cases/:id', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const { id } = idParams.parse(request.params);
    return deskService.detail(ctx, id);
  });

  app.post<{ Params: { id: string; phase: string } }>(
    '/verification/flow/cases/:id/phases/:phase/decision',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, phase } = phaseParams.parse(request.params);
      const body = decisionBody.parse(request.body ?? {});
      const detail = await deskService.decidePhase(ctx, id, phase, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.phase_decision',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { phase, outcome: body.outcome, statusCode: detail.case.statusCode },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/screening/run',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      return deskService.runScreening(ctx, id);
    },
  );

  app.post<{ Params: { id: string; hitId: string } }>(
    '/verification/flow/cases/:id/screening/:hitId/verdict',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id, hitId } = hitParams.parse(request.params);
      const body = verdictBody.parse(request.body ?? {});
      const detail = await deskService.setScreeningVerdict(ctx, id, hitId, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.screening_verdict',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { hitId, verdict: body.verdict },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/credit-review',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = creditBody.parse(request.body ?? {});
      return deskService.saveCreditReview(ctx, id, {
        ...body,
        totalDebt: numText(body.totalDebt),
        utilizationPct: numText(body.utilizationPct),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/banking-review',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = bankingBody.parse(request.body ?? {});
      // Every money field crosses as text; `avgWeeklyNetCashFlow` is deliberately NOT accepted from
      // the client — the service derives it from the two recurring inputs.
      return deskService.saveBankingReview(ctx, id, {
        ...body,
        monthlyRevenue: numText(body.monthlyRevenue),
        weeklyRevenue: numText(body.weeklyRevenue),
        recurringWeeklyIncome: numText(body.recurringWeeklyIncome),
        recurringWeeklyExpenses: numText(body.recurringWeeklyExpenses),
        avgMonthlyNetCashFlow: numText(body.avgMonthlyNetCashFlow),
        avgDailyBalance: numText(body.avgDailyBalance),
        endingBalance: numText(body.endingBalance),
        minimumBalance: numText(body.minimumBalance),
        avgWeeklyFuelExpense: numText(body.avgWeeklyFuelExpense),
        existingDebtPayments: numText(body.existingDebtPayments),
        oneTimeDeposits: numText(body.oneTimeDeposits),
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/risk',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = riskBody.parse(request.body ?? {});
      const detail = await deskService.saveRiskAssessment(ctx, id, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.risk_assessed',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: {
          riskTier: body.riskTier,
          recommendedLimit: detail.risk?.recommendedLimit ?? null,
        },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/documents/request',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = docRequestBody.parse(request.body ?? {});
      const detail = await deskService.requestDocuments(ctx, id, body);
      await auditFromContext(ctx, {
        action: 'verification.flow.documents_requested',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { phase: body.phaseCode, count: body.items.length },
      });
      return detail;
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/documents/resume',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      return deskService.resumeAfterDocuments(ctx, id);
    },
  );

  app.post<{ Params: { id: string } }>(
    '/verification/flow/cases/:id/decision',
    auth,
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const { id } = idParams.parse(request.params);
      const body = finalBody.parse(request.body ?? {});
      const detail = await deskService.decide(ctx, id, {
        decision: body.decision,
        ...(body.approvedLimit === undefined ? {} : { approvedLimit: String(body.approvedLimit) }),
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      await auditFromContext(ctx, {
        action: 'verification.flow.decision',
        status: 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: { decision: body.decision, approvedLimit: body.approvedLimit ?? null },
      });
      return detail;
    },
  );

  // ---- policy ----

  app.get('/verification/flow/policy', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    return verificationPolicyRepo.get(ctx);
  });

  app.post(
    '/verification/flow/policy',
    // Underwriting policy sets the risk factors that price every limit, so it is admin-only —
    // deliberately narrower than the rest of the desk, and enforced as a preHandler so the check
    // cannot be skipped by an early return in the body.
    { onRequest: [app.authenticate], preHandler: [app.requireRole('admin')] },
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const body = policyBody.parse(request.body ?? {});
      const updated = await verificationPolicyRepo.update(
        ctx,
        {
          ...(body.strongFactor === undefined ? {} : { strongFactor: numText(body.strongFactor) }),
          ...(body.moderateFactor === undefined
            ? {}
            : { moderateFactor: numText(body.moderateFactor) }),
          ...(body.weakFactor === undefined ? {} : { weakFactor: numText(body.weakFactor) }),
          ...(body.adbReviewThreshold === undefined
            ? {}
            : { adbReviewThreshold: String(body.adbReviewThreshold) }),
          ...(body.nsfReviewThreshold === undefined
            ? {}
            : { nsfReviewThreshold: body.nsfReviewThreshold }),
          ...(body.bankFirstTruckMin === undefined
            ? {}
            : { bankFirstTruckMin: body.bankFirstTruckMin }),
          ...(body.wexCardCutoff === undefined ? {} : { wexCardCutoff: body.wexCardCutoff }),
        },
        ctx.userId,
      );
      await auditFromContext(ctx, {
        action: 'verification.flow.policy_updated',
        status: 'ok',
        resourceType: 'verification_policy',
        resourceId: ctx.tenantId,
        detail: { fields: Object.keys(body) },
      });
      return updated;
    },
  );
}
