/**
 * Phase 6 — the credit profile and the last three months of banking.
 *
 * WHAT WAS WRONG HERE, and it was not cosmetic. `verification_credit_reviews` and
 * `verification_banking_reviews` carry a typed column for every field the SOP lists, the desk already
 * has routes to write them, and PHASE 7 AND PHASE 9 READ THEM: `evaluateHardStops` gates the unsecured
 * LOC on `avgWeeklyNetCashFlow` and `bureauNoHit`, `managerReviewIndicators` reads nine banking
 * columns, and the capacity formula is `avgWeeklyNetCashFlow + avgWeeklyFuelExpense`.
 *
 * This pane captured NONE of it. It held thirteen marks in React state, discarded on unmount, beside a
 * dead `<ul>` of the twelve credit criteria — so every downstream phase evaluated against nulls, and
 * the reviewer had nowhere to put a number they were looking straight at. The fields below are the
 * SOP's own lists, each mapped to the column that already exists for it.
 *
 * THE MARKS STAY, for one reason: `missing` is what asks Sales for statements. A number the reviewer
 * has not been given is different from a number they read as zero, and only the mark can say which.
 */
import type {
  VerificationBankingReview,
  VerificationCreditReview,
  VerificationDocType,
  VerificationPhaseOutcome,
} from '@/api/verificationFlow';

export type CreditVerdict = 'strong' | 'acceptable' | 'borderline' | 'unacceptable';
export type BankingMark = 'ok' | 'missing' | 'concern';

export interface CreditBankingMarks {
  credit: CreditVerdict | null;
  banking: Record<string, BankingMark>;
}

export const EMPTY_CREDIT_BANKING: CreditBankingMarks = { credit: null, banking: {} };

/** Which numeric shape a field takes — decides the input mode, the suffix and the parser. */
export type ReviewFieldKind = 'money' | 'count' | 'score' | 'pct' | 'months';

export interface ReviewField {
  /** The column name, verbatim, so the form body needs no translation layer. */
  id: string;
  label: string;
  kind: ReviewFieldKind;
  /** Shown under the input when the number needs a definition rather than a name. */
  hint?: string;
}

/**
 * The SOP's twelve credit lines, as the columns that hold them.
 *
 * "Open accounts and total debt" is one SOP bullet and two columns, which is why the list is fourteen
 * fields for twelve bullets. `repaymentBehavior` and `recentTrend` are the two that are not numbers
 * and are rendered separately.
 */
export const CREDIT_FIELDS: readonly ReviewField[] = [
  { id: 'creditScore', label: 'Credit score', kind: 'score' },
  { id: 'latePayments', label: 'Late payments', kind: 'count' },
  { id: 'collections', label: 'Collections', kind: 'count' },
  { id: 'utilizationPct', label: 'Credit utilization', kind: 'pct' },
  { id: 'inquiries12m', label: 'Inquiries (last 12 months)', kind: 'count' },
  { id: 'historyMonths', label: 'Credit history length', kind: 'months' },
  { id: 'openAccounts', label: 'Open accounts', kind: 'count' },
  { id: 'totalDebt', label: 'Total debt', kind: 'money' },
  { id: 'revolvingAccounts', label: 'Revolving accounts / cards', kind: 'count' },
  { id: 'autoLoans', label: 'Auto loans', kind: 'count' },
  { id: 'mortgages', label: 'Mortgages', kind: 'count' },
];

/**
 * The banking numbers, grouped the way the SOP reads them rather than the way the table stores them.
 *
 * `recurringWeeklyIncome` and `recurringWeeklyExpenses` come FIRST and together, because the weekly
 * net cash flow is derived from exactly those two and nothing else — it is not accepted from the
 * client at all (`saveBankingReview` computes it), and it is the Phase 7 hard stop. A reviewer typing
 * them needs to see the subtraction happen.
 */
