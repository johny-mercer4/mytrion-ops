/**
 * Phase 6 — manual credit profile + last-3-months banking. No bureau pull, no statement LLM.
 */
import type { VerificationDocType, VerificationPhaseOutcome } from '@/api/verificationFlow';

export type CreditVerdict = 'strong' | 'acceptable' | 'borderline' | 'unacceptable';
export type BankingMark = 'ok' | 'missing' | 'concern';

export interface CreditBankingMarks {
  credit: CreditVerdict | null;
  banking: Record<string, BankingMark>;
}

export const EMPTY_CREDIT_BANKING: CreditBankingMarks = { credit: null, banking: {} };

export const CREDIT_CRITERIA: readonly string[] = [
  'Credit score',
  'Late payments',
  'Collections',
  'Credit utilization ratio',
  'Recent credit inquiries (last year)',
  'Credit history length',
  'Open accounts and total debt',
  'Number of revolving accounts / credit cards',
  'Number of auto loans',
  'Number of mortgages',
  'Overall repayment behavior',
  'Recent deterioration or improvement in credit',
];

export interface BankingCheck {
  id: string;
  label: string;
}

export const BANKING_CHECKS: readonly BankingCheck[] = [
  { id: 'ownership', label: 'Account ownership — applicant/company name and address' },
  { id: 'revenue', label: 'Monthly and weekly revenue + revenue trend' },
  { id: 'cash_flow', label: 'Average weekly / monthly net cash flow' },
  { id: 'balances', label: 'Average, daily, ending and minimum balances' },
  { id: 'negative', label: 'Negative balances' },
  { id: 'nsf', label: 'NSF / overdraft / ACH returns' },
  { id: 'deposits', label: 'Sources of deposits' },
  { id: 'expenses', label: 'Major expense categories and fuel expenses' },
  { id: 'debt', label: 'Existing debt payments' },
  { id: 'one_time', label: 'One-time deposits, loans or owner contributions' },
  { id: 'transfers', label: 'Unusual transactions / related-account transfers' },
  { id: 'volatility', label: 'Cash-flow volatility' },
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
