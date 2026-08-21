/**
 * Phase 5 — the two routing decisions on a case.
 *
 * SOP: a carrier with `bankFirstTruckMin`+ trucks is banking-first; owner-operators and smaller
 * carriers are credit-first. Missing trucks are not invented as the threshold — they count as 0, so
 * credit-first, and the pane must say that is assumed. The same function Phase 6 reads when Phase 5
 * has not been passed.
 *
 * THE THRESHOLD IS NOT A CONSTANT. `bankFirstTruckMin` and `wexCardCutoff` are columns on
 * `verification_policy`, editable on the admin policy screen, and the server already resolves the
 * route from them and sends both numbers down on `detail.routing`. This file used to hard-code 10 —
 * so the moment anyone moved the policy, the pane confidently displayed a different rule from the one
 * the state machine applied, and the reviewer had no way to tell. Every function here now takes the
 * threshold, and `DEFAULT_BANK_FIRST_TRUCK_MIN` exists only as the seeded value for a detail payload
 * that predates the field.
 */
import type {
  VerificationApplicantType,
  VerificationDeskDetail,
  VerificationReviewOrder,
} from '@/api/verificationFlow';

/** The seed value, and ONLY a fallback — never the rule. See the note above. */
export const DEFAULT_BANK_FIRST_TRUCK_MIN = 10;

export function computeReviewOrder(
  applicantType: VerificationApplicantType | null,
  trucksCount: number | null,
  bankFirstTruckMin: number = DEFAULT_BANK_FIRST_TRUCK_MIN,
): VerificationReviewOrder {
  if (applicantType === 'carrier' && (trucksCount ?? 0) >= bankFirstTruckMin) {
    return 'banking_first';
  }
  return 'credit_first';
}

/**
 * The Phase 1 merge point, the other half of Phase 5's routing: 1..cutoff cards are underwritten
 * in-house, above it the case leaves for WEX.
 *
 * `detail.routing.underwritingRoute` already carries the server's answer — this mirrors it so the
 * pane can explain the split rather than only name it, and so a policy change moves both.
 */
export function computeUnderwritingRoute(
  fuelCardsRequested: number | null,
  wexCardCutoff: number,
): 'octane_internal' | 'wex' {
  return (fuelCardsRequested ?? 0) > wexCardCutoff ? 'wex' : 'octane_internal';
}

export function underwritingRouteLabel(route: 'octane_internal' | 'wex'): string {
  return route === 'wex' ? 'WEX' : 'Octane internal';
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
    // The live threshold off the payload, not a local constant — the whole point of the note above.
    order: computeReviewOrder(
      detail.case.applicantType,
      trucks,
      detail.routing?.bankFirstTruckMin ?? DEFAULT_BANK_FIRST_TRUCK_MIN,
    ),
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
