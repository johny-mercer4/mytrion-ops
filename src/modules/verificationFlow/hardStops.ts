/**
 * Phase 7 — financial hard stops and the manager-review indicator list.
 *
 * TWO hard stops, and they are not declines. Both mean "no standard unsecured LOC" and route to
 * Deposit 1:1 / Prepaid / Manager Review. The SOP is careful about this and so is this module: a
 * hard stop never returns `decline`.
 *
 *   A. Average Weekly Net Cash Flow is not above $0.
 *   B. No information found in the credit bureau.
 *
 * The indicators below are explicitly "not automatic decline by themselves" — they raise Manager
 * Review, nothing more. Keeping them separate from the hard stops is the whole point of the phase.
 */
import type { VerificationPhaseOutcome } from '../../db/schema/verification_flow.js';

export interface HardStopInputs {
  avgWeeklyNetCashFlow: number | null;
  bureauNoHit: boolean;
}

export interface IndicatorInputs {
  revenueTrend: string | null;
  avgDailyBalance: number | null;
  negativeBalanceDays: number | null;
  overdraftCount: number | null;
  nsfCount: number | null;
  achReturnCount: number | null;
  cashFlowVolatility: string | null;
  existingDebtPayments: number | null;
  oneTimeDeposits: number | null;
  creditRecentTrend: string | null;
}

export interface IndicatorThresholds {
  /** "very low average daily balance (approx. below $500)" */
  adbReviewThreshold: number;
  /** "2+ NSF/returned ACH events" */
  nsfReviewThreshold: number;
}

export interface HardStopVerdict {
  /** True when neither hard stop fired — the case may continue to Phase 8/9 on standard terms. */
  passed: boolean;
  /** Which stops fired, in SOP order. */
  triggered: Array<{ code: 'negative_cash_flow' | 'no_credit_bureau_record'; label: string; detail: string }>;
  /** What Phase 7 should record. Never `decline` — a hard stop is a terms change, not a rejection. */
  outcome: Extract<VerificationPhaseOutcome, 'pass' | 'deposit_prepaid'>;
}

export function evaluateHardStops(inputs: HardStopInputs): HardStopVerdict {
  const triggered: HardStopVerdict['triggered'] = [];

  // Strictly greater than zero. Exactly $0 is not a positive net cash flow and does not support an
  // unsecured line — the SOP asks "> $0", not ">= $0".
  if (inputs.avgWeeklyNetCashFlow === null || !(inputs.avgWeeklyNetCashFlow > 0)) {
    triggered.push({
      code: 'negative_cash_flow',
      label: 'Negative average weekly net cash flow',
      detail:
        inputs.avgWeeklyNetCashFlow === null
          ? 'Average weekly net cash flow has not been recorded in the banking review.'
          : `Average weekly net cash flow is ${inputs.avgWeeklyNetCashFlow.toFixed(2)}, which is not above $0.`,
    });
  }

  if (inputs.bureauNoHit) {
    triggered.push({
      code: 'no_credit_bureau_record',
      label: 'No information found in the credit bureau',
      detail: 'The credit review recorded no bureau file for this applicant.',
    });
  }

  return {
    passed: triggered.length === 0,
    triggered,
    outcome: triggered.length === 0 ? 'pass' : 'deposit_prepaid',
  };
}

/**
 * Manager-review indicators. Explicitly NOT declines and NOT hard stops — the SOP calls them out as
 * signals a human should weigh. Returned as labels so the phase pane can list exactly what fired.
 */
export function managerReviewIndicators(
  inputs: IndicatorInputs,
  thresholds: IndicatorThresholds,
): string[] {
  const flags: string[] = [];

  if (inputs.revenueTrend === 'deteriorating') flags.push('Material revenue decline');

  if (inputs.avgDailyBalance !== null && inputs.avgDailyBalance < thresholds.adbReviewThreshold) {
    flags.push(
      `Very low average daily balance (${inputs.avgDailyBalance.toFixed(2)}, below ${thresholds.adbReviewThreshold.toFixed(0)})`,
    );
  }
  if ((inputs.negativeBalanceDays ?? 0) > 0) flags.push('Repeated negative balances');
  if ((inputs.overdraftCount ?? 0) > 0) flags.push('Frequent overdrafts');

  // NSF and returned ACH are one signal in the SOP ("2+ NSF/returned ACH events"), so they are
  // summed rather than thresholded separately.
  const returns = (inputs.nsfCount ?? 0) + (inputs.achReturnCount ?? 0);
  if (returns >= thresholds.nsfReviewThreshold) {
    flags.push(`${returns} NSF / returned ACH events`);
  }

  if (inputs.cashFlowVolatility === 'high') flags.push('High cash-flow volatility');
  if ((inputs.existingDebtPayments ?? 0) > 0) flags.push('Heavy debt service');
  if ((inputs.oneTimeDeposits ?? 0) > 0) flags.push('Unexplained or one-time deposits');
  if (inputs.creditRecentTrend === 'deteriorating') flags.push('Recent credit deterioration');

  return flags;
}
