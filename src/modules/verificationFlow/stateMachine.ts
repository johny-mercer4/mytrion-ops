/**
 * The verification state machine — pure functions returning a patch, never touching the DB.
 *
 * Mirrors `resolvePhase1Transition` in the retention module: the caller persists the patch through
 * the one repo method that also appends the audit event, so a transition can never land without its
 * event. Keeping this pure is what makes the routing rules unit-testable without fixtures.
 *
 * Routing rules owned here (all from the SOP):
 *   - Merge point: 1-20 fuel cards -> Octane internal underwriting; 21+ -> WEX.
 *   - Phase 5: carrier with 10+ trucks reviews BANKING first; everyone else CREDIT first.
 *   - LLC / corporation without MC/DOT -> Manager Review at intake.
 *   - Pending Documents returns to the phase that ASKED, not to the start.
 */
import {
  VERIFICATION_PHASE,
  VERIFICATION_STATUS,
  VERIFICATION_TERMINAL_STATUSES,
  type VerificationApplicantType,
  type VerificationPhaseCode,
  type VerificationPhaseOutcome,
  type VerificationPhaseStatus,
  type VerificationRoute,
} from '../../db/schema/verification_flow.js';
import { nextApplicablePhase, phaseApplies, phaseByCode } from './phases.js';

export interface RoutingPolicy {
  bankFirstTruckMin: number;
  wexCardCutoff: number;
}

/** What a transition changes. The repo maps this onto columns and writes the event. */
export interface PhaseTransitionPatch {
  phaseCode: VerificationPhaseCode;
  statusCode: string;
  /** Status to stamp on the phase row the decision was made ON. */
  phaseStatus: VerificationPhaseStatus;
  /** Set when the case reaches a terminal status. */
  closed: boolean;
  eventType: string;
  eventNotes?: string;
}

/** Which review the desk opens first in Phase 6. */
export type ReviewOrder = 'banking_first' | 'credit_first';

/**
 * Phase 5 routing. Only a CARRIER can be "10+ trucks" for this purpose — the SOP splits on
 * "carrier with 10 or more trucks" vs "owner-operator OR carrier with fewer than 10 trucks", and an
 * owner-operator with a big fleet on paper is still reviewed credit-first.
 */
export function resolveReviewOrder(
  applicantType: VerificationApplicantType | null,
  trucksCount: number | null,
  policy: RoutingPolicy,
): ReviewOrder {
  if (applicantType === 'carrier' && (trucksCount ?? 0) >= policy.bankFirstTruckMin) {
    return 'banking_first';
  }
  return 'credit_first';
}

/** Phase 1 merge point. 1-20 stays in-house; 21+ leaves for WEX. */
export function resolveUnderwritingRoute(
  fuelCardsRequested: number | null,
  policy: RoutingPolicy,
): VerificationRoute {
  return (fuelCardsRequested ?? 0) > policy.wexCardCutoff ? 'wex' : 'octane_internal';
}

/**
 * An LLC/corporation with no MC/DOT authority cannot clear Phase 4 and has no Highway presence, so
 * the SOP sends it to a human at intake rather than down a path with two holes in it.
 */
export function requiresManagerReviewAtIntake(applicantType: VerificationApplicantType | null): boolean {
  return applicantType === 'company';
}

/** Map a phase outcome onto the phase row's own status. */
function phaseStatusFor(outcome: VerificationPhaseOutcome): VerificationPhaseStatus {
  switch (outcome) {
    case 'pass':
      return 'passed';
    case 'pending_docs':
      return 'pending_docs';
    case 'manager_review':
    case 'additional_verification':
      return 'manager_review';
    case 'decline':
    case 'decline_blacklist':
      return 'failed';
    case 'deposit_prepaid':
      return 'passed';
    case 'skip':
      return 'skipped';
  }
}