export const BANKING_FIELD_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  note?: string;
  fields: readonly ReviewField[];
}> = [
  {
    id: 'cash_flow',
    title: 'Recurring cash flow',
    note: 'Weekly net cash flow is income minus expenses, and Phase 7 stops the unsecured LOC when it is not above zero. Exclude one-time and unexplained deposits.',
    fields: [
      { id: 'recurringWeeklyIncome', label: 'Recurring weekly income', kind: 'money' },
      { id: 'recurringWeeklyExpenses', label: 'Recurring weekly expenses', kind: 'money' },
      { id: 'avgMonthlyNetCashFlow', label: 'Average monthly net cash flow', kind: 'money' },
      {
        id: 'avgWeeklyFuelExpense',
        label: 'Average weekly fuel expense',
        kind: 'money',
        hint: 'Phase 9 adds this back for adjusted capacity — do not also count it as an expense above.',
      },
    ],
  },
  {
    id: 'revenue',
    title: 'Revenue',
    fields: [
      { id: 'monthlyRevenue', label: 'Monthly revenue', kind: 'money' },
      { id: 'weeklyRevenue', label: 'Weekly revenue', kind: 'money' },
    ],
  },
  {
    id: 'balances',
    title: 'Balances',
    fields: [
      {
        id: 'avgDailyBalance',
        label: 'Average daily balance',
        kind: 'money',
        hint: 'Below the policy threshold this becomes a manager-review indicator.',
      },
      { id: 'endingBalance', label: 'Ending balance', kind: 'money' },
      { id: 'minimumBalance', label: 'Minimum balance', kind: 'money' },
      { id: 'negativeBalanceDays', label: 'Days with a negative balance', kind: 'count' },
    ],
  },
  {
    id: 'returns',
    title: 'Returns and overdrafts',
    note: 'NSF and returned ACH are one indicator in the SOP, so they are summed against the policy threshold.',
    fields: [
      { id: 'nsfCount', label: 'NSF events', kind: 'count' },
      { id: 'achReturnCount', label: 'Returned ACH', kind: 'count' },
      { id: 'overdraftCount', label: 'Overdrafts', kind: 'count' },
    ],
  },
  {
    id: 'obligations',
    title: 'Obligations and one-offs',
    fields: [
      { id: 'existingDebtPayments', label: 'Existing debt payments', kind: 'money' },
      { id: 'oneTimeDeposits', label: 'One-time deposits / owner contributions', kind: 'money' },
    ],
  },
];

/** Flat, for the form body and for counting how much of the review is filled. */
export const BANKING_FIELDS: readonly ReviewField[] = BANKING_FIELD_GROUPS.flatMap((g) => g.fields);

export interface BankingCheck {
  id: string;
  label: string;
}

/**
 * The SOP rows that are a JUDGEMENT rather than a number, and the two that the table stores as jsonb
 * the write route does not accept. These keep their OK / Missing / Concern mark — `missing` is the
 * only thing that can ask Sales for statements.
 */
export const BANKING_CHECKS: readonly BankingCheck[] = [
  { id: 'ownership', label: 'Account ownership — applicant/company name and address' },
  { id: 'deposits', label: 'Sources of deposits' },
  { id: 'expenses', label: 'Major expense categories' },
  { id: 'transfers', label: 'Unusual transactions / related-account transfers' },
];

export function creditSidePass(verdict: CreditVerdict | null): boolean {
  return verdict === 'strong' || verdict === 'acceptable';
}

export function bankingComplete(marks: Record<string, BankingMark>): boolean {
  return BANKING_CHECKS.every((c) => marks[c.id] === 'ok' || marks[c.id] === 'concern');
}

export function creditBankingCanPass(marks: CreditBankingMarks): boolean {
  return creditSidePass(marks.credit) && bankingComplete(marks.banking);
}

