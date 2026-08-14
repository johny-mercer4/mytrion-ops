/**
 * Shared formatters and term predicates for Verification's roster cards and the detail modal.
 * A 0 credit score is "not scored" — the same rule `verificationPipeline/service.ts` uses.
 */

export function money(n: number | null): string {
  if (n == null) return '—';
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function dash(v: string | number | null | undefined): string {
  return v === '' || v == null ? '—' : String(v);
}

export function isPrepayTerms(terms: string): boolean {
  return terms.trim().toLowerCase() === 'prepay';
}

export function hasCreditScore(score: number | null): boolean {
  return score != null && score !== 0;
}

export function isCreditworthy(row: { isDebtor: boolean; creditScore: number | null }): boolean {
  return !row.isDebtor && hasCreditScore(row.creditScore);
}
