/**
 * Array reports vocabulary — Metro 2 status labels and identity helpers. No React.
 */
import type { ArrayReportRow } from '@/api/collection';
import { initials } from '../collectionFormat';

/** Metro 2 account-status codes seen on the seeded book, plus a few neighbours. */
export const ACCOUNT_STATUS_LABEL: Record<string, string> = {
  '11': 'Current',
  '13': 'Paid / current',
  '71': '180+ days past due',
  '78': 'Redeemed',
  '80': 'P&L write-off',
  '83': 'Collection',
  '84': 'Paid collection',
  '93': 'Assigned to agency',
};

export function accountStatusLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return ACCOUNT_STATUS_LABEL[code] ?? `Status ${code}`;
}

/**
 * Zoho's record name for a tradeline carries the period: "Prem Bhardwaj - May 2026". Beside a
 * Period column that already says May 2026, that made every row of the list repeat itself. The
 * suffix is stripped here rather than in the cell, so the detail header and the initials agree
 * with the list.
 */
export function stripPeriodSuffix(name: string): string {
  return name.replace(/\s*[-–]\s*(\d{4}-\d{2}|[A-Z][a-z]{2,8}\s+\d{4})$/, '').trim();
}

/**
 * Who the tradeline is for.
 *
 * The PERSON outranks `displayName`: these are consumer tradelines filed against an individual,
 * and the Zoho record name is a label for the record, not for the debtor. `displayName` stays as
 * the fallback for a row that has neither a company nor a name.
 */
export function reportName(row: ArrayReportRow): string {
  const person = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  const display = row.displayName?.trim() ? stripPeriodSuffix(row.displayName.trim()) : '';
  return row.companyName?.trim() || person || display || `Carrier ${row.carrierId}`;
}

/**
 * The account number, only when it says something the carrier id has not. In the live book they
 * are frequently the same value, and "5794279 · 5794279" is noise on every row.
 */
export function reportAccountRef(row: ArrayReportRow): string | null {
  const acct = row.customerAccountNumber?.trim();
  if (!acct || acct === row.carrierId) return null;
  return acct;
}

export function reportInitials(row: ArrayReportRow): string {
  return initials(reportName(row), row.carrierId);
}