export function missingBankingDocs(
  marks: Record<string, BankingMark>,
): Array<{ docType: VerificationDocType; label: string }> {
  if (!BANKING_CHECKS.some((c) => marks[c.id] === 'missing')) return [];
  return [{ docType: 'bank_statement', label: 'Bank statements (last 3 months)' }];
}

export function creditPhaseOutcome(verdict: CreditVerdict | null): VerificationPhaseOutcome | null {
  if (verdict === 'borderline') return 'manager_review';
  if (verdict === 'unacceptable') return 'deposit_prepaid';
  return null;
}

export function creditBankingChecklistLines(): readonly string[] {
  return ['Credit profile result', 'Banking — last 3 months'];
}

// ---- Form values -------------------------------------------------------------------------------

/**
 * Every field is held as the STRING the reviewer typed, not as a number.
 *
 * Parsing on each keystroke would fight them: "-" and "12." are both mid-entry states that
 * `Number()` reads as NaN, and a form that erases a half-typed minus sign is unusable for a negative
 * cash flow — which is exactly the value Phase 7 cares about most. Parsing happens once, on save.
 */
export type ReviewValues = Record<string, string>;

/** `null` and `undefined` both mean "nothing recorded" and must render as an empty field, not "0". */
function toInput(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

export function creditValuesFrom(review: VerificationCreditReview | null): ReviewValues {
  const out: ReviewValues = {};
  const row = (review ?? {}) as unknown as Record<string, unknown>;
  for (const field of CREDIT_FIELDS) out[field.id] = toInput(row[field.id]);
  return out;
}

export function bankingValuesFrom(review: VerificationBankingReview | null): ReviewValues {
  const out: ReviewValues = {};
  const row = (review ?? {}) as unknown as Record<string, unknown>;
  for (const field of BANKING_FIELDS) out[field.id] = toInput(row[field.id]);
  return out;
}

/**
 * One field, parsed for the wire. Blank means "clear it" (`null`), never 0.
 *
 * Returns `undefined` for a value that is not a number at all, so a typo is DROPPED from the body
 * rather than sent as `NaN` — the route's zod schema would reject the whole save, losing every other
 * field the reviewer had just typed.
 */
export function parseReviewField(kind: ReviewFieldKind, raw: string): number | null | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const n = Number(trimmed.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(n)) return undefined;
  // Counts and scores are whole; money and percentages are not.
  if (kind === 'count' || kind === 'score' || kind === 'months') {
    return Number.isInteger(n) && n >= 0 ? n : undefined;
  }
  return n;
}

/** The save body: only fields that parsed, so one bad cell cannot reject the whole form. */
export function reviewBody(
  fields: readonly ReviewField[],
  values: ReviewValues,
): { body: Record<string, number | null>; rejected: string[] } {
  const body: Record<string, number | null> = {};
  const rejected: string[] = [];
  for (const field of fields) {
    const parsed = parseReviewField(field.kind, values[field.id] ?? '');
    if (parsed === undefined) {
      if ((values[field.id] ?? '').trim() !== '') rejected.push(field.label);
      continue;
    }
    body[field.id] = parsed;
  }
  return { body, rejected };
}

/**
 * The weekly net cash flow the SERVER will derive, shown live so the reviewer sees the Phase 7 hard
 * stop coming while they type rather than after they save.
 *
 * Null when either input is blank — a subtraction with one number missing is not a zero.
 */
export function weeklyNetCashFlow(values: ReviewValues): number | null {
  const income = parseReviewField('money', values.recurringWeeklyIncome ?? '');
  const expenses = parseReviewField('money', values.recurringWeeklyExpenses ?? '');
  if (typeof income !== 'number' || typeof expenses !== 'number') return null;
  return income - expenses;
}

/** How much of a review is filled, for the step header. Counts a recorded 0 as filled. */
export function filledCount(fields: readonly ReviewField[], values: ReviewValues): number {
  return fields.filter((f) => (values[f.id] ?? '').trim() !== '').length;
}
