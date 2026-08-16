/**
 * Phase 9 credit capacity — the three SOP formulas, and the one refusal that matters.
 *
 *   1. Average Weekly Net Cash Flow = Avg Weekly Recurring Income - Avg Weekly Recurring Expenses
 *   2. Adjusted Weekly Capacity     = Average Weekly Net Cash Flow + Avg Weekly Fuel Expense
 *   3. Recommended Credit Limit     = Adjusted Weekly Capacity x Risk Factor
 *
 * FUEL IS ADDED BACK, NOT ADDED TWICE. Step 2 exists because fuel spend is already inside recurring
 * expenses in step 1 — the applicant stops paying for fuel out of pocket once they have the card, so
 * that money is capacity. `assertFuelNotDoubleCounted` is what stops an analyst who entered fuel
 * OUTSIDE recurring expenses from silently inflating the limit.
 *
 * MODERATE AND WEAK FACTORS ARE NULL ON PURPOSE. The SOP marks them as unset policy placeholders.
 * A NULL factor makes this module REFUSE, loudly, with the tier named. It never falls back to the
 * strong factor, never to 1.0, never to "something reasonable" — a wildcard here would approve a
 * credit line nobody set policy for. Same discipline as the escalation-routing rungs.
 */
import { AppError } from '../../lib/errors.js';
import type { VerificationRiskTier } from '../../db/schema/verification_flow.js';

/** Money in, money out — all weekly, all dollars. */
export interface CapacityInputs {
  avgWeeklyRecurringIncome: number;
  avgWeeklyRecurringExpenses: number;
  avgWeeklyFuelExpense: number;
}

export interface PolicyFactors {
  strongFactor: number | null;
  moderateFactor: number | null;
  weakFactor: number | null;
}

export interface CapacityResult {
  avgWeeklyNetCashFlow: number;
  adjustedWeeklyCapacity: number;
  riskFactor: number;
  recommendedLimit: number;
}

/** Round to cents. Money that reaches a `numeric(14,2)` column must already be exact. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Step 1. Exclude one-time and unexplained deposits before calling this — the SOP is explicit. */
export function averageWeeklyNetCashFlow(inputs: CapacityInputs): number {
  return money(inputs.avgWeeklyRecurringIncome - inputs.avgWeeklyRecurringExpenses);
}

/** Step 2. Fuel is added back because the card displaces that spend. */
export function adjustedWeeklyCapacity(inputs: CapacityInputs): number {
  return money(averageWeeklyNetCashFlow(inputs) + inputs.avgWeeklyFuelExpense);
}

/**
 * Guard for the SOP's "Avoid double-counting fuel".
 *
 * Fuel must be a component of recurring expenses. If the analyst recorded fuel that exceeds total
 * recurring expenses, fuel was entered somewhere outside them and step 2 would add capacity that was
 * never subtracted — inflating the recommended limit. Refuse rather than quietly over-approve.
 */
export function assertFuelNotDoubleCounted(inputs: CapacityInputs): void {
  if (inputs.avgWeeklyFuelExpense > inputs.avgWeeklyRecurringExpenses) {
    throw new AppError(
      'Average weekly fuel expense exceeds total recurring weekly expenses. Fuel must be a component of recurring expenses — otherwise adding it back double-counts it and inflates the recommended limit.',
      { statusCode: 422, code: 'VERIFICATION_FUEL_DOUBLE_COUNTED', expose: true },
    );
  }
}

/**
 * The factor for a tier, or a loud refusal.
 *
 * Returning null and letting the caller decide was considered and rejected: every caller would have
 * to remember to check, and the failure mode of forgetting is an approved credit line.
 */
export function riskFactorFor(tier: VerificationRiskTier, policy: PolicyFactors): number {
  const factor =
    tier === 'strong'
      ? policy.strongFactor
      : tier === 'moderate'
        ? policy.moderateFactor
        : policy.weakFactor;

  if (factor === null || factor === undefined || !Number.isFinite(factor)) {
    throw new AppError(
      `No approved risk factor is set for the ${tier} tier. Set it in Verification policy before a limit can be recommended.`,
      { statusCode: 409, code: 'VERIFICATION_POLICY_NOT_SET', expose: true },
    );
  }
  if (factor < 0) {
    throw new AppError(`The ${tier} risk factor must not be negative.`, {
      statusCode: 422,
      code: 'VERIFICATION_POLICY_INVALID',
      expose: true,
    });
  }
  return factor;
}

/**
 * Full Phase 9 computation. Throws rather than returning a partial result — a screen that shows an
 * adjusted capacity next to a blank limit invites someone to fill the blank in by hand.
 */
export function computeRecommendedLimit(
  inputs: CapacityInputs,
  tier: VerificationRiskTier,
  policy: PolicyFactors,
): CapacityResult {
  assertFuelNotDoubleCounted(inputs);
  const netCashFlow = averageWeeklyNetCashFlow(inputs);
  const capacity = adjustedWeeklyCapacity(inputs);
  const riskFactor = riskFactorFor(tier, policy);

  // A non-positive capacity cannot support an unsecured line. Phase 7's hard stop should already
  // have caught this, but the calculator must not emit a negative "limit" if it is reached anyway.
  const recommendedLimit = capacity <= 0 ? 0 : money(capacity * riskFactor);

  return { avgWeeklyNetCashFlow: netCashFlow, adjustedWeeklyCapacity: capacity, riskFactor, recommendedLimit };
}

/** Whether a tier can be priced at all — lets the UI disable compute instead of throwing on click. */
export function isTierPriceable(tier: VerificationRiskTier, policy: PolicyFactors): boolean {
  try {
    riskFactorFor(tier, policy);
    return true;
  } catch {
    return false;
  }
}
