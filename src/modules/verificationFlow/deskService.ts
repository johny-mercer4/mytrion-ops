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
  VERIFICATION_STATUS,
  type VerificationCase,
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
import { isTierPriceable } from './capacity.js';
import {
  saveBankingReview,
  saveCreditReview,
  saveRiskAssessment,
} from './deskReviews.js';
import { saveIntakeCorrection } from './deskIntake.js';
import {
  deriveRiskSignals,
  VERIFICATION_POLICY_DEFAULTS,
  type VerificationPolicyShape,
} from './hardStops.js';
import {
  buildRail,
  isPhaseCode,
  PHASE_CATALOG,
  phaseApplies,
  phaseByCode,
  skipReason,
  type StoredPhase,
} from './phases.js';
import { runAuthorityLookup } from './deskAuthority.js';
import { saveHighwayReview, type HighwayReviewInput } from './deskHighway.js';
import { requestDocuments, resumeAfterDocuments } from './deskDocuments.js';
import { blacklistCaseIdentifiers, runCaseScreening } from './deskScreening.js';
import { recordFinalDecision, type FinalDecisionInput } from './deskDecision.js';
import { screeningVerdictSummary } from './screening.js';
import {
  resolvePhaseDecision,
  resolveReviewOrder,
  resolveUnderwritingRoute,
} from './stateMachine.js';

/** Red cases are visible to the desk but not workable — Sales still owes intake. */
export async function loadWorkable(ctx: TenantContext, caseId: string): Promise<VerificationCase> {
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

/**
 * The gate for Phase 3 screening, which is the one thing worth doing to a RED case.
 *
 * `loadWorkable` refuses a case Sales has not submitted, and for every decision that is right. It is
 * wrong for the ban list: screening needs a name, an email, a phone and an authority number, all of
 * which arrive with the Deal, and the answer is most useful BEFORE an agent spends a week collecting
 * documents for an applicant who was banned the whole time. Nothing here is a decision — the hits
 * land as `unverified` and a credit agent still rules on each one through `loadWorkable`.
 *
 * A DECIDED case is still refused. Re-screening after the fact would rewrite the findings that the
 * decision was recorded against.
 */
async function loadScreenable(ctx: TenantContext, caseId: string): Promise<VerificationCase> {
  const row = await verificationFlowRepo.findById(ctx, caseId);
  if (!row) throw new NotFoundError('Verification case not found');
  if (row.closedAt) {
    throw new AppError('This application has already been decided.', {
      statusCode: 409,
      code: 'VERIFICATION_CASE_CLOSED',
      expose: true,
    });
  }
  return row;
}

/**
 * The shape every "record what the reviewer worked out" call shares: the workable gate, the schema
 * guard, the delegate, and a fresh detail on the way out.
 *
 * Four of these had the same five lines written out four times, and the fifth (Phase 8) would have
 * made five. Folding them means the gate for a reviewer's own recording is decided in ONE place — and
 * that mattered the moment Phase 8 had to answer the same question, because getting it wrong there
 * would have let a red case be underwritten.
 */
async function gatedWrite<T>(
  ctx: TenantContext,
  caseId: string,
  write: (row: VerificationCase) => Promise<T>,
) {
  return withFlowSchemaGuard(async () => {
    const row = await loadWorkable(ctx, caseId);
    await write(row);
    return deskService.detail(ctx, caseId);
  });
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
      // defaults rather than spending a round trip creating one on a read. The cast is the one place
      // the jsonb bundle is claimed to carry the policy shape.
      const policy = (bundle.policy ??
        VERIFICATION_POLICY_DEFAULTS) as unknown as VerificationPolicyShape;

      const rail = buildRail(phases, row.applicantType);
      const signals = deriveRiskSignals(credit, banking, {
        adbReviewThreshold: toNumber(policy.adbReviewThreshold) ?? 500,
        nsfReviewThreshold: policy.nsfReviewThreshold,
      }, toNumber);

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
        ...signals,
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
        await blacklistCaseIdentifiers(ctx, row, input.note);
      }
      return this.detail(ctx, caseId);
    });
  },

  /**
   * Phase 3. Runs all four probes and stores the hits (see deskScreening.ts).
   *
   * SCREENED THROUGH `loadScreenable`, NOT `loadWorkable` — this is the one desk call a red case
   * allows. Waiting for Sales to finish intake before asking whether the applicant is banned gets the
   * answer after the chasing is done; the ban list needs a name, an email and a phone, and a red case
   * has those. Every other desk call, this phase's own verdicts included, stays on `loadWorkable`.
   *
   * Re-running preserves verdicts an agent already recorded — see `replaceHits`.
   */
  async runScreening(ctx: TenantContext, caseId: string) {
    return withFlowSchemaGuard(async () => {
      const row = await loadScreenable(ctx, caseId);
      await runCaseScreening(ctx, row);
      return this.detail(ctx, caseId);
    });
  },

  /**
   * Phase 4. Reads the FMCSA register, the Socrata census and the insurance history (deskAuthority.ts).
   *
   * `loadScreenable` for the same reason as screening: this is an OBSERVATION, its keys (USDOT, MC,
   * company name) arrive with the Deal, and gating it behind a complete intake would make it
   * unreachable — every carrier case in the system is still red. Non-carriers are refused inside.
   */
  async runAuthorityLookup(ctx: TenantContext, caseId: string) {
    return withFlowSchemaGuard(async () => {
      const row = await loadScreenable(ctx, caseId);
      await runAuthorityLookup(ctx, row);
      return this.detail(ctx, caseId);
    });
  },

  /**
   * Phase 8. Stores the Highway operational review the agent read by hand (deskHighway.ts).
   *
   * `loadWorkable`, NOT `loadScreenable`: unlike screening and the register lookup this is not an
   * observation of an external source we can make at any time — it is the reviewer's own reading, so
   * it belongs with the decisions and needs a complete case. Non-carriers are refused inside.
   */
  async saveHighwayReview(ctx: TenantContext, caseId: string, input: HighwayReviewInput) {
    return gatedWrite(ctx, caseId, (row) => saveHighwayReview(ctx, row, input));
  },

  /** A verdict is a decision, so it needs a complete case — `loadWorkable`, not `loadScreenable`. */
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

  // ---- Phase 6 / 9 reviews (see deskReviews.ts) ----

  async saveCreditReview(ctx: TenantContext, caseId: string, input: Record<string, unknown>) {
    return gatedWrite(ctx, caseId, () => saveCreditReview(ctx, caseId, input));
  },

  async saveBankingReview(ctx: TenantContext, caseId: string, input: Record<string, unknown>) {
    return gatedWrite(ctx, caseId, () => saveBankingReview(ctx, caseId, input));
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
    return gatedWrite(ctx, caseId, () => saveRiskAssessment(ctx, caseId, input));
  },


  // ---- documents (see deskDocuments.ts) ----

  requestDocuments,
  resumeAfterDocuments,

  // ---- Phase 10 ----

  /**
   * Phase 10 — the final decision. The seven outcomes and what the SOP requires of each live in
   * `deskDecision.ts`; this stays the one door the routes come through, as every other phase does.
   */
  async decide(ctx: TenantContext, caseId: string, input: FinalDecisionInput) {
    return recordFinalDecision(ctx, caseId, input);
  },
};