/** Map a phase outcome onto the CASE status. */
function caseStatusFor(
  outcome: VerificationPhaseOutcome,
  phase: VerificationPhaseCode,
  isLastPhase: boolean,
): string {
  switch (outcome) {
    case 'pending_docs':
      return VERIFICATION_STATUS.pendingDocs;
    case 'manager_review':
      return VERIFICATION_STATUS.managerReview;
    case 'additional_verification':
      return VERIFICATION_STATUS.additionalVerification;
    case 'decline':
      return VERIFICATION_STATUS.declined;
    case 'decline_blacklist':
      return VERIFICATION_STATUS.declinedBlacklist;
    case 'deposit_prepaid':
      return VERIFICATION_STATUS.depositPrepaid;
    case 'pass':
    case 'skip':
      // Passing the final phase without an explicit decision is not an approval — Phase 10 records
      // that separately. Until then the case stays in review.
      return isLastPhase && phase === VERIFICATION_PHASE.decision
        ? VERIFICATION_STATUS.managerReview
        : VERIFICATION_STATUS.inReview;
  }
}

/**
 * Resolve one phase decision into a patch.
 *
 * `pass` advances to the next APPLICABLE phase, so skipping Phase 4 for an owner-operator needs no
 * separate step. A non-pass outcome holds the case on the phase that produced it — which is what
 * makes "return to the exact phase that generated the request" a property of the data rather than
 * something a later screen has to remember.
 */
export function resolvePhaseDecision(input: {
  phase: VerificationPhaseCode;
  outcome: VerificationPhaseOutcome;
  applicantType: VerificationApplicantType | null;
  note?: string | undefined;
}): PhaseTransitionPatch {
  const { phase, outcome, applicantType } = input;
  const descriptor = phaseByCode(phase);
  if (!descriptor) {
    throw new Error(`Unknown verification phase: ${phase}`);
  }

  const advancing = outcome === 'pass' || outcome === 'skip';
  const next = advancing ? nextApplicablePhase(phase, applicantType) : null;
  const targetPhase = next?.code ?? phase;
  const isLastPhase = next === null;

  const statusCode = caseStatusFor(outcome, phase, isLastPhase);

  const patch: PhaseTransitionPatch = {
    phaseCode: targetPhase,
    statusCode,
    phaseStatus: phaseStatusFor(outcome),
    closed: VERIFICATION_TERMINAL_STATUSES.has(statusCode),
    eventType: 'phase_decision',
  };
  if (input.note !== undefined) patch.eventNotes = input.note;
  return patch;
}

/**
 * Where a fulfilled document request sends the case back to.
 *
 * SOP: "Return to the exact phase that generated the request once information is received." If the
 * originating phase no longer applies (applicant type changed mid-flight), fall forward to the next
 * one that does rather than stranding the case on a phase nobody can open.
 */
export function resolveDocumentReturnPhase(
  requestedInPhase: string | null,
  applicantType: VerificationApplicantType | null,
): VerificationPhaseCode {
  const descriptor = requestedInPhase ? phaseByCode(requestedInPhase) : undefined;
  if (!descriptor) return VERIFICATION_PHASE.intake;
  if (phaseApplies(descriptor, applicantType)) return descriptor.code;
  return nextApplicablePhase(descriptor.code, applicantType)?.code ?? VERIFICATION_PHASE.decision;
}

/** Final Phase 10 outcomes, mapped to their terminal status. */
export const FINAL_DECISIONS = {
  approve: VERIFICATION_STATUS.approved,
  deposit_prepaid: VERIFICATION_STATUS.depositPrepaid,
  manager_review: VERIFICATION_STATUS.managerReview,
  pending_docs: VERIFICATION_STATUS.pendingDocs,
  declined_customer: VERIFICATION_STATUS.declinedCustomer,
  decline: VERIFICATION_STATUS.declined,
  decline_blacklist: VERIFICATION_STATUS.declinedBlacklist,
} as const;

export type FinalDecision = keyof typeof FINAL_DECISIONS;

export function isTerminalStatus(statusCode: string): boolean {
  return VERIFICATION_TERMINAL_STATUSES.has(statusCode);
}
