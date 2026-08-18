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

export function reportName(row: ArrayReportRow): string {
  const person = [row.firstName, row.lastName].filter(Boolean).join(' ').trim();
  return row.companyName?.trim() || row.displayName?.trim() || person || `Carrier ${row.carrierId}`;
}

export function reportInitials(row: ArrayReportRow): string {
  return initials(reportName(row), row.carrierId);
}
