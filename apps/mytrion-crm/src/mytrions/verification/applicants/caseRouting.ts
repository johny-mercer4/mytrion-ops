/**
 * Phase 5 — review order only.
 *
 * SOP: a carrier with 10+ trucks is banking-first; owner-operators and smaller carriers are
 * credit-first. Missing trucks are not invented as 10 — they count as 0, so credit-first, and the
 * pane must say that is assumed. The same function Phase 6 reads when Phase 5 has not been passed.
 */
import type {
  VerificationApplicantType,
  VerificationDeskDetail,
  VerificationReviewOrder,
} from '@/api/verificationFlow';

export const BANK_FIRST_TRUCK_MIN = 10;

export function computeReviewOrder(
  applicantType: VerificationApplicantType | null,
  trucksCount: number | null,
): VerificationReviewOrder {
  if (applicantType === 'carrier' && (trucksCount ?? 0) >= BANK_FIRST_TRUCK_MIN) {
    return 'banking_first';
  }
  return 'credit_first';
}

export function trucksMissing(trucksCount: number | null | undefined): boolean {
  return trucksCount == null;
}

export function reviewOrderLabel(order: VerificationReviewOrder): string {
  return order === 'banking_first' ? 'Banking → Credit' : 'Credit → Banking';
}

export function storedReviewOrder(findings: Record<string, unknown> | null | undefined): VerificationReviewOrder | null {
  const raw = findings?.reviewOrder;
  return raw === 'banking_first' || raw === 'credit_first' ? raw : null;
}

/**
 * Phase 6 reads a passed Phase 5 finding first so a later type/truck edit cannot silently flip the
 * order the desk already confirmed. Until then, recompute from the case — same rule, same 10.
 */
export function deskReviewOrder(detail: VerificationDeskDetail): {
  order: VerificationReviewOrder;
  source: 'phase5' | 'computed';
  assumedMissingTrucks: boolean;
} {
  const routing = detail.rail.find((p) => p.code === 'p5_routing');
  const stored = storedReviewOrder(routing?.findings);
  if (routing?.status === 'passed' && stored) {
    return { order: stored, source: 'phase5', assumedMissingTrucks: false };
  }
  const trucks = detail.case.trucksCount;
  return {
    order: computeReviewOrder(detail.case.applicantType, trucks),
    source: 'computed',
    assumedMissingTrucks: trucksMissing(trucks),
  };
}

export function routingChecklistLines(order: VerificationReviewOrder): readonly string[] {
  return [
    `Review order: ${reviewOrderLabel(order)}`,
    'Confirm applicant type and truck count',
  ];
}
