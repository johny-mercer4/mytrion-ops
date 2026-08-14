import type { VerificationCaseStatus } from '../../api/verificationCases';

export const CASE_STATUS_LABELS: { id: VerificationCaseStatus | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'awaiting_decision', label: 'Awaiting decision' },
  { id: 'approved', label: 'Approved' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'failed', label: 'Failed' },
];

export type CasePillTone = 'is-on' | 'is-bad' | 'is-warn' | 'is-info' | 'is-mute';

export function caseStatusLabel(status: VerificationCaseStatus | string): string {
  return CASE_STATUS_LABELS.find((s) => s.id === status)?.label ?? status.replaceAll('_', ' ');
}

export function caseStatusTone(status: VerificationCaseStatus): CasePillTone {
  if (status === 'approved') return 'is-on';
  if (status === 'rejected' || status === 'failed') return 'is-bad';
  if (status === 'awaiting_decision') return 'is-warn';
  if (status === 'in_progress') return 'is-info';
  return 'is-mute';
}

export function queueLabel(distributeType: 'personal' | 'shared'): string {
  return distributeType === 'shared' ? 'Shared' : 'Personal';
}

export function humanizeToken(value: string | null | undefined): string {
  if (!value?.trim()) return '—';
  return value.replaceAll('_', ' ');
}
