import { describe, expect, it } from 'vitest';
import {
  applicablePhases,
  nextApplicablePhase,
  phaseApplies,
  phaseByCode,
  PHASE_CATALOG,
  skipReason,
} from '../../src/modules/verificationFlow/phases.js';
import {
  resolveDocumentReturnPhase,
  resolvePhaseDecision,
  resolveReviewOrder,
  resolveUnderwritingRoute,
  requiresManagerReviewAtIntake,
  type RoutingPolicy,
} from '../../src/modules/verificationFlow/stateMachine.js';
import {
  evaluateHardStops,
  managerReviewIndicators,
} from '../../src/modules/verificationFlow/hardStops.js';
import { VERIFICATION_STATUS } from '../../src/db/schema/verification_flow.js';

/** Policy as migration 0121 seeds it. */
const POLICY: RoutingPolicy = { bankFirstTruckMin: 10, wexCardCutoff: 20 };

describe('phase catalog', () => {
  it('has the ten SOP phases in order', () => {
    expect(PHASE_CATALOG).toHaveLength(10);
    expect(PHASE_CATALOG.map((p) => p.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('marks exactly Authority and Highway as carrier-only', () => {
    const carrierOnly = PHASE_CATALOG.filter((p) => p.appliesTo === 'carrier').map((p) => p.code);
    expect(carrierOnly).toEqual(['p4_authority', 'p8_highway']);
  });
});

describe('phase applicability', () => {
  it('runs every phase for a carrier', () => {
    expect(applicablePhases('carrier')).toHaveLength(10);
  });

  it('skips authority and Highway for an owner-operator', () => {
    const codes = applicablePhases('owner_operator').map((p) => p.code);
    expect(codes).toHaveLength(8);
    expect(codes).not.toContain('p4_authority');
    expect(codes).not.toContain('p8_highway');
  });

  it('also skips them for a company without MC/DOT — it has no authority to verify', () => {
    const codes = applicablePhases('company').map((p) => p.code);
    expect(codes).not.toContain('p4_authority');
    expect(codes).not.toContain('p8_highway');
  });

  it('gives a skip a stated reason rather than a silent gap', () => {
    const authority = phaseByCode('p4_authority');
    expect(authority).toBeDefined();
    expect(skipReason(authority!, 'owner_operator')).toMatch(/owner-operator/i);
    expect(skipReason(authority!, 'company')).toMatch(/without MC\/DOT/i);
    expect(skipReason(authority!, 'carrier')).toBeNull();
  });

  it('phaseApplies only clears carrier-only phases for a carrier', () => {
    const highway = phaseByCode('p8_highway')!;
    expect(phaseApplies(highway, 'carrier')).toBe(true);
    expect(phaseApplies(highway, 'owner_operator')).toBe(false);
    expect(phaseApplies(highway, 'company')).toBe(false);
  });
});

describe('Phase 1 merge point — WEX cutoff', () => {
  it('keeps 1-20 cards in Octane internal underwriting', () => {
    expect(resolveUnderwritingRoute(1, POLICY)).toBe('octane_internal');
    expect(resolveUnderwritingRoute(20, POLICY)).toBe('octane_internal');
  });

  it('routes 21+ cards to WEX', () => {
    expect(resolveUnderwritingRoute(21, POLICY)).toBe('wex');
    expect(resolveUnderwritingRoute(60, POLICY)).toBe('wex');
  });
});

describe('Phase 5 review routing', () => {
  it('reviews banking first for a carrier with 10+ trucks', () => {
    expect(resolveReviewOrder('carrier', 10, POLICY)).toBe('banking_first');
    expect(resolveReviewOrder('carrier', 14, POLICY)).toBe('banking_first');
  });

  it('reviews credit first for a carrier with fewer than 10 trucks', () => {
    expect(resolveReviewOrder('carrier', 9, POLICY)).toBe('credit_first');
  });

  it('reviews credit first for an owner-operator regardless of truck count', () => {
    // The SOP splits on "carrier with 10 or more trucks" — an owner-operator is on the other side
    // of that line whatever the fleet figure says.
    expect(resolveReviewOrder('owner_operator', 25, POLICY)).toBe('credit_first');
  });
});

describe('company without MC/DOT', () => {
  it('goes to Manager Review at intake', () => {
    expect(requiresManagerReviewAtIntake('company')).toBe(true);
    expect(requiresManagerReviewAtIntake('carrier')).toBe(false);
    expect(requiresManagerReviewAtIntake('owner_operator')).toBe(false);
  });
});

describe('phase decisions', () => {
  it('advances a carrier from screening to authority on pass', () => {
    const patch = resolvePhaseDecision({
      phase: 'p3_screening',
      outcome: 'pass',
      applicantType: 'carrier',
    });
    expect(patch.phaseCode).toBe('p4_authority');
    expect(patch.phaseStatus).toBe('passed');
    expect(patch.statusCode).toBe(VERIFICATION_STATUS.inReview);
    expect(patch.closed).toBe(false);
  });

  it('jumps an owner-operator straight from screening to routing, skipping authority', () => {
    const patch = resolvePhaseDecision({
      phase: 'p3_screening',
      outcome: 'pass',
      applicantType: 'owner_operator',
    });
    expect(patch.phaseCode).toBe('p5_routing');
  });

  it('jumps from hard stops past Highway to risk for an owner-operator', () => {
    const patch = resolvePhaseDecision({
      phase: 'p7_hard_stops',
      outcome: 'pass',
      applicantType: 'owner_operator',
    });
    expect(patch.phaseCode).toBe('p9_risk_capacity');
  });

  it('holds the case on the phase that raised pending docs', () => {
    const patch = resolvePhaseDecision({
      phase: 'p6_credit_banking',
      outcome: 'pending_docs',
      applicantType: 'carrier',
    });
    expect(patch.phaseCode).toBe('p6_credit_banking');
    expect(patch.statusCode).toBe(VERIFICATION_STATUS.pendingDocs);
    expect(patch.phaseStatus).toBe('pending_docs');
  });

  it('holds the case on the phase that raised manager review', () => {
    const patch = resolvePhaseDecision({
      phase: 'p2_identity',
      outcome: 'manager_review',
      applicantType: 'carrier',
    });
    expect(patch.phaseCode).toBe('p2_identity');
    expect(patch.statusCode).toBe(VERIFICATION_STATUS.managerReview);
  });

  it('closes the case on a blacklist decline', () => {
    const patch = resolvePhaseDecision({
      phase: 'p3_screening',
      outcome: 'decline_blacklist',
      applicantType: 'carrier',
    });
    expect(patch.statusCode).toBe(VERIFICATION_STATUS.declinedBlacklist);
    expect(patch.closed).toBe(true);
    expect(patch.phaseStatus).toBe('failed');
  });

  it('treats deposit/prepaid as a terms change that closes, not a failure of the phase', () => {
    const patch = resolvePhaseDecision({
      phase: 'p7_hard_stops',
      outcome: 'deposit_prepaid',
      applicantType: 'carrier',
    });
    expect(patch.statusCode).toBe(VERIFICATION_STATUS.depositPrepaid);
    expect(patch.phaseStatus).toBe('passed');
    expect(patch.closed).toBe(true);
  });

  it('records a skip without treating it as a pass of that phase', () => {
    const patch = resolvePhaseDecision({
      phase: 'p4_authority',
      outcome: 'skip',
      applicantType: 'owner_operator',
    });
    expect(patch.phaseStatus).toBe('skipped');
  });

  it('does not silently approve by passing the final phase', () => {
    const patch = resolvePhaseDecision({
      phase: 'p10_decision',
      outcome: 'pass',
      applicantType: 'carrier',
    });
    expect(patch.statusCode).not.toBe(VERIFICATION_STATUS.approved);
    expect(patch.closed).toBe(false);
  });

  it('carries a note onto the event', () => {
    const patch = resolvePhaseDecision({
      phase: 'p2_identity',
      outcome: 'manager_review',
      applicantType: 'carrier',
      note: 'Address on licence differs from application.',
    });
    expect(patch.eventNotes).toBe('Address on licence differs from application.');
  });
});

describe('pending documents return to the phase that asked', () => {
  it('returns to the originating phase, not to intake', () => {
    expect(resolveDocumentReturnPhase('p6_credit_banking', 'carrier')).toBe('p6_credit_banking');
    expect(resolveDocumentReturnPhase('p4_authority', 'carrier')).toBe('p4_authority');
  });

  it('falls forward when the originating phase no longer applies', () => {
    // Applicant type changed to owner-operator after Phase 4 raised the request; Phase 4 can no
    // longer be opened, so the case must not be stranded there.
    expect(resolveDocumentReturnPhase('p4_authority', 'owner_operator')).toBe('p5_routing');
  });

  it('defaults to intake for an unknown or absent phase', () => {
    expect(resolveDocumentReturnPhase(null, 'carrier')).toBe('p1_intake');
    expect(resolveDocumentReturnPhase('nonsense', 'carrier')).toBe('p1_intake');
  });
});

describe('nextApplicablePhase', () => {
  it('returns null at the end of the flow', () => {
    expect(nextApplicablePhase('p10_decision', 'carrier')).toBeNull();
  });
});

describe('Phase 7 hard stops', () => {
  it('passes a positive net cash flow with a bureau file', () => {
    const verdict = evaluateHardStops({ avgWeeklyNetCashFlow: 2_140, bureauNoHit: false });
    expect(verdict.passed).toBe(true);
    expect(verdict.outcome).toBe('pass');
  });

  it('fires on a negative net cash flow', () => {
    const verdict = evaluateHardStops({ avgWeeklyNetCashFlow: -300, bureauNoHit: false });
    expect(verdict.passed).toBe(false);
    expect(verdict.triggered.map((t) => t.code)).toContain('negative_cash_flow');
  });

  it('treats exactly zero as not above zero', () => {
    // The SOP asks "> $0", not ">= $0".
    expect(evaluateHardStops({ avgWeeklyNetCashFlow: 0, bureauNoHit: false }).passed).toBe(false);
  });

  it('fires when net cash flow has not been recorded', () => {
    const verdict = evaluateHardStops({ avgWeeklyNetCashFlow: null, bureauNoHit: false });
    expect(verdict.passed).toBe(false);
    expect(verdict.triggered[0]?.detail).toMatch(/not been recorded/i);
  });

  it('fires on no credit-bureau record', () => {
    const verdict = evaluateHardStops({ avgWeeklyNetCashFlow: 5_000, bureauNoHit: true });
    expect(verdict.triggered.map((t) => t.code)).toContain('no_credit_bureau_record');
  });

  it('routes a hard stop to deposit/prepaid, never to decline', () => {
    const verdict = evaluateHardStops({ avgWeeklyNetCashFlow: -1, bureauNoHit: true });
    expect(verdict.outcome).toBe('deposit_prepaid');
    expect(verdict.triggered).toHaveLength(2);
  });
});

describe('manager-review indicators', () => {
  const thresholds = { adbReviewThreshold: 500, nsfReviewThreshold: 2 };
  const clean = {
    revenueTrend: 'stable',
    avgDailyBalance: 8_400,
    negativeBalanceDays: 0,
    overdraftCount: 0,
    nsfCount: 0,
    achReturnCount: 0,
    cashFlowVolatility: 'low',
    existingDebtPayments: 0,
    oneTimeDeposits: 0,
    creditRecentTrend: 'stable',
    unusualTransactions: null,
    bankingInconsistentWithOperations: false,
  };

  it('flags nothing on a clean profile', () => {
    expect(managerReviewIndicators(clean, thresholds)).toEqual([]);
  });

  it('flags a very low average daily balance', () => {
    const flags = managerReviewIndicators({ ...clean, avgDailyBalance: 320 }, thresholds);
    expect(flags.join(' ')).toMatch(/average daily balance/i);
  });

  it('sums NSF and returned ACH against one threshold', () => {
    const flags = managerReviewIndicators({ ...clean, nsfCount: 1, achReturnCount: 1 }, thresholds);
    expect(flags.join(' ')).toMatch(/2 NSF/);
  });

  it('does not flag a single return', () => {
    expect(managerReviewIndicators({ ...clean, nsfCount: 1 }, thresholds)).toEqual([]);
  });

  it('flags a deteriorating revenue trend', () => {
    const flags = managerReviewIndicators({ ...clean, revenueTrend: 'deteriorating' }, thresholds);
    expect(flags).toContain('Material revenue decline');
  });

  it('flags recorded unusual transactions — the SOP\'s related-account transfers', () => {
    const flags = managerReviewIndicators(
      { ...clean, unusualTransactions: 'Weekly $8k transfer to an affiliated LLC.' },
      thresholds,
    );
    expect(flags.join(' ')).toMatch(/related-account transfers/i);
  });

  it('flags banking inconsistent with reported operations', () => {
    const flags = managerReviewIndicators(
      { ...clean, bankingInconsistentWithOperations: true },
      thresholds,
    );
    expect(flags).toContain('Banking inconsistent with reported operations');
  });

  it('covers all eleven SOP indicators when everything fires at once', () => {
    // The SOP enumerates eleven. An earlier cut carried nine, and the two judgement-shaped ones
    // (related-account transfers, banking inconsistent with operations) had no way to be raised.
    const flags = managerReviewIndicators(
      {
        revenueTrend: 'deteriorating',
        avgDailyBalance: 120,
        negativeBalanceDays: 4,
        overdraftCount: 3,
        nsfCount: 2,
        achReturnCount: 1,
        cashFlowVolatility: 'high',
        existingDebtPayments: 900,
        oneTimeDeposits: 5000,
        creditRecentTrend: 'deteriorating',
        unusualTransactions: 'Large transfers to a related account.',
        bankingInconsistentWithOperations: true,
      },
      thresholds,
    );
    expect(flags).toHaveLength(11);
  });
});
