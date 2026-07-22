/**
 * Verification pipeline — the snapshot the Sales "Verification Pipeline" tab renders per client.
 *
 * Shaped to mirror the real `credit_platform` model (kxd.<stage>_reports.status per request +
 * kxd.decision_reports / requests.result.summary) so the mock provider used today and the future
 * live provider return the IDENTICAL shape — the swap is drop-in (see provider.ts). This module is
 * pure types/constants; no DB access.
 */

/** Normalized per-stage status (maps the credit_platform status vocab into 5 UI states). */
export type PipelineStageStatus = 'done' | 'failed' | 'skipped' | 'pending' | 'not_started';

/** Stable stage ids — match credit_platform `pipeline_steps.service_id` so the live provider maps 1:1. */
export type PipelineStageId =
  | 'stop-factor-pre'
  | 'fmcsa'
  | 'plaid'
  | 'highway'
  | 'isoftpull'
  | 'blacklist'
  | 'antifraud'
  | 'crosscheck'
  | 'stop-factor-after';

export interface PipelineStage {
  id: PipelineStageId;
  /** 1-9 business display order (NOT the engine's step_order). */
  order: number;
  label: string;
  status: PipelineStageStatus;
  /** Optional per-stage detail (e.g. credit score, blacklist match count, antifraud risk band). */
  detail?: string;
}

export type PipelineOutcome = 'prepaid' | 'loc' | 'rejected' | 'undecided';

export interface PipelineDecision {
  outcome: PipelineOutcome;
  /** LOC terms — present only when outcome === 'loc'. */
  creditScore?: number;
  approvedLimit?: number;
  billingCycle?: string;
  /** Short human reason (e.g. rejection reason, or 'Pipeline in progress'). */
  reason?: string;
}

export interface PipelineSnapshot {
  stages: PipelineStage[];
  decision: PipelineDecision;
  /** Where the snapshot came from — 'mock' this phase; 'credit_platform' once the live provider lands. */
  source: 'mock' | 'credit_platform';
}

/** The 9 compliance stages in business display order. `id` matches credit_platform service ids. */
export const STAGE_CATALOG: ReadonlyArray<{ id: PipelineStageId; order: number; label: string }> = [
  { id: 'stop-factor-pre', order: 1, label: 'Pre Stop Factors' },
  { id: 'fmcsa', order: 2, label: 'FMCSA' },
  { id: 'plaid', order: 3, label: 'Plaid / Bank Statement' },
  { id: 'highway', order: 4, label: 'Highway' },
  { id: 'isoftpull', order: 5, label: 'iSoft Pull — Credit Score' },
  { id: 'blacklist', order: 6, label: 'Black List Match' },
  { id: 'antifraud', order: 7, label: 'AntiFraud' },
  { id: 'crosscheck', order: 8, label: 'CrossCheck' },
  { id: 'stop-factor-after', order: 9, label: 'Post Stop Factors' },
];

/**
 * Map a raw credit_platform status string to a normalized UI status. Used by the (future) live
 * provider; kept here so mock + live agree. Vocab from kxd.<stage>_reports.status /
 * request_tracker_events.status.
 */
export function normalizeStageStatus(raw: string | null | undefined): PipelineStageStatus {
  const s = (raw ?? '').trim().toUpperCase();
  if (!s) return 'not_started';
  if (['OK', 'COMPLETED', 'PASS', 'APPROVED'].includes(s)) return 'done';
  if (['FAILED', 'UNAVAILABLE', 'NOT_FOUND', 'CIRCUIT_OPEN', 'ERROR'].includes(s)) return 'failed';
  if (s === 'SKIPPED') return 'skipped';
  if (['PENDING', 'QUEUED', 'DISPATCHED', 'SUBMITTED', 'REVIEW'].includes(s)) return 'pending';
  return 'pending';
}
