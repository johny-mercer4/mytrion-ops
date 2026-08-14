/**
 * Verification-desk orchestration — phases 2 through 10.
 *
 * Every phase decision goes through `decidePhase`, which asks the pure state machine what should
 * change and hands the answer to the one repo method that also writes the audit event. The desk
 * never assembles a patch itself, so "what a pass does" has exactly one definition.
 *
 * The gate is enforced at the top of every mutating call: a red case (intake incomplete) cannot be
 * worked. That is the whole point of `verification_process`, and checking it in the service rather
 * than the route means it holds for any future caller too.
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
import {
  VERIFICATION_PHASE,
  VERIFICATION_STATUS,
  type VerificationCase,
  type VerificationDocType,
  type VerificationPhaseOutcome,
  type VerificationRiskTier,
  type VerificationScreeningVerdict,
} from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { withFlowSchemaGuard, zohoFromCtx } from './applicationService.js';
import { isTierPriceable } from './capacity.js';
import {
  saveBankingReview,
  saveCreditReview,
  saveRiskAssessment,
} from './deskReviews.js';
import { documentService } from './documentService.js';
import { evaluateHardStops, managerReviewIndicators } from './hardStops.js';
import { PHASE_CATALOG, isPhaseCode, phaseApplies, phaseByCode, skipReason } from './phases.js';
import { collectIdentifiers, screeningVerdictSummary } from './screening.js';
import {
  FINAL_DECISIONS,
  resolveDocumentReturnPhase,
  resolvePhaseDecision,
  resolveReviewOrder,
  resolveUnderwritingRoute,
  type FinalDecision,
} from './stateMachine.js';

/** Red cases are visible to the desk but not workable — Sales still owes intake. */
async function loadWorkable(ctx: TenantContext, caseId: string): Promise<VerificationCase> {
  const row = await verificationFlowRepo.findById(ctx, caseId);
  if (!row) throw new NotFoundError('Verification case not found');
  if (!row.verificationProcess) {
    throw new AppError(
      `This application is still with Sales — ${row.intakeMissing.length} item(s) outstanding. It cannot be underwritten until the application is complete.`,
      { statusCode: 409, code: 'VERIFICATION_INTAKE_INCOMPLETE', expose: true },
    );
  }
  if (row.closedAt) {
    throw new AppError('This application has already been decided.', {
      statusCode: 409,
      code: 'VERIFICATION_CASE_CLOSED',
      expose: true,
    });
  }
  return row;
}

