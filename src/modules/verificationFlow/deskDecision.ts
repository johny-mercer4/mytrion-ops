/**
 * Phase 10 — the final underwriting decision.
 *
 * Seven outcomes, and the SOP asks something different of each. What was here before treated them as
 * one shape — pick a code, optionally type a note — so six of the seven could be recorded with no
 * reason at all, and the two that are not really decisions at all (manager review, pending documents)
 * were indistinguishable from the five that close the case forever.
 *
 * THE RULES BELOW ARE THE SOP'S OWN WORDS, not house policy:
 *
 *  - `approve` "Assign approved credit limit" — a limit, and a risk assessment to price it against.
 *  - `deposit_prepaid` "Record reason and conditions" — conditions, and WHICH instrument, because the
 *    status column cannot tell a 1:1 deposit from a prepaid account and the two are different deals.
 *  - `declined_customer` "Record specific decline reason" — a reason.
 *  - `pending_docs` "Return to the exact phase that generated the request" — which requires that a
 *    request exist. See the guard for what used to happen instead.
 *  - `manager_review` is defined by the SOP's own footnote: "information is inconsistent, borderline,
 *    unusual, or an exception is being considered". A referral that does not say which is not a
 *    referral, so the trigger is required.
 *  - `decline` / `decline_blacklist` — a reason, which for the blacklist arm becomes the ban's stored
 *    `reason` and is read by every future screening that hits it.
 *
 * Only `approve` gets an exception to "note required": a standard LOC at the recommended limit needs
 * no explanation. Going ABOVE the recommended limit does, and that is the one case where the note
 * becomes mandatory again.
 */
import { AppError } from '../../lib/errors.js';
import { verificationCaseAssetRepo } from '../../repos/verificationCaseAssetRepo.js';
import { verificationFlowRepo } from '../../repos/verificationFlowRepo.js';
import { verificationReviewRepo } from '../../repos/verificationReviewRepo.js';
import { VERIFICATION_PHASE, VERIFICATION_STATUS } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { FINAL_DECISIONS, type FinalDecision } from './stateMachine.js';
import { blacklistCaseIdentifiers } from './deskScreening.js';
import { withFlowSchemaGuard, zohoFromCtx } from './applicationService.js';
import { deskService, loadWorkable } from './deskService.js';
import { documentReturnPhase } from './deskDocuments.js';

/** Which instrument a `deposit_prepaid` outcome actually is. The status column cannot say. */
export type DepositInstrument = 'deposit_1_1' | 'prepaid';

export interface FinalDecisionInput {
  decision: FinalDecision;
  approvedLimit?: number | undefined;
  note?: string | undefined;
  instrument?: DepositInstrument | undefined;
}

/**
 * Decisions that must carry a reason, and the sentence to say when they do not.
 *
 * Phrased as what the reviewer has to do, not as what the validator rejected — this reaches them as a
 * toast on a decision they are in the middle of making.
 */
const REASON_REQUIRED: Partial<Record<FinalDecision, string>> = {
  deposit_prepaid:
    'Record the reason and the conditions of the deposit or prepaid arrangement before recording it.',
  manager_review:
    'Say what is being referred — which information is inconsistent, borderline or unusual, or what exception is being considered.',
  declined_customer: 'Record the specific reason the applicant gave for revoking the application.',
  decline: 'Record the reason for the decline.',
  decline_blacklist:
    'Record what was confirmed — this reason is stored on the blacklist entry and is what the next screening will show.',
};

function requireReason(decision: FinalDecision, note: string | undefined): void {
  const message = REASON_REQUIRED[decision];
  if (message && !note) {
    throw new AppError(message, {
      statusCode: 422,
      code: 'VERIFICATION_DECISION_REASON_REQUIRED',
      expose: true,
    });
  }
}

/**
 * Record the final decision.
 *
 * `loadWorkable` first, as every write on this desk does — it refuses a case that is already decided
 * and one held at a red hard stop.
 */
