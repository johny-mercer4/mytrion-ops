/**
 * Phase 9 — risk tier and credit capacity, the pure half.
 *
 * WHAT THE PANE WAS MISSING. The SOP assigns the tier from SIX named inputs — credit report, banking /
 * cash flow, business age, authority age where applicable, Highway data where applicable, and overall
 * application consistency — and the pane offered three tier buttons and a free-text note, so there was
 * nowhere to record what the tier was assigned FROM. Worse, the route already accepts
 * `businessAgeMonths`, `authorityAgeMonths` and `keyRisks`, the service already stores them, and
 * "key risks" is one of the sixteen lines the SOP requires of the underwriting summary — and the pane
 * sent none of the three.
 *
 * THE CAPACITY MATHS LIVES ON THE SERVER, deliberately, and is mirrored here for PREVIEW only.
 * `computeRecommendedLimit` computes from the STORED banking review so a recommended limit always
 * traces to figures an analyst recorded. What the reviewer needs before they commit is to see the
 * three steps happen — so these functions reproduce them, and the pane labels the result a preview.
 */
import type { VerificationDeskDetail, VerificationRiskTier } from '@/api/verificationFlow';

/** How each SOP input reads. The same three words as the tier, because that is what they feed. */
export type RiskRead = 'strong' | 'moderate' | 'weak';

export interface RiskMarks {
  inputs: Record<string, RiskRead>;
  tier: VerificationRiskTier | null;
}

/** `tier: null`, NOT `'strong'`. A defaulted risk tier prices the case at the most generous factor. */
export const EMPTY_RISK_MARKS: RiskMarks = { inputs: {}, tier: null };

export interface RiskInput {
  id: string;
  label: string;
  /** "where applicable" in the SOP means carrier-only — an owner-operator has neither. */
  carrierOnly?: boolean;
  hint?: string;
}

export const RISK_INPUTS: readonly RiskInput[] = [
  { id: 'credit', label: 'Credit report', hint: 'The Phase 6 profile, as a whole' },
  { id: 'banking', label: 'Banking / cash flow', hint: 'Trend, balances, returns and volatility' },
  { id: 'business_age', label: 'Business age' },
  { id: 'authority_age', label: 'Authority age', carrierOnly: true },
  { id: 'highway', label: 'Highway data', carrierOnly: true },
  { id: 'consistency', label: 'Overall application consistency' },
];

/** Which inputs this applicant actually has. The SOP's "where applicable", made concrete. */
export function riskInputsFor(applicantType: string | null | undefined): readonly RiskInput[] {
  return RISK_INPUTS.filter((i) => !i.carrierOnly || applicantType === 'carrier');
}

/**
 * Whether Phase 9 may be passed.
 *
 * A tier, and a read on every input that applies. Phase 9 had no gate at all, so "Pass phase" was
 * enabled on a case with no risk assessment — and since Phase 10 prices the approval off the
 * recommended limit, that is an approval with no basis.
 *
 * A recommended limit is deliberately NOT required: the SOP leaves the moderate and weak factors to
 * approved policy, so a tier whose factor is unset can be assessed and recorded even though no limit
 * can be computed for it. Requiring the limit would make those two tiers unreachable.
 */
export function riskCanPass(marks: RiskMarks, applicantType: string | null | undefined): boolean {
  if (marks.tier === null) return false;
  return riskInputsFor(applicantType).every((i) => marks.inputs[i.id] !== undefined);
}

export function riskInputsRead(marks: RiskMarks, applicantType: string | null | undefined): number {
  return riskInputsFor(applicantType).filter((i) => marks.inputs[i.id] !== undefined).length;
}

/** Only the three tones `.va-id-check[data-mark]` styles. A weak read is a finding, not an absence. */
export function riskReadTone(read: RiskRead | undefined): string {
  if (read === 'strong') return 'ok';
  if (read === 'moderate') return 'missing';
  if (read === 'weak') return 'inconsistent';
  return 'unset';
}

/**
 * What the six reads point at, so the reviewer can see whether their tier matches their own inputs.
 *
 * A SUGGESTION AND NOTHING MORE — the SOP has a human assign the tier, and the pane never applies
 * this. The rule is the conservative one: the tier cannot be better than the worst read, because a
 * single weak input is what a tier is meant to carry. Null until every applicable input is read;
 * two-thirds of an assessment implies nothing.
 */
export function tierFromReads(
  marks: RiskMarks,
  applicantType: string | null | undefined,
): VerificationRiskTier | null {
  const inputs = riskInputsFor(applicantType);
  const reads = inputs.map((i) => marks.inputs[i.id]);
  if (reads.some((r) => r === undefined)) return null;
  if (reads.includes('weak')) return 'weak';
  if (reads.includes('moderate')) return 'moderate';
  return 'strong';
}

// ---- Capacity preview -------------------------------------------------------------------------

export interface CapacityPreview {
  income: number;
  expenses: number;
  fuel: number;
  netCashFlow: number;
  adjustedCapacity: number;
  /** Null when the chosen tier has no approved factor — the SOP's unset moderate and weak. */
  riskFactor: number | null;
  recommendedLimit: number | null;
  /**
   * True when recorded fuel exceeds recorded recurring expenses, which means fuel was entered
   * OUTSIDE those expenses and step 2 would add back capacity that was never subtracted. The server
   * refuses with a 422; showing it here means the reviewer learns before they click.
   */
  fuelDoubleCounted: boolean;
}

function num(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const money = (n: number): number => Math.round(n * 100) / 100;

/**
 * The SOP's three steps, off the STORED banking review, for the tier currently selected.
 *
 * Null when the banking review has not recorded all three figures — the server refuses in that case
 * too, and a capacity built from two of the three would look just as authoritative.
 */
export function capacityPreview(
  detail: VerificationDeskDetail,
  tier: VerificationRiskTier | null,
): CapacityPreview | null {
  const b = (detail.banking ?? {}) as unknown as Record<string, unknown>;
  const income = num(b.recurringWeeklyIncome);
  const expenses = num(b.recurringWeeklyExpenses);
  const fuel = num(b.avgWeeklyFuelExpense);
  if (income === null || expenses === null || fuel === null) return null;

  // 1. Average weekly net cash flow. 2. Fuel added BACK, because the card displaces that spend.
  const netCashFlow = money(income - expenses);
  const adjustedCapacity = money(netCashFlow + fuel);

  const factor =
    tier === 'strong'
      ? detail.policy.strongFactor
      : tier === 'moderate'
        ? detail.policy.moderateFactor
        : tier === 'weak'
          ? detail.policy.weakFactor
          : null;

  return {
    income,
    expenses,
    fuel,
    netCashFlow,
    adjustedCapacity,
    riskFactor: factor,
    // 3. Recommended limit. A non-positive capacity cannot support a line, and must never emit a
    // negative "limit" — Phase 7's hard stop should have caught it, but this is the calculator.
    recommendedLimit:
      factor === null ? null : adjustedCapacity <= 0 ? 0 : money(adjustedCapacity * factor),
    fuelDoubleCounted: fuel > expenses,
  };
}

/** Whether both Phase 6 reviews exist — the server refuses the assessment without them. */
export function reviewsOutstanding(detail: VerificationDeskDetail): string[] {
  return [detail.credit ? null : 'credit', detail.banking ? null : 'banking'].filter(
    (x): x is string => x !== null,
  );
}

/** Whole dollars. These are policy figures, never exact balances. */
export function riskMoney(n: number): string {
  return n.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}
