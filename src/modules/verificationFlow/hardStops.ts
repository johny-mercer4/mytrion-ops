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
  /** Free text the analyst records; the SOP's "large related-account transfers" lives here. */
  unusualTransactions: string | null;
  /** Analyst judgement: does the banking match the operation the applicant described? */
  bankingInconsistentWithOperations: boolean | null;
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
  triggered: Array<{
    code: 'negative_cash_flow' | 'cash_flow_unrecorded' | 'no_credit_bureau_record';
    label: string;
    detail: string;
  }>;
  /** What Phase 7 should record. Never `decline` — a hard stop is a terms change, not a rejection. */
  outcome: Extract<VerificationPhaseOutcome, 'pass' | 'deposit_prepaid'>;
}

export function evaluateHardStops(inputs: HardStopInputs): HardStopVerdict {
  const triggered: HardStopVerdict['triggered'] = [];

  // Strictly greater than zero. Exactly $0 is not a positive net cash flow and does not support an
  // unsecured line — the SOP asks "> $0", not ">= $0".
  if (inputs.avgWeeklyNetCashFlow === null) {
    /*
     * NOT RECORDED IS NOT NEGATIVE, and it used to be reported as such: one branch pushed the label
     * "Negative average weekly net cash flow" whether the figure was below zero or simply absent, so
     * a case where nobody had filled the banking review yet read as a finding about the applicant's
     * cash flow. Its own code, so the pane can send the reviewer back to Phase 6 instead of offering
     * them a deposit for a number nobody has looked at.
     */
    triggered.push({
      code: 'cash_flow_unrecorded',
      label: 'Average weekly net cash flow not recorded',
      detail:
        'Phase 6 has no recurring weekly income and expenses for this case, so the cash-flow hard stop cannot be evaluated. It is unanswered, not failed.',
    });
  } else if (!(inputs.avgWeeklyNetCashFlow > 0)) {
    triggered.push({
      code: 'negative_cash_flow',
      label: 'Negative average weekly net cash flow',
      detail: `Average weekly net cash flow is ${inputs.avgWeeklyNetCashFlow.toFixed(2)}, which is not above $0.`,
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

  // The SOP's remaining two indicators. Both are analyst observations rather than numbers, so they
  // are carried as recorded text / a judgement flag — but they still have to REACH this list, or an
  // analyst who spotted them has no way to raise them alongside the rest.
  if ((inputs.unusualTransactions ?? '').trim().length > 0) {
    flags.push('Unusual transactions or large related-account transfers');
  }
  if (inputs.bankingInconsistentWithOperations === true) {
    flags.push('Banking inconsistent with reported operations');
  }

  return flags;
}

/**
 * The bundle → inputs adapter for the two functions above.
 *
 * `deskService.detail` used to spell this mapping out inline, twenty-odd field reads deep inside the
 * response literal. It lives here because it is the adapter for THESE functions: when a new indicator
 * is added above, the field that feeds it is named on the line below rather than in another file.
 *
 * `credit` and `banking` arrive as jsonb from `verificationFlowBundleRepo` and are untyped by the
 * time they reach here, so every read is optional and every number goes through the caller's
 * `toNumber`. A missing review is not a passing one — `evaluateHardStops` decides that, not this.
 */
export function deriveRiskSignals(
  credit: { bureauNoHit?: boolean; recentTrend?: string | null } | null,
  banking: Record<string, unknown> | null,
  thresholds: IndicatorThresholds,
  toNumber: (value: string | number | null | undefined) => number | null,
): { hardStops: HardStopVerdict; indicators: ReturnType<typeof managerReviewIndicators> } {
  /**
   * The jsonb reads, narrowed once. Every column this touches is a numeric, a short text or a
   * boolean in `verification_banking_reviews`; the per-field casts below name which, and this is the
   * single `as` that claims the bundle is not carrying something else entirely.
   */
  const b = (key: string): string | number | boolean | null =>
    (banking?.[key] as string | number | boolean | null) ?? null;
  return {
    hardStops: evaluateHardStops({
      avgWeeklyNetCashFlow: toNumber(b('avgWeeklyNetCashFlow') as string | number | null),
      bureauNoHit: credit?.bureauNoHit ?? false,
    }),
    indicators: managerReviewIndicators(
      {
        revenueTrend: (b('revenueTrend') as string | null) ?? null,
        avgDailyBalance: toNumber(b('avgDailyBalance') as string | number | null),
        negativeBalanceDays: (b('negativeBalanceDays') as number | null) ?? null,
        overdraftCount: (b('overdraftCount') as number | null) ?? null,
        nsfCount: (b('nsfCount') as number | null) ?? null,
        achReturnCount: (b('achReturnCount') as number | null) ?? null,
        cashFlowVolatility: (b('cashFlowVolatility') as string | null) ?? null,
        existingDebtPayments: toNumber(b('existingDebtPayments') as string | number | null),
        oneTimeDeposits: toNumber(b('oneTimeDeposits') as string | number | null),
        creditRecentTrend: credit?.recentTrend ?? null,
        unusualTransactions: (b('unusualTransactions') as string | null) ?? null,
        bankingInconsistentWithOperations:
          (b('bankingInconsistentWithOperations') as boolean | null) ?? null,
      },
      thresholds,
    ),
  };
}

/**
 * The underwriting policy a tenant has when it has never opened the policy screen.
 *
 * `verification_policy` is seeded per tenant, but a read must not create a row, so the desk detail
 * falls back to these. They are the SAME numbers the seed migration writes — kept next to
 * `deriveRiskSignals` and `IndicatorThresholds` because `adbReviewThreshold` and `nsfReviewThreshold`
 * are what they are FOR, and a default that drifts from the threshold it feeds is silent.
 */
export interface VerificationPolicyShape {
  strongFactor: string | null;
  moderateFactor: string | null;
  weakFactor: string | null;
  adbReviewThreshold: string;
  nsfReviewThreshold: number;
  bankFirstTruckMin: number;
  wexCardCutoff: number;
}

export const VERIFICATION_POLICY_DEFAULTS: VerificationPolicyShape = {
  strongFactor: '0.800',
  moderateFactor: null,
  weakFactor: null,
  adbReviewThreshold: '500',
  nsfReviewThreshold: 2,
  bankFirstTruckMin: 10,
  wexCardCutoff: 20,
};
