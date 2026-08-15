/**
 * The 10-phase catalog and its applicability rules.
 *
 * The DB `verification_phases` table is the seeded source of truth for labels and ordering; this
 * module is the CODE view of the same facts, so the state machine can reason about a case without a
 * round trip. The two must agree — the seed in migration 0121 and `PHASE_CATALOG` below are written
 * from the same list, and `verification-flow-phases.test.ts` asserts they match.
 *
 * Skips are explicit, never silent: an owner-operator does not "pass" Phase 4, it is `skipped` with
 * a reason the desk renders. That distinction is what stops a reviewer reading a green rail as
 * "authority was checked".
 */
import {
  VERIFICATION_PHASE,
  VERIFICATION_PHASE_ORDER,
  type VerificationApplicantType,
  type VerificationPhaseCode,
  type VerificationPhaseStatus,
} from '../../db/schema/verification_flow.js';

/**
 * One phase as both desks read it — the catalog fact joined to the stored decision.
 *
 * Sales sees exactly this, read-only. Building it twice is how the two sides would end up
 * disagreeing about whether Phase 4 was skipped or simply never reached.
 */
export interface RailPhase {
  code: VerificationPhaseCode;
  label: string;
  order: number;
  description: string;
  applies: boolean;
  skipReason: string | null;
  status: VerificationPhaseStatus;
  outcome: string | null;
  findings: Record<string, unknown>;
  note: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
}

/** Stored phase rows, keyed however the caller has them. */
export interface StoredPhase {
  phaseCode: string;
  status: VerificationPhaseStatus;
  outcome: string | null;
  findings: Record<string, unknown> | null;
  note: string | null;
  decidedAt: Date | null;
  decidedBy: string | null;
}

export function buildRail(
  stored: readonly StoredPhase[],
  applicantType: VerificationApplicantType | null,
): RailPhase[] {
  const byCode = new Map(stored.map((p) => [p.phaseCode, p]));
  return PHASE_CATALOG.map((descriptor) => {
    const row = byCode.get(descriptor.code);
    const applies = phaseApplies(descriptor, applicantType);
    return {
      code: descriptor.code,
      label: descriptor.label,
      order: descriptor.order,
      description: descriptor.description,
      applies,
      skipReason: skipReason(descriptor, applicantType),
      status: row?.status ?? (applies ? 'not_started' : 'skipped'),
      outcome: row?.outcome ?? null,
      findings: row?.findings ?? {},
      note: row?.note ?? null,
      decidedAt: row?.decidedAt ?? null,
      decidedBy: row?.decidedBy ?? null,
    };
  });
}

export interface PhaseDescriptor {
  code: VerificationPhaseCode;
  label: string;
  order: number;
  /** 'all' or 'carrier' — matches `verification_phases.applies_to`. */
  appliesTo: 'all' | 'carrier';
  description: string;
}

export const PHASE_CATALOG: readonly PhaseDescriptor[] = [
  {
    code: VERIFICATION_PHASE.intake,
    label: 'Application Intake',
    order: 1,
    appliesTo: 'all',
    description: 'Applicant type, full application, documents.',
  },
  {
    code: VERIFICATION_PHASE.identity,
    label: 'Initial Identity / Business Verification',
    order: 2,
    appliesTo: 'all',
    description: 'Cross-check identity, business and bank account ownership.',
  },
  {
    code: VERIFICATION_PHASE.screening,
    label: 'Automated Internal Screening',
    order: 3,
    appliesTo: 'all',
    description: 'Blacklist and active-customer / duplicate checks.',
  },
  {
    code: VERIFICATION_PHASE.authority,
    label: 'Authority & Operating Status',
    order: 4,
    appliesTo: 'carrier',
    description: 'MC/USDOT/insurance status and operating history.',
  },
  {
    code: VERIFICATION_PHASE.routing,
    label: 'Credit & Banking Review Routing',
    order: 5,
    appliesTo: 'all',
    description: 'Decides whether banking or credit is reviewed first.',
  },
  {
    code: VERIFICATION_PHASE.creditBanking,
    label: 'Credit & Banking Review',
    order: 6,
    appliesTo: 'all',
    description: 'Full credit profile plus the last three months of banking.',
  },
  {
    code: VERIFICATION_PHASE.hardStops,
    label: 'Financial Hard Stops',
    order: 7,
    appliesTo: 'all',
    description: 'Negative average weekly net cash flow; no credit-bureau record.',
  },
  {
    code: VERIFICATION_PHASE.highway,
    label: 'Carrier Operational Review (Highway)',
    order: 8,
    appliesTo: 'carrier',
    description: 'Operational credibility and consistency.',
  },
  {
    code: VERIFICATION_PHASE.riskCapacity,
    label: 'Risk Tier & Credit Capacity',
    order: 9,
    appliesTo: 'all',
    description: 'Risk tier, adjusted weekly capacity, recommended limit.',
  },
  {
    code: VERIFICATION_PHASE.decision,
    label: 'Final Underwriting Decision',
    order: 10,
    appliesTo: 'all',
    description: 'Approve, manager review, deposit/prepaid, decline.',
  },
] as const;

const BY_CODE = new Map<string, PhaseDescriptor>(PHASE_CATALOG.map((p) => [p.code, p]));

export function phaseByCode(code: string): PhaseDescriptor | undefined {
  return BY_CODE.get(code);
}

export function isPhaseCode(code: string): code is VerificationPhaseCode {
  return BY_CODE.has(code);
}

/**
 * Whether a phase runs for this applicant.
 *
 * Only `carrier` clears the carrier-only phases. `company` (an LLC or corporation WITHOUT MC/DOT)
 * deliberately does not: it has no authority to verify and no Highway presence, which is exactly why
 * the SOP routes it to Manager Review at intake instead.
 */
export function phaseApplies(
  phase: PhaseDescriptor,
  applicantType: VerificationApplicantType | null | undefined,
): boolean {
  if (phase.appliesTo === 'all') return true;
  return applicantType === 'carrier';
}

/** Human-readable reason a phase is skipped, shown on the rail instead of a silent gap. */
export function skipReason(
  phase: PhaseDescriptor,
  applicantType: VerificationApplicantType | null | undefined,
): string | null {
  if (phaseApplies(phase, applicantType)) return null;
  if (applicantType === 'owner_operator') {
    return 'Not applicable — owner-operator has no MC/DOT authority to verify.';
  }
  if (applicantType === 'company') {
    return 'Not applicable — company without MC/DOT authority.';
  }
  return 'Not applicable for this applicant type.';
}

/** The phases this applicant actually has to clear, in order. */
export function applicablePhases(
  applicantType: VerificationApplicantType | null | undefined,
): readonly PhaseDescriptor[] {
  return PHASE_CATALOG.filter((p) => phaseApplies(p, applicantType));
}

/**
 * The next phase after `code` that applies to this applicant, or null at the end of the flow.
 * Used by the state machine on a `pass` outcome so a skip never needs a separate advance step.
 */
export function nextApplicablePhase(
  code: VerificationPhaseCode,
  applicantType: VerificationApplicantType | null | undefined,
): PhaseDescriptor | null {
  const idx = VERIFICATION_PHASE_ORDER.indexOf(code);
  if (idx < 0) return null;
  for (const next of VERIFICATION_PHASE_ORDER.slice(idx + 1)) {
    const descriptor = BY_CODE.get(next);
    if (descriptor && phaseApplies(descriptor, applicantType)) return descriptor;
  }
  return null;
}
