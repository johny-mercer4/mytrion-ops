/**
 * Existing clients — the roster's vocabulary, with no React in it.
 *
 * The filtering and sorting already live in `verificationData.ts` and are reused verbatim; what is
 * here is the four SCOPES the design puts on tabs (which cut across the debtor and active flags) and
 * the presentation each column needs: what a billing rail is called, when a figure applies at all,
 * and which numbers are absent rather than zero.
 *
 * ABSENT IS NOT ZERO, and this roster is full of both. A prepay carrier has no minimum balance and a
 * non-LOC carrier has no credit limit — the column does not apply, so it reads as an em dash rather
 * than `$0`, which would look like a carrier trusted with nothing. `creditScore` is the sharpest
 * case: `dim_company` stores 0 for "never scored", so a literal render would put every unscored
 * carrier at the bottom of a credit sort with a real-looking number.
 */
import type { VerificationClientRow } from '@/api/verificationClients';
import { hasCreditScore } from '../verificationFormat';

export type Scope = 'all' | 'clear' | 'debtors' | 'inactive';

export const SCOPES: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All on file' },
  { id: 'clear', label: 'Not flagged' },
  { id: 'debtors', label: 'Debtors' },
  { id: 'inactive', label: 'Inactive' },
];

export function inScope(row: VerificationClientRow, scope: Scope): boolean {
  switch (scope) {
    case 'clear':
      return !row.isDebtor;
    case 'debtors':
      return row.isDebtor;
    case 'inactive':
      return !row.isActive;
    default:
      return true;
  }
}

export function scopeCounts(rows: readonly VerificationClientRow[]): Record<Scope, number> {
  const out = { all: rows.length, clear: 0, debtors: 0, inactive: 0 };
  for (const row of rows) {
    if (row.isDebtor) out.debtors += 1;
    else out.clear += 1;
    if (!row.isActive) out.inactive += 1;
  }
  return out;
}

export interface RailStyle {
  label: string;
  /** A wayfinding hue from the shared --tone-* scale, paired with its own glyph. */
  tone: string;
  icon: string;
}

/**
 * `dim_company.billing_type` → how the desk reads it.
 *
 * The column holds the payment RAIL a carrier settles on. Finance's roster calls the same column
 * "Billing"; this surface follows the design and calls it the aggregator, because that is the word
 * the credit desk used when the tab was specified. Unknown values are humanised rather than hidden —
 * a new CMP rail must appear, not silently vanish from a filter.
 */
export const RAIL_STYLE: Record<string, RailStyle> = {
  BANK: { label: 'Bank', tone: 'var(--tone-sky)', icon: 'account_balance' },
  DIRECT: { label: 'Direct', tone: 'var(--tone-emerald)', icon: 'swap_horiz' },
  MERCHANT_CARD: { label: 'Merchant card', tone: 'var(--tone-amber)', icon: 'credit_card' },
  ZELLE: { label: 'Zelle', tone: 'var(--tone-violet)', icon: 'smartphone' },
};

export function railStyle(companyType: string): RailStyle {
  const known = RAIL_STYLE[companyType];
  if (known) return known;
  const label = companyType.replace(/_/g, ' ').trim();
  return {
    label: label === '' ? 'Not set' : label.charAt(0).toUpperCase() + label.slice(1).toLowerCase(),
    tone: 'var(--tone-slate)',
    icon: 'apartment',
  };
}

export function isPrepay(row: Pick<VerificationClientRow, 'paymentTerms'>): boolean {
  return row.paymentTerms.trim().toLowerCase() === 'prepay';
}

export function isLoc(row: Pick<VerificationClientRow, 'paymentTerms'>): boolean {
  return row.paymentTerms.trim().toUpperCase() === 'LOC';
}

export function termsLabel(row: Pick<VerificationClientRow, 'paymentTerms'>): string {
  return row.paymentTerms.trim() === '' ? 'Not set' : row.paymentTerms.trim();
}

export type TermsIntent = 'info' | 'warning' | 'neutral';

export function termsIntent(row: Pick<VerificationClientRow, 'paymentTerms'>): TermsIntent {
  if (isLoc(row)) return 'info';
  if (isPrepay(row)) return 'warning';
  return 'neutral';
}

export function money(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    currencyDisplay: 'narrowSymbol',
    maximumFractionDigits: 0,
  });
}

/** Minimum required balance — meaningless on prepay, where there is no balance to hold. */
export function minBalanceText(row: VerificationClientRow): string {
  return isPrepay(row) ? '—' : money(row.minimumRequiredBalance);
}

/** Credit limit — only a fact when the carrier is on a line of credit. */
export function limitText(row: VerificationClientRow): string {
  return isLoc(row) ? money(row.creditLimit) : '—';
}

/** A stored 0 means "never scored"; rendering it would read as a real, terrible score. */
export function scoreText(row: VerificationClientRow): string {
  return hasCreditScore(row.creditScore) ? String(row.creditScore) : '—';
}

export type ScoreTone = 'good' | 'plain' | 'warn' | 'none';

/**
 * The CreditSafe band, at the cut-points the desk already uses on its cards.
 *
 * Never colour alone: every caller renders the number itself, and the tone only sharpens what the
 * figure already says.
 */
export function scoreTone(row: VerificationClientRow): ScoreTone {
  if (!hasCreditScore(row.creditScore)) return 'none';
  const score = row.creditScore ?? 0;
  if (score >= 800) return 'good';
  if (score >= 750) return 'plain';
  return 'warn';
}

/** `2026-08-11` → `11 Aug`. Null means the carrier has never swiped. */
export function activityText(lastTransactionAt: string | null): string {
  if (!lastTransactionAt) return 'Never';
  const ms = Date.parse(lastTransactionAt.slice(0, 10));
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Full date for the detail dialog, where there is room. */
export function fullDate(value: string | null): string {
  if (!value) return '—';
  const ms = Date.parse(value.slice(0, 10));
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/** The row's left edge: a debtor is the loudest fact on this roster, then a dormant account. */
export type RowEdge = 'debtor' | 'inactive' | 'none';

export function rowEdge(row: VerificationClientRow): RowEdge {
  if (row.isDebtor) return 'debtor';
  if (!row.isActive) return 'inactive';
  return 'none';
}

/**
 * One address line from three columns that overlap.
 *
 * `dim_company.address` frequently already ends in the city and state — joining all three blindly
 * produced "3570 e 7th ave, Hialeah, FL, Hialeah, FL" on a live carrier. Each part is appended only
 * if the line does not already contain it.
 */
export function addressText(parts: {
  address: string | null;
  city: string | null;
  state: string | null;
}): string {
  const base = (parts.address ?? '').trim();
  const out = base === '' ? [] : [base];
  const has = (value: string): boolean =>
    out.join(', ').toLowerCase().includes(value.trim().toLowerCase());
  for (const extra of [parts.city, parts.state]) {
    const value = (extra ?? '').trim();
    if (value !== '' && !has(value)) out.push(value);
  }
  return out.join(', ') || '—';
}

export const SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'creditworthy', label: 'Creditworthy first' },
  { value: 'name', label: 'Name A–Z' },
  { value: 'score', label: 'Credit score' },
  { value: 'recent', label: 'Recently active' },
];

export function sortLabel(sort: string): string {
  return (SORT_OPTIONS.find((s) => s.value === sort)?.label ?? SORT_OPTIONS[0]!.label).toLowerCase();
}