export const deskService = {
  /** Desk queue. Red and green both listed — the desk must SEE what it is waiting on. */
  async list(
    ctx: TenantContext,
    filter: Parameters<typeof verificationFlowRepo.list>[1] = {},
  ) {
    return withFlowSchemaGuard(async () => {
      const [items, total, aggregates, statuses] = await Promise.all([
        verificationFlowRepo.list(ctx, filter),
        verificationFlowRepo.count(ctx, filter),
        verificationFlowRepo.deskAggregates(ctx),
        verificationFlowRepo.listStatuses(),
      ]);
      const labels = new Map(statuses.map((s) => [s.code, s.label]));
      return {
        items: items.map((row) => ({
          ...row,
          statusLabel: labels.get(row.statusCode) ?? row.statusCode,
        })),
        total,
        aggregates,
      };
    });
  },

  /** The full case workspace: rail, findings, reviews, documents, timeline. */
  async detail(ctx: TenantContext, caseId: string) {
    return withFlowSchemaGuard(async () => {
      const row = await verificationFlowRepo.findById(ctx, caseId);
      if (!row) throw new NotFoundError('Verification case not found');

      const [phases, principals, documents, events, hits, credit, banking, risk, policy] =
        await Promise.all([
          verificationCaseAssetRepo.listPhases(ctx, caseId),
          verificationCaseAssetRepo.listPrincipals(ctx, caseId),
          verificationCaseAssetRepo.listDocuments(ctx, caseId),
          verificationFlowRepo.listEvents(ctx, caseId),
          verificationScreeningRepo.listHits(ctx, caseId),
          verificationReviewRepo.findCredit(ctx, caseId),
          verificationReviewRepo.findBanking(ctx, caseId),
          verificationReviewRepo.findRisk(ctx, caseId),
          verificationPolicyRepo.get(ctx),
        ]);

      const byCode = new Map(phases.map((p) => [p.phaseCode, p]));
      const rail = PHASE_CATALOG.map((descriptor) => {
        const stored = byCode.get(descriptor.code);
        const applies = phaseApplies(descriptor, row.applicantType);
        return {
          code: descriptor.code,
          label: descriptor.label,
          order: descriptor.order,
          description: descriptor.description,
          applies,
          skipReason: skipReason(descriptor, row.applicantType),
          status: stored?.status ?? (applies ? 'not_started' : 'skipped'),
          outcome: stored?.outcome ?? null,
          findings: stored?.findings ?? {},
          note: stored?.note ?? null,
          decidedAt: stored?.decidedAt ?? null,
          decidedBy: stored?.decidedBy ?? null,
        };
      });

      const routing = { bankFirstTruckMin: policy.bankFirstTruckMin, wexCardCutoff: policy.wexCardCutoff };
      const factors = {
        strongFactor: toNumber(policy.strongFactor),
        moderateFactor: toNumber(policy.moderateFactor),
        weakFactor: toNumber(policy.weakFactor),
      };

      return {
        case: row,
        rail,
        principals,
        documents,
        events,
        screening: {
          hits,
          summary: screeningVerdictSummary(hits),
        },
        credit: credit ?? null,
        banking: banking ?? null,
        risk: risk ?? null,
        hardStops: evaluateHardStops({
          avgWeeklyNetCashFlow: toNumber(banking?.avgWeeklyNetCashFlow),
          bureauNoHit: credit?.bureauNoHit ?? false,
        }),
        indicators: managerReviewIndicators(
          {
            revenueTrend: banking?.revenueTrend ?? null,
            avgDailyBalance: toNumber(banking?.avgDailyBalance),
            negativeBalanceDays: banking?.negativeBalanceDays ?? null,
            overdraftCount: banking?.overdraftCount ?? null,
            nsfCount: banking?.nsfCount ?? null,
            achReturnCount: banking?.achReturnCount ?? null,
            cashFlowVolatility: banking?.cashFlowVolatility ?? null,
            existingDebtPayments: toNumber(banking?.existingDebtPayments),
            oneTimeDeposits: toNumber(banking?.oneTimeDeposits),
            creditRecentTrend: credit?.recentTrend ?? null,
          },
          {
            adbReviewThreshold: toNumber(policy.adbReviewThreshold) ?? 500,
            nsfReviewThreshold: policy.nsfReviewThreshold,
          },
        ),
        routing: {
          underwritingRoute: resolveUnderwritingRoute(row.fuelCardsRequested, routing),
          reviewOrder: resolveReviewOrder(row.applicantType, row.trucksCount, routing),
          bankFirstTruckMin: routing.bankFirstTruckMin,
          wexCardCutoff: routing.wexCardCutoff,
        },
        policy: {
          ...factors,
          tierPriceable: {
            strong: isTierPriceable('strong', factors),
            moderate: isTierPriceable('moderate', factors),
            weak: isTierPriceable('weak', factors),
          },
        },
      };
    });
  },

  /**
   * Record a phase decision. Refuses to act on a phase this applicant skips — otherwise a carrier-only
   * phase could be "passed" for an owner-operator and the rail would claim authority was verified.
   */
  async decidePhase(
    ctx: TenantContext,
    caseId: string,
    phaseCode: string,
    input: { outcome: VerificationPhaseOutcome; note?: string | undefined },
  ) {
    return withFlowSchemaGuard(async () => {
      const row = await loadWorkable(ctx, caseId);
      if (!isPhaseCode(phaseCode)) {
        throw new NotFoundError(`Unknown verification phase: ${phaseCode}`);
      }
      const descriptor = phaseByCode(phaseCode);
      if (descriptor && !phaseApplies(descriptor, row.applicantType) && input.outcome !== 'skip') {
        throw new AppError(
          `${descriptor.label} does not apply to this applicant. ${skipReason(descriptor, row.applicantType) ?? ''}`.trim(),
          { statusCode: 409, code: 'VERIFICATION_PHASE_NOT_APPLICABLE', expose: true },
        );
      }

      const patch = resolvePhaseDecision({
        phase: phaseCode,
        outcome: input.outcome,
        applicantType: row.applicantType,
        note: input.note,
      });

      await verificationFlowRepo.applyTransition(ctx, caseId, {
        ...patch,
        decidedPhase: phaseCode,
        outcome: input.outcome,
        actorZohoUserId: zohoFromCtx(ctx),
        actorName: ctx.userName || ctx.userId,
        ...(patch.eventNotes === undefined ? {} : { eventNotes: patch.eventNotes }),
      });

      // A blacklist decline must also populate the blacklist, or the next application from the same
      // applicant sails through Check A and the decision means nothing.
      if (input.outcome === 'decline_blacklist') {
        await this.blacklistCase(ctx, row, input.note);
      }
      return this.detail(ctx, caseId);
    });
  },

  /**
   * Phase 3. Runs both checks against our own tables and stores the hits.
   *
   * Re-running preserves verdicts an agent already recorded — see `replaceHits`.
   */
  async runScreening(ctx: TenantContext, caseId: string) {
    return withFlowSchemaGuard(async () => {
      const row = await loadWorkable(ctx, caseId);
      const identifiers = collectIdentifiers({
        companyName: row.companyName,
        firstName: row.firstName,
        lastName: row.lastName,
        ein: row.ein,
        ssnLast4: row.ssnLast4,
        phone: row.phone,
        email: row.email,
        businessAddress: row.businessAddress,
        residentialAddress: row.residentialAddress,
        mc: row.mc,
        dot: row.dot,
        applicantIp: null,
      });

      const blacklisted = await verificationScreeningRepo.matchBlacklist(
        ctx,
        identifiers.map((i) => i.hash),
      );
      const byHash = new Map(identifiers.map((i) => [i.hash, i]));

      const duplicates = await verificationScreeningRepo.matchDuplicates(ctx, caseId, {
        ein: row.ein,
        mc: row.mc,
        dot: row.dot,
        email: row.email,
        phone: row.phone,
        companyName: row.companyName,
      });

      const hits = [
        ...blacklisted.map((entry) => ({
          checkType: 'blacklist' as const,
          entryType: entry.entryType,
          matchedValueDisplay: byHash.get(entry.valueHash)?.display ?? entry.valueDisplay,
          matchedEntryId: entry.id,
          verdict: 'unverified' as const,
        })),
        ...duplicates.map((dup) => ({
          checkType: 'duplicate' as const,
          entryType: dup.entryType,
          matchedValueDisplay: dup.display,
          matchedCaseId: dup.id,
          matchedCaseLabel: dup.display,
          verdict: 'unverified' as const,
        })),
      ];

      const stored = await verificationScreeningRepo.replaceHits(ctx, caseId, hits);
      await verificationCaseAssetRepo.upsertPhase(ctx, caseId, {
        phaseCode: VERIFICATION_PHASE.screening,
        status: 'in_progress',
        findings: {
          ranAt: new Date().toISOString(),
          identifiersScreened: identifiers.length,
          blacklistHits: stored.filter((h) => h.checkType === 'blacklist').length,
          duplicateHits: stored.filter((h) => h.checkType === 'duplicate').length,
        },
      });
      return this.detail(ctx, caseId);
    });
  },

  async setScreeningVerdict(
    ctx: TenantContext,
    caseId: string,
    hitId: string,
    input: { verdict: VerificationScreeningVerdict; note?: string | undefined },
  ) {
    return withFlowSchemaGuard(async () => {
      await loadWorkable(ctx, caseId);
      const updated = await verificationScreeningRepo.setVerdict(ctx, caseId, hitId, {
        verdict: input.verdict,
        verifiedBy: zohoFromCtx(ctx),
        note: input.note,
      });
      if (!updated) throw new NotFoundError('Screening hit not found');
      return this.detail(ctx, caseId);
    });
  },

  /** Add every identifier of a declined case to the blacklist, so Check A catches the next one. */
  async blacklistCase(ctx: TenantContext, row: VerificationCase, reason?: string): Promise<number> {
    const identifiers = collectIdentifiers({
      companyName: row.companyName,
      firstName: row.firstName,
      lastName: row.lastName,
      ein: row.ein,
      ssnLast4: row.ssnLast4,
      phone: row.phone,
      email: row.email,
      businessAddress: row.businessAddress,
      residentialAddress: row.residentialAddress,
      mc: row.mc,
      dot: row.dot,
      applicantIp: null,
    });
    return verificationScreeningRepo.addBlacklistEntries(
      ctx,
      identifiers.map((i) => ({
        entryType: i.entryType,
        valueHash: i.hash,
        valueLast4: i.last4,
        valueDisplay: i.display,
        reason: reason ?? 'Confirmed blacklist match or fraud at underwriting.',
        sourceCaseId: row.id,
        addedBy: zohoFromCtx(ctx) ?? ctx.userId,
      })),
    );
  },

  // ---- Phase 6 / 9 reviews (see deskReviews.ts) ----

  async saveCreditReview(ctx: TenantContext, caseId: string, input: Record<string, unknown>) {
    return withFlowSchemaGuard(async () => {
      await loadWorkable(ctx, caseId);
      await saveCreditReview(ctx, caseId, input);
      return this.detail(ctx, caseId);
    });
  },

  async saveBankingReview(ctx: TenantContext, caseId: string, input: Record<string, unknown>) {
    return withFlowSchemaGuard(async () => {
      await loadWorkable(ctx, caseId);
      await saveBankingReview(ctx, caseId, input);
      return this.detail(ctx, caseId);
    });
  },

  async saveRiskAssessment(
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
    return withFlowSchemaGuard(async () => {
      await loadWorkable(ctx, caseId);
      await saveRiskAssessment(ctx, caseId, input);
      return this.detail(ctx, caseId);
    });
  },

  // ---- documents ----

  async requestDocuments(
    ctx: TenantContext,
    caseId: string,
    input: { phaseCode: string; items: Array<{ docType: VerificationDocType; label?: string | undefined }>; note?: string | undefined },
  ) {
    return withFlowSchemaGuard(async () => {
      const row = await loadWorkable(ctx, caseId);
      for (const item of input.items) {
        await documentService.request(ctx, caseId, {
          docType: item.docType,
          label: item.label,
          phaseCode: input.phaseCode,
        });
      }
      // Recording the ask as a phase decision is what parks the case on `pending_docs` and stamps
      // `requested_in_phase` — the two halves of the return-to-the-phase-that-asked rule.
      const patch = resolvePhaseDecision({
        phase: isPhaseCode(input.phaseCode) ? input.phaseCode : VERIFICATION_PHASE.intake,
        outcome: 'pending_docs',
        applicantType: row.applicantType,
        note: input.note ?? `Requested ${input.items.length} document(s) from Sales.`,
      });
      await verificationFlowRepo.applyTransition(ctx, caseId, {
        ...patch,
        decidedPhase: input.phaseCode,
        outcome: 'pending_docs',
        eventType: 'docs_requested',
        actorZohoUserId: zohoFromCtx(ctx),
        actorName: ctx.userName || ctx.userId,
        ...(patch.eventNotes === undefined ? {} : { eventNotes: patch.eventNotes }),
      });
      return this.detail(ctx, caseId);
    });
  },

  /**
   * Resume once the outstanding asks are fulfilled. Returns the case to the phase that RAISED the
   * request, per the SOP, rather than to the start of the flow.
   */
  async resumeAfterDocuments(ctx: TenantContext, caseId: string) {
    return withFlowSchemaGuard(async () => {
      const row = await loadWorkable(ctx, caseId);
      const outstanding = await verificationCaseAssetRepo.listOutstandingRequests(ctx, caseId);
      if (outstanding.length > 0) {
        throw new AppError(
          `${outstanding.length} requested document(s) are still outstanding.`,
          { statusCode: 409, code: 'VERIFICATION_DOCS_OUTSTANDING', expose: true },
        );
      }
      const documents = await verificationCaseAssetRepo.listDocuments(ctx, caseId);
      const lastRequestPhase =
        documents.find((d) => d.requestedInPhase)?.requestedInPhase ?? row.phaseCode;
      const target = resolveDocumentReturnPhase(lastRequestPhase, row.applicantType);

      await verificationFlowRepo.applyTransition(ctx, caseId, {
        phaseCode: target,
        statusCode: VERIFICATION_STATUS.inReview,
        phaseStatus: 'in_progress',
        decidedPhase: target,
        closed: false,
        eventType: 'docs_received',
        eventNotes: `Documents received — resumed at ${phaseByCode(target)?.label ?? target}.`,
        actorZohoUserId: zohoFromCtx(ctx),
        actorName: ctx.userName || ctx.userId,
      });
      return this.detail(ctx, caseId);
    });
  },

  // ---- Phase 10 ----

  async decide(
    ctx: TenantContext,
    caseId: string,
    input: { decision: FinalDecision; approvedLimit?: string | undefined; note?: string | undefined },
  ) {
    return withFlowSchemaGuard(async () => {
      const row = await loadWorkable(ctx, caseId);
      const statusCode = FINAL_DECISIONS[input.decision];

      if (input.decision === 'approve' && !input.approvedLimit) {
        throw new AppError('An approved credit limit is required to approve an application.', {
          statusCode: 422,
          code: 'VERIFICATION_LIMIT_REQUIRED',
          expose: true,
        });
      }

      const closed =
        statusCode !== VERIFICATION_STATUS.managerReview &&
        statusCode !== VERIFICATION_STATUS.pendingDocs;

      await verificationFlowRepo.applyTransition(ctx, caseId, {
        phaseCode: VERIFICATION_PHASE.decision,
        statusCode,
        phaseStatus: closed ? 'passed' : 'manager_review',
        decidedPhase: VERIFICATION_PHASE.decision,
        outcome: input.decision === 'approve' ? 'pass' : undefined,
        closed,
        eventType: 'decision',
        eventNotes: input.note ?? `Final decision: ${input.decision}.`,
        actorZohoUserId: zohoFromCtx(ctx),
        actorName: ctx.userName || ctx.userId,
        findings: { decision: input.decision, approvedLimit: input.approvedLimit ?? null },
      });

      if (input.approvedLimit) {
        await verificationFlowRepo.patchIntake(ctx, caseId, {
          approvedLimitAmount: input.approvedLimit,
        });
      }
      if (input.decision === 'decline_blacklist') {
        await this.blacklistCase(ctx, row, input.note);
      }
      return this.detail(ctx, caseId);
    });
  },
};
