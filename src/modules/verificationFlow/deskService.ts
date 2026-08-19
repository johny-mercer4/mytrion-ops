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
import { listWhere, verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import { verificationFlowBundleRepo } from '../../repos/verificationFlowBundleRepo.js';
import { verificationScreeningRepo } from '../../repos/verificationScreeningRepo.js';
import { toNumber } from '../../repos/verificationReviewRepo.js';
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
import {
  applicationService,
  withFlowSchemaGuard,
  zohoFromCtx,
  type IntakePatch,
} from './applicationService.js';
import { matchCreditPlatformBanList } from '../../integrations/creditPlatformBlacklist.js';
import { isTierPriceable } from './capacity.js';
import {
  saveBankingReview,
  saveCreditReview,
  saveRiskAssessment,
} from './deskReviews.js';
import { saveIntakeCorrection } from './deskIntake.js';
import { documentService } from './documentService.js';
import { evaluateHardStops, managerReviewIndicators } from './hardStops.js';
import { informCollectionsOfBlacklist } from './notify.js';
import {
  buildRail,
  isPhaseCode,
  PHASE_CATALOG,
  phaseApplies,
  phaseByCode,
  skipReason,
  type StoredPhase,
} from './phases.js';
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
  /**
   * Desk queue. Red and green both listed — the desk must SEE what it is waiting on.
   *
   * One round trip: rows, filtered total and the six counters come back together, and the status
   * labels are served from the process cache. This used to be four queries against a database
   * ~300ms away, each potentially opening its own TLS connection.
   */
  async list(ctx: TenantContext, filter: Parameters<typeof verificationFlowRepo.list>[1] = {}) {
    return withFlowSchemaGuard(async () => {
      const { limit, offset } = {
        limit: Math.min(Math.max(filter.limit ?? 50, 1), 2000),
        offset: Math.max(filter.offset ?? 0, 0),
      };
      const [bundle, statuses] = await Promise.all([
        verificationFlowBundleRepo.queue(ctx, listWhere(ctx, filter), limit, offset),
        verificationFlowRepo.listStatuses(),
      ]);
      const labels = new Map(statuses.map((st) => [st.code, st.label]));
      return {
        items: bundle.items.map((row) => ({
          ...row,
          statusLabel: labels.get(String(row.statusCode)) ?? row.statusCode,
        })),
        total: bundle.total,
        aggregates: bundle.aggregates,
      };
    });
  },

  /** The full case workspace: rail, findings, reviews, documents, timeline. */
  async detail(ctx: TenantContext, caseId: string) {
    return withFlowSchemaGuard(async () => {
      // ONE statement for the whole workspace — see verificationFlowBundleRepo for why.
      const bundle = await verificationFlowBundleRepo.deskDetail(ctx, caseId);
      if (!bundle?.case) throw new NotFoundError('Verification case not found');

      const row = bundle.case as unknown as VerificationCase;
      // The bundle arrives as jsonb, so the status column comes back untyped. `StoredPhase` is the
      // shape `buildRail` needs; the cast is the one place that claim is made.
      const phases = bundle.phases as unknown as StoredPhase[];
      const principals = bundle.principals;
      const documents = bundle.documents as unknown as Array<{ status: string; docType: string }>;
      const events = bundle.events;
      const hits = bundle.hits as unknown as Array<{ checkType: string; verdict: string }>;
      const credit = bundle.credit as unknown as Record<string, never> | null;
      const banking = bundle.banking as unknown as Record<string, never> | null;
      const risk = bundle.risk;
      // A tenant that has never opened the policy screen has no row yet; fall back to the seeded
      // defaults rather than spending a round trip creating one on a read.
      const policy = (bundle.policy ?? {
        strongFactor: '0.800',
        moderateFactor: null,
        weakFactor: null,
        adbReviewThreshold: '500',
        nsfReviewThreshold: 2,
        bankFirstTruckMin: 10,
        wexCardCutoff: 20,
      }) as unknown as {
        strongFactor: string | null;
        moderateFactor: string | null;
        weakFactor: string | null;
        adbReviewThreshold: string;
        nsfReviewThreshold: number;
        bankFirstTruckMin: number;
        wexCardCutoff: number;
      };

      const rail = buildRail(phases, row.applicantType);

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
            unusualTransactions: banking?.unusualTransactions ?? null,
            bankingInconsistentWithOperations: banking?.bankingInconsistentWithOperations ?? null,
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
   * Correct the application from the desk.
   *
   * WHY THE DESK HAS ITS OWN PATCH. `applicationService.patch` is Sales' door and carries Sales'
   * rule — `assertSalesMayEdit` refuses once underwriting starts, so Sales cannot rewrite a file
   * out from under a reviewer. The desk's rule is the opposite and narrower: a credit agent on the
   * phone with the applicant is the person most likely to learn the EIN was mistyped, and they may
   * fix it at ANY phase, right up until the case is decided. Routing the desk through Sales' door
   * gave a verification-only user a 403 (that route is `requireSales`) and gave everyone else a 409
   * on every case past intake — so the desk's editable application pane could not save at all.
   *
   * `refreshGate` re-evaluates completeness on the way out, which is what lets a correction made
   * here be the thing that finally unlocks a red case.
   */
  async patchIntake(ctx: TenantContext, caseId: string, patch: IntakePatch) {
    return withFlowSchemaGuard(async () => {
      const row = await verificationFlowRepo.findById(ctx, caseId);
      if (!row) throw new NotFoundError('Verification case not found');
      // Deliberately NOT `loadWorkable`: a red case is exactly the one worth correcting. Only a
      // decided case is off limits — its file is the evidence for a decision already made.
      if (row.closedAt) {
        throw new AppError('This application has already been decided and can no longer be edited.', {
          statusCode: 409,
          code: 'VERIFICATION_CASE_CLOSED',
          expose: true,
        });
      }
      // Writes the columns AND the `intake_saved` event — see `deskIntake` for why the event has to
      // be written next to the write rather than left to `refreshGate`.
      await saveIntakeCorrection(ctx, row, patch);
      /**
       * `submitting: true` — and this asymmetry with Sales is the point.
       *
       * `refreshGate` only opens the gate when the verdict is complete AND either it was already
       * open or the caller says it is submitting, because for SALES "releasing work to another
       * department is a decision the agent makes, not a side-effect of typing the last field".
       * There is no such decision here: the case is ALREADY the desk's work, and a closed gate only
       * means Sales still owes intake. Without this flag the desk's correction was accepted, the
       * gate stayed shut however complete the file became, and `intake_missing` was rewritten to
       * `[]` — so the banner degraded from "1 item outstanding" to the false "intake not started"
       * and nobody was told what to do next.
       */
      await applicationService.refreshGate(ctx, caseId, {
        submitting: true,
        actor: zohoFromCtx(ctx),
        actorName: ctx.userName || ctx.userId,
      });
      return this.detail(ctx, caseId);
    });
  },

  /**
   * Record a phase decision. Refuses to act on a phase this applicant skips — otherwise a carrier-only
   * phase could be "passed" for an owner-operator and the rail would claim authority was verified.
   */
  /**
   * Send the case BACK to a phase and re-open it for a fresh decision.
   *
   * "Return to a previous stage, refix" — the desk's own words, and the thing a forward-only machine
   * could not do. A phase signed off on the wrong reading, or on facts a correction has since changed,
   * had no remedy short of a database edit.
   *
   * THREE GUARDS, and they are the whole policy:
   *  - `loadWorkable` refuses a case still with Sales, and refuses a DECIDED one. Un-approving a live
   *    credit line is a separate, admin-gated act with its own audit trail; it is not this.
   *  - the phase must exist AND apply to this applicant. Reopening a phase that was skipped because it
   *    does not apply would park the case on a step it can never clear.
   *  - a REASON is required. This withdraws work somebody else recorded, so the timeline has to say why
   *    — `reopenTo` writes it onto the `phase_reopened` event as the note.
   *
   * Everything downstream is un-decided too (see `verificationCaseAssetRepo.reopenPhase`): a later
   * sign-off made on facts this phase is reconsidering is not a sign-off worth keeping.
   */
  async reopenPhase(
    ctx: TenantContext,
    caseId: string,
    phaseCode: string,
    input: { reason: string },
  ) {
    return withFlowSchemaGuard(async () => {
      const row = await loadWorkable(ctx, caseId);
      if (!isPhaseCode(phaseCode)) {
        throw new NotFoundError(`Unknown verification phase: ${phaseCode}`);
      }
      const descriptor = phaseByCode(phaseCode);
      if (descriptor && !phaseApplies(descriptor, row.applicantType)) {
        throw new AppError(
          `${descriptor.label} does not apply to this applicant, so there is nothing to reopen.`,
          { statusCode: 409, code: 'VERIFICATION_PHASE_NOT_APPLICABLE', expose: true },
        );
      }
      const reason = input.reason.trim();
      if (!reason) {
        throw new AppError('Say why the phase is being reopened — it withdraws a recorded decision.', {
          statusCode: 422,
          code: 'VERIFICATION_REOPEN_REASON_REQUIRED',
          expose: true,
        });
      }

      /**
       * Phase ORDER is the catalog's, so the repo never re-derives the ten-phase sequence. `skipped`
       * rows are left alone: they were never decided, and resetting one to not-started would make a
       * phase that does not apply look outstanding.
       */
      const after = PHASE_CATALOG.filter(
        (d) => d.order > (descriptor?.order ?? 0) && phaseApplies(d, row.applicantType),
      ).map((d) => d.code);

      await verificationCaseAssetRepo.reopenPhase(ctx, caseId, {
        phaseCode,
        codesAfter: after,
      });
      await verificationFlowRepo.reopenTo(ctx, caseId, {
        phaseCode,
        statusCode: VERIFICATION_STATUS.inReview,
        reason,
        ...(zohoFromCtx(ctx) ? { actorZohoUserId: zohoFromCtx(ctx) } : {}),
        ...(ctx.userName ? { actorName: ctx.userName } : {}),
      });

      return this.detail(ctx, caseId);
    });
  },

  async decidePhase(
    ctx: TenantContext,
    caseId: string,
    phaseCode: string,
    input: {
      outcome: VerificationPhaseOutcome;
      note?: string | undefined;
      findings?: Record<string, unknown> | undefined;
    },
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
        ...(input.findings === undefined ? {} : { findings: input.findings }),
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

      /**
       * TWO LISTS, and the first one is the one that matters.
       *
       * `verification_blacklist_entries` (ours) holds the entries this desk has added itself through
       * `decline_blacklist` — and nothing else, because nothing else writes it. The list Octane
       * actually maintains is the credit platform's `public.blacklist_entries`, 6,803 active rows, so
       * screening against ours alone returned "no match" on every case in the system. Both are matched;
       * a hit from either goes to a credit agent for a verdict, exactly as the SOP requires.
       */
      const [ours, platform] = await Promise.all([
        verificationScreeningRepo.matchBlacklist(ctx, identifiers.map((i) => i.hash)),
        matchCreditPlatformBanList(identifiers.map((i) => ({ entryType: i.entryType, value: i.value }))),
      ]);
      const byHash = new Map(identifiers.map((i) => [i.hash, i]));
      const displayByType = new Map(identifiers.map((i) => [i.entryType, i.display]));

      const duplicates = await verificationScreeningRepo.matchDuplicates(ctx, caseId, {
        ein: row.ein,
        mc: row.mc,
        dot: row.dot,
        email: row.email,
        phone: row.phone,
        companyName: row.companyName,
      });

      const hits = [
        ...ours.map((entry) => ({
          checkType: 'blacklist' as const,
          entryType: entry.entryType,
          matchedValueDisplay: byHash.get(entry.valueHash)?.display ?? entry.valueDisplay,
          matchedEntryId: entry.id,
          verdict: 'unverified' as const,
        })),
        ...platform.hits.map((hit) => ({
          checkType: 'blacklist' as const,
          entryType: hit.entryType,
          // The MASKED form of our own identifier, never the platform's stored plaintext — a hit says
          // "this applicant's email is listed", and printing the listed value adds nothing the
          // reviewer needs and everything a screenshot should not carry.
          matchedValueDisplay: displayByType.get(hit.entryType) ?? hit.cpType,
          // `cp:` prefixed so a platform row can never collide with one of our own text ids, and so
          // the desk can tell the reviewer which list a hit came from.
          matchedEntryId: `cp:${hit.entryId}`,
          note: [
            `Credit platform ban list (${hit.cpType})`,
            hit.reason?.trim() ? hit.reason.trim() : null,
            hit.addedBy?.trim() ? `added by ${hit.addedBy.trim()}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
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
          /**
           * WHETHER THE BAN LIST WAS ACTUALLY READ.
           *
           * A lookup that failed must not read as a clear. The desk shows this verbatim, so "no match"
           * and "could not reach the list" are different sentences on screen — which is the whole
           * reason `matchCreditPlatformBanList` returns a flag instead of throwing.
           */
          banList: {
            source: 'credit_platform.public.blacklist_entries',
            available: platform.available,
            error: platform.error,
            platformHits: platform.hits.length,
            ownHits: ours.length,
          },
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
    const added = await verificationScreeningRepo.addBlacklistEntries(
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

    // SOP Phase 3: "Decline + Blacklist -> Inform Collections Department." Blacklisting silently
    // would leave the team that chases money unaware an applicant was refused for fraud.
    await informCollectionsOfBlacklist(ctx, {
      caseId: row.id,
      applicantName:
        row.companyName ?? [row.firstName, row.lastName].filter(Boolean).join(' ') ?? row.id,
      identifierCount: added,
      reason,
      actorName: ctx.userName || ctx.userId,
    });

    return added;
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
