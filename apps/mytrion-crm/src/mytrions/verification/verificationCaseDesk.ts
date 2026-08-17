/**
 * Decision Desk parity helpers for the Verification cases tab.
 * Stale threshold matches credit-platform MANUAL_REVIEW_STALE_MINUTES (default 30).
 */
import type {
  VerificationCaseAggregates,
  VerificationCaseAttachment,
  VerificationCaseStatus,
  VerificationOwnerScope,
} from '../../api/verificationCases';
import type { CasePillTone } from './verificationCaseUi';

export const OWNER_SCOPE_CHIPS: { id: VerificationOwnerScope | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'unclaimed', label: 'Unclaimed' },
  { id: 'mine', label: 'Mine' },
  { id: 'others', label: 'Others' },
];

export const ISOFTPULL_BUREAUS = [
  { id: 'isoftpull_equifax', label: 'Equifax' },
  { id: 'isoftpull_transunion', label: 'TransUnion' },
  { id: 'isoftpull_experian', label: 'Experian' },
] as const;

export const TRANSFER_UNAVAILABLE =
  'Transfer is not on credit-platform HTTP yet. Hand the case off from Decision Desk.';

export function normalizeQueueOwner(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

export function ownerMatchesViewer(
  owner: string | null | undefined,
  viewer: string | null | undefined,
): boolean {
  const left = normalizeQueueOwner(owner);
  const right = normalizeQueueOwner(viewer);
  return Boolean(left && right && left === right);
}

export function viewerActor(user: { userName?: string; userId?: string }): string {
  return (user.userName || '').trim() || (user.userId || '').trim();
}

export function paymentTone(payment: string | null | undefined): CasePillTone {
  const value = (payment ?? '').trim().toLowerCase();
  if (value === 'loc' || value.includes('line of credit')) return 'is-info';
  if (value === 'prepay' || value.includes('prepay')) return 'is-on';
  return 'is-mute';
}

export function attachmentScopeLabel(scope: string): string {
  if (scope === 'sales_bank_statement') return 'Bank statement';
  if (scope === 'analyst_note') return 'Analyst note';
  return scope.replaceAll('_', ' ') || 'File';
}

export function groupAttachments(files: readonly VerificationCaseAttachment[]): {
  id: string;
  label: string;
  files: VerificationCaseAttachment[];
}[] {
  const statements = files.filter((file) => file.scope === 'sales_bank_statement');
  const notes = files.filter((file) => file.scope === 'analyst_note');
  const other = files.filter(
    (file) => file.scope !== 'sales_bank_statement' && file.scope !== 'analyst_note',
  );
  return [
    { id: 'sales_bank_statement', label: 'Bank statements', files: statements },
    { id: 'analyst_note', label: 'Analyst notes', files: notes },
    ...(other.length ? [{ id: 'other', label: 'Other files', files: other }] : []),
  ];
}

export function statusBucketCount(
  aggregates: VerificationCaseAggregates | undefined,
  status: VerificationCaseStatus | '',
): number | null {
  if (!aggregates) return null;
  if (status === '') return aggregates.total;
  if (status === 'new') return aggregates.new ?? 0;
  if (status === 'in_progress') return aggregates.inProgress;
  if (status === 'awaiting_decision') return aggregates.awaitingDecision;
  if (status === 'approved') return aggregates.approved ?? 0;
  if (status === 'rejected') return aggregates.rejected ?? 0;
  if (status === 'failed') return aggregates.failed ?? 0;
  return null;
}

export function ownerScopeCount(
  aggregates: VerificationCaseAggregates | undefined,
  owner: VerificationOwnerScope | '',
): number | null {
  if (!aggregates) return null;
  if (owner === '') return aggregates.total;
  if (owner === 'unclaimed') return aggregates.unclaimed ?? 0;
  if (owner === 'mine') return aggregates.mine ?? 0;
  return Math.max(0, aggregates.total - (aggregates.unclaimed ?? 0) - (aggregates.mine ?? 0));
}

export const CASE_EXPORT_COLUMNS = [
  'Company',
  'Zoho id',
  'DOT',
  'Status',
  'Queue',
  'Owner',
  'Limit',
  'Payment',
  'Cycle',
] as const;
