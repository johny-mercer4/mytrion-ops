import type { VerificationCaseStatus } from '../../api/verificationCases';

export const CASE_STATUS_LABELS: { id: VerificationCaseStatus | ''; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'awaiting_decision', label: 'Hold' },
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

export const AUTO_FIRST_RUN_STAGE_IDS = ['stop_factor_pre', 'blacklist', 'fmcsa'] as const;
export const BILLABLE_STAGE_IDS = ['plaid_bs', 'isoftpull', 'creditsafe'] as const;

export type StageGroupId = 'auto' | 'manual';

export function stageGroup(stageId: string): StageGroupId {
  return (AUTO_FIRST_RUN_STAGE_IDS as readonly string[]).includes(stageId) ? 'auto' : 'manual';
}

export function groupStageCatalog<T extends { id: string }>(
  catalog: readonly T[],
): { id: StageGroupId; title: string; hint: string; stages: T[] }[] {
  const auto = catalog.filter((stage) => stageGroup(stage.id) === 'auto');
  const manual = catalog.filter((stage) => stageGroup(stage.id) === 'manual');
  return [
    {
      id: 'auto',
      title: 'Auto (first run)',
      hint: 'System-run. Does not claim.',
      stages: auto,
    },
    {
      id: 'manual',
      title: 'Manual',
      hint: 'Analyst work. HTTP Run claims the case.',
      stages: manual,
    },
  ];
}

export function isBillableStage(stageId: string): boolean {
  return (BILLABLE_STAGE_IDS as readonly string[]).includes(stageId);
}

export function reviewOwnerLabel(username: string | null | undefined): { label: string; claimed: boolean } {
  const name = username?.trim();
  if (name) return { label: `Claimed by ${name}`, claimed: true };
  return { label: 'Auto (unclaimed)', claimed: false };
}

export function firstRunLabel(status: string | null | undefined): string {
  if (status === 'in_flight') return 'First run in flight';
  if (status === 'completed') return 'First run done';
  if (status === 'error') return 'First run error';
  return 'First run idle';
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function stageStepMeta(result: Record<string, unknown> | null | undefined): {
  stepStatus: string;
  noHit: boolean;
} {
  const blob = rec(result);
  const stepStatus = String(blob.step_status ?? blob.stepStatus ?? '').trim();
  const noHit = blob.no_hit === true || blob.noHit === true || stepStatus.toUpperCase() === 'NOT_FOUND';
  return { stepStatus, noHit };
}

export function stageDisplay(input: {
  status: string;
  result?: Record<string, unknown> | null | undefined;
  error?: string | null | undefined;
}): { label: string; tone: string; note: string | null } {
  const { stepStatus, noHit } = stageStepMeta(input.result);
  const error = input.error?.trim() ?? '';
  if (input.status === 'failed' && noHit && !error) {
    return {
      label: 'No hit',
      tone: 'is-info',
      note: 'No match in FMCSA — not a pipeline outage.',
    };
  }
  if (input.status === 'failed' && !error && stepStatus) {
    return {
      label: humanizeToken(stepStatus),
      tone: 'is-info',
      note: `Step status ${stepStatus} — not a pipeline outage.`,
    };
  }
  if (input.status === 'approved') return { label: 'Approved', tone: 'is-good', note: error || null };
  if (input.status === 'failed') return { label: 'Failed', tone: 'is-bad', note: error || null };
  if (input.status === 'running' || input.status === 'ran' || input.status === 'ready') {
    return { label: humanizeToken(input.status), tone: 'is-info', note: error || null };
  }
  if (input.status === 'skipped') return { label: 'Skipped', tone: 'is-neutral', note: error || null };
  return { label: humanizeToken(input.status), tone: '', note: error || (stepStatus ? `Step ${stepStatus}` : null) };
}

export function billableRunGate(input: {
  stageId: string;
  readiness?: {
    ready: boolean;
    missing: string[];
    paid: boolean;
    alreadyPaid?: boolean;
    circuitOpen?: boolean;
  } | null;
  readinessAvailable: boolean;
  plaidMode?: string | null;
}): { blocked: boolean; reason: string | null } {
  if (!isBillableStage(input.stageId)) return { blocked: false, reason: null };
  if (input.stageId === 'plaid_bs' && input.plaidMode === 'bank_statement') {
    return { blocked: false, reason: null };
  }
  if (!input.readinessAvailable) {
    return {
      blocked: true,
      reason: 'Billable stages stay on Decision Desk / authenticated HTTP until readiness is available.',
    };
  }
  if (input.readiness?.alreadyPaid) {
    return { blocked: true, reason: 'Already paid on this request.' };
  }
  if (input.readiness?.circuitOpen) {
    return { blocked: true, reason: 'Paid-stage circuit is open. Wait or use Decision Desk.' };
  }
  if (input.readiness?.paid && !input.readiness.ready) {
    const missing = input.readiness.missing.length
      ? `Missing ${input.readiness.missing.join(', ')}.`
      : 'Not ready.';
    return { blocked: true, reason: `${missing} Run this stage from Decision Desk when the file is complete.` };
  }
  return { blocked: false, reason: null };
}
