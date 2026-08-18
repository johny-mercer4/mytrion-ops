import { describe, expect, it } from 'vitest';
import type { VerificationDeskDetail, VerificationRailPhase } from '@/api/verificationFlow';
import {
  computeReviewOrder,
  deskReviewOrder,
  reviewOrderLabel,
  storedReviewOrder,
} from './caseRouting';

describe('computeReviewOrder', () => {
  it('is banking-first only for a carrier with 10 or more trucks', () => {
    expect(computeReviewOrder('carrier', 10)).toBe('banking_first');
    expect(computeReviewOrder('carrier', 14)).toBe('banking_first');
    expect(computeReviewOrder('carrier', 9)).toBe('credit_first');
  });

  it('is credit-first for an owner-operator regardless of fleet size', () => {
    expect(computeReviewOrder('owner_operator', 25)).toBe('credit_first');
    expect(computeReviewOrder('owner_operator', 0)).toBe('credit_first');
  });

  it('treats missing trucks as credit-first, not as a 10-truck fleet', () => {
    expect(computeReviewOrder('carrier', null)).toBe('credit_first');
    expect(reviewOrderLabel('credit_first')).toBe('Credit → Banking');
    expect(reviewOrderLabel('banking_first')).toBe('Banking → Credit');
  });
});

describe('deskReviewOrder', () => {
  const rail = (over: Partial<VerificationRailPhase> = {}): VerificationRailPhase => ({
    code: 'p5_routing',
    label: 'Routing',
    order: 5,
    description: '',
    applies: true,
    skipReason: null,
    status: 'not_started',
    outcome: null,
    findings: {},
    note: null,
    decidedAt: null,
    decidedBy: null,
    ...over,
  });

  const detail = (
    applicantType: 'carrier' | 'owner_operator',
    trucksCount: number | null,
    phase: Partial<VerificationRailPhase> = {},
  ): VerificationDeskDetail =>
    ({
      case: { applicantType, trucksCount },
      rail: [rail(phase)],
    }) as VerificationDeskDetail;

  it('follows a passed Phase 5 finding even if trucks later look different', () => {
    const next = deskReviewOrder(
      detail('carrier', 4, {
        status: 'passed',
        findings: { reviewOrder: 'banking_first' },
      }),
    );
    expect(next.order).toBe('banking_first');
    expect(next.source).toBe('phase5');
  });

  it('computes from type and trucks when Phase 5 is not passed', () => {
    const next = deskReviewOrder(detail('carrier', 12));
    expect(next.order).toBe('banking_first');
    expect(next.source).toBe('computed');
    expect(next.assumedMissingTrucks).toBe(false);
  });

  it('flags a missing truck count as an assumed credit-first order', () => {
    const next = deskReviewOrder(detail('carrier', null));
    expect(next.order).toBe('credit_first');
    expect(next.assumedMissingTrucks).toBe(true);
  });

  it('ignores a stored order that is not a review-order value', () => {
    expect(storedReviewOrder({ reviewOrder: 'nope' })).toBeNull();
  });
});
