import { describe, expect, it } from 'vitest';
import {
  adjustedWeeklyCapacity,
  assertFuelNotDoubleCounted,
  averageWeeklyNetCashFlow,
  computeRecommendedLimit,
  isTierPriceable,
  riskFactorFor,
  type CapacityInputs,
  type PolicyFactors,
} from '../../src/modules/verificationFlow/capacity.js';

/** Policy as migration 0121 seeds it: Strong set, Moderate and Weak deliberately unset. */
const SEEDED_POLICY: PolicyFactors = {
  strongFactor: 0.8,
  moderateFactor: null,
  weakFactor: null,
};

const INPUTS: CapacityInputs = {
  avgWeeklyRecurringIncome: 12_000,
  avgWeeklyRecurringExpenses: 9_500,
  avgWeeklyFuelExpense: 3_200,
};

describe('capacity formulas', () => {
  it('computes average weekly net cash flow as income minus expenses', () => {
    expect(averageWeeklyNetCashFlow(INPUTS)).toBe(2_500);
  });

  it('adds fuel back to reach adjusted weekly capacity', () => {
    // 12000 - 9500 = 2500 net, + 3200 fuel = 5700. Fuel is added back because the card displaces
    // that spend; it was already subtracted inside recurring expenses.
    expect(adjustedWeeklyCapacity(INPUTS)).toBe(5_700);
  });

  it('applies the risk factor to adjusted capacity, not to net cash flow', () => {
    const result = computeRecommendedLimit(INPUTS, 'strong', SEEDED_POLICY);
    expect(result.adjustedWeeklyCapacity).toBe(5_700);
    expect(result.riskFactor).toBe(0.8);
    expect(result.recommendedLimit).toBe(4_560); // 5700 * 0.80
  });

  it('rounds money to cents', () => {
    const result = computeRecommendedLimit(
      { avgWeeklyRecurringIncome: 1_000.005, avgWeeklyRecurringExpenses: 0, avgWeeklyFuelExpense: 0 },
      'strong',
      SEEDED_POLICY,
    );
    expect(Number.isInteger(result.recommendedLimit * 100)).toBe(true);
  });
});

describe('fuel double-counting guard', () => {
  it('accepts fuel that is a component of recurring expenses', () => {
    expect(() => assertFuelNotDoubleCounted(INPUTS)).not.toThrow();
  });

  it('refuses when fuel exceeds total recurring expenses', () => {
    // Fuel larger than all recurring expenses means it was recorded outside them, so adding it back
    // would credit capacity that was never subtracted.
    expect(() =>
      assertFuelNotDoubleCounted({
        avgWeeklyRecurringIncome: 12_000,
        avgWeeklyRecurringExpenses: 1_000,
        avgWeeklyFuelExpense: 3_200,
      }),
    ).toThrowError(/double-count/i);
  });

  it('blocks the whole computation, not just the assertion', () => {
    expect(() =>
      computeRecommendedLimit(
        { avgWeeklyRecurringIncome: 12_000, avgWeeklyRecurringExpenses: 1_000, avgWeeklyFuelExpense: 3_200 },
        'strong',
        SEEDED_POLICY,
      ),
    ).toThrowError(/double-count/i);
  });
});

describe('unset policy refuses rather than guessing', () => {
  it('prices a strong applicant', () => {
    expect(riskFactorFor('strong', SEEDED_POLICY)).toBe(0.8);
  });

  it.each(['moderate', 'weak'] as const)('refuses to price a %s applicant with no factor set', (tier) => {
    expect(() => riskFactorFor(tier, SEEDED_POLICY)).toThrowError(/no approved risk factor/i);
  });

  it('names the tier in the refusal so the admin knows which field to set', () => {
    expect(() => riskFactorFor('moderate', SEEDED_POLICY)).toThrowError(/moderate/);
  });

  it('never falls back to the strong factor', () => {
    let caught: unknown;
    try {
      computeRecommendedLimit(INPUTS, 'weak', SEEDED_POLICY);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });

  it('prices once the factor is configured', () => {
    const configured: PolicyFactors = { ...SEEDED_POLICY, moderateFactor: 0.5 };
    const result = computeRecommendedLimit(INPUTS, 'moderate', configured);
    expect(result.recommendedLimit).toBe(2_850); // 5700 * 0.50
  });

  it('rejects a negative factor', () => {
    expect(() => riskFactorFor('weak', { ...SEEDED_POLICY, weakFactor: -0.1 })).toThrowError(
      /must not be negative/i,
    );
  });

  it('isTierPriceable lets the UI disable compute instead of throwing on click', () => {
    expect(isTierPriceable('strong', SEEDED_POLICY)).toBe(true);
    expect(isTierPriceable('moderate', SEEDED_POLICY)).toBe(false);
  });
});

describe('non-positive capacity', () => {
  it('never emits a negative recommended limit', () => {
    const result = computeRecommendedLimit(
      { avgWeeklyRecurringIncome: 1_000, avgWeeklyRecurringExpenses: 4_000, avgWeeklyFuelExpense: 500 },
      'strong',
      SEEDED_POLICY,
    );
    expect(result.avgWeeklyNetCashFlow).toBe(-3_000);
    expect(result.adjustedWeeklyCapacity).toBe(-2_500);
    expect(result.recommendedLimit).toBe(0);
  });
});