export async function recordFinalDecision(
  ctx: TenantContext,
  caseId: string,
  input: FinalDecisionInput,
) {
  return withFlowSchemaGuard(async () => {
    const row = await loadWorkable(ctx, caseId);
    const statusCode = FINAL_DECISIONS[input.decision];
    const note = input.note?.trim() || undefined;

    requireReason(input.decision, note);

    /**
     * Extra findings each arm contributes. Kept on the transition's `findings` rather than in new
     * columns: these are facts about a decision that has already been made, the phase row is where
     * every other phase's ruling lives, and the underwriting summary already reads the rail.
     */
    const extra: Record<string, unknown> = {};

    if (input.decision === 'approve') {
      if (!input.approvedLimit || input.approvedLimit <= 0) {
        throw new AppError('An approved credit limit is required to approve an application.', {
          statusCode: 422,
          code: 'VERIFICATION_LIMIT_REQUIRED',
          expose: true,
        });
      }

      /**
       * A limit has to be priced against something.
       *
       * Phase 9 computes the recommended limit from the stored banking review; approving with no
       * assessment at all means the number in the box came from nowhere, and the "recommended limit"
       * line of the underwriting summary would be blank on an approved case.
       */
      const risk = await verificationReviewRepo.findRisk(ctx, caseId);
      if (!risk) {
        throw new AppError(
          'Assess the risk tier and credit capacity in Phase 9 before approving — there is no recommended limit to approve against.',
          { statusCode: 422, code: 'VERIFICATION_RISK_REQUIRED', expose: true },
        );
      }

      /**
       * Above the recommended limit is an EXCEPTION, not a standard LOC.
       *
       * Not refused: the SOP routes reduced-or-standard LOC approvals through Borderline / Exception,
       * where a manager may approve either — so a manager using this pane has to be able to record
       * one. What it must not be is silent, because "management exceptions" is a line of the
       * underwriting summary and an approval over capacity is exactly what belongs on it.
       */
      const recommended = risk.recommendedLimit === null ? null : Number(risk.recommendedLimit);
      if (recommended !== null && input.approvedLimit > recommended) {
        if (!note) {
          throw new AppError(
            `$${input.approvedLimit.toLocaleString()} is above the recommended limit of $${recommended.toLocaleString()}. Record the reason for the exception.`,
            { statusCode: 422, code: 'VERIFICATION_EXCEPTION_REASON_REQUIRED', expose: true },
          );
        }
        extra.exceptionOverRecommended = true;
        extra.recommendedLimitAtDecision = recommended;
      }
    }

    if (input.decision === 'deposit_prepaid') {
      if (!input.instrument) {
        throw new AppError(
          'Record which arrangement this is — a 1:1 deposit or a prepaid account.',
          { statusCode: 422, code: 'VERIFICATION_INSTRUMENT_REQUIRED', expose: true },
        );
      }
      extra.instrument = input.instrument;
    }

    /**
     * Pending documents needs documents to be pending.
     *
     * The SOP says this outcome "returns to the exact phase that generated the request" — and
     * `resumeAfterDocuments` finds that phase from the newest document row carrying a
     * `requested_in_phase`. Recording `pending_docs` without any request left the case parked with no
     * record of what anyone was waiting for, and the resume fell back to whatever phase the case
     * happened to sit at, which is this one. So the request is the mechanism, not paperwork.
     */
    if (input.decision === 'pending_docs') {
      const outstanding = await verificationCaseAssetRepo.listOutstandingRequests(ctx, caseId);
      if (outstanding.length === 0) {
        throw new AppError(
          'Request the missing documents first — a case held for documents has to say which, so it can return to the phase that asked for them.',
          { statusCode: 422, code: 'VERIFICATION_DOCS_REQUEST_REQUIRED', expose: true },
        );
      }
      // Where the resume will land, recorded as the reviewer was told it — through the same helper
      // `resumeAfterDocuments` uses, so the promise and the behaviour cannot drift apart.
      extra.returnPhase = await documentReturnPhase(ctx, row);
      extra.outstandingDocuments = outstanding.length;
    }

    // Manager review and pending documents are not endings — the case stays open for whoever picks
    // it up. The other five close it.
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
      eventNotes: note ?? `Final decision: ${input.decision}.`,
      actorZohoUserId: zohoFromCtx(ctx),
      actorName: ctx.userName || ctx.userId,
      findings: {
        decision: input.decision,
        approvedLimit: input.approvedLimit ?? null,
        ...extra,
      },
    });

    if (input.approvedLimit) {
      await verificationFlowRepo.patchIntake(ctx, caseId, {
        approvedLimitAmount: String(input.approvedLimit),
      });
    }

    /**
     * The ban, last.
     *
     * After the transition on purpose: the decision is the record that must survive, and the ban
     * write reaches a database we do not own. `blacklistCaseIdentifiers` never throws on the remote
     * half — it audits — so a credit platform that is down costs us the shared ban, not the decline.
     */
    if (input.decision === 'decline_blacklist') {
      await blacklistCaseIdentifiers(ctx, row, note);
    }

    return deskService.detail(ctx, caseId);
  });
}
