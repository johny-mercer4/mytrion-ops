/**
 * Verification pipeline — the snapshot the Sales "Verification Pipeline" tab renders per client.
 *
 * Shaped to mirror the real `credit_platform` model (kxd.<stage>_reports.status per request +
 * kxd.decision_reports / requests.result.summary) so the live and development providers return the
 * identical shape. This module is pure types/constants; no DB access.
 */

/** Normalized per-stage status (maps the credit_platform status vocab into 5 UI states). */
export type PipelineStageStatus = 'done' | 'failed' | 'skipped' | 'pending' | 'not_started';

export type PipelineStageId =
  | 'stop-factor-pre'
  | 'blacklist'
  | 'fmcsa'
  | 'plaid'
  | 'highway'
  | 'creditsafe'
  | 'isoftpull'
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
  used?: boolean;
  stoppedBy?: string;
  related?: Array<{ label: string; value: string }>;
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

export type PipelineRequirementFieldType =
  | 'text'
  | 'number'
  | 'email'
  | 'date'
  | 'textarea'
  | 'select';

export interface PipelineRequirementField {
  id: string;
  label: string;
  type: PipelineRequirementFieldType;
  required: boolean;
  /** What Verification needs in this field so the application can proceed. Never an HTML placeholder. */
  hint?: string;
  options?: string[];
}

export interface PipelineRequirementResponse {
  sentAt: string;
  sentBy: string;
  attachmentName: string | null;
  warning: string | null;
}

/** A Verification event that needs a concrete Sales answer. */
export interface PipelineRequirement {
  id: string;
  eventId: string;
  title: string;
  detail: string | null;
  createdAt: string;
  fields: PipelineRequirementField[];
  attachmentRequired: boolean;
  attachmentLabel: string | null;
  response?: PipelineRequirementResponse;
}

export interface PipelineTimelineEvent {
  id: string;
  stage: string;
  status: string | null;
  title: string;
  createdAt: string;
}

export interface PipelineAttachment {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  scope: string;
  createdAt: string;
}

/** Current applicant identity values, for prefilling the Sales edit form. Sourced from the PLAINTEXT
 * payload.zoho_raw (+ the non-encrypted profile fields); never the encrypted applicant_profile. */
export interface PipelineApplicant {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  dotNumber: string;
  mcNumber: string;
}

export interface PipelinePlaid {
  status: string | null;
  linkState: string | null;
  linkUrl: string | null;
  lastActionStatus: string | null;
  lastActionError: string | null;
}

export interface PipelineSnapshot {
  requestId: string;
  status: string;
  updatedAt: string | null;
  stages: PipelineStage[];
  decision: PipelineDecision;
  requirements: PipelineRequirement[];
  events: PipelineTimelineEvent[];
  attachments: PipelineAttachment[];
  /** Current applicant values for the edit-applicant prefill (present only for the live provider). */
  applicant?: PipelineApplicant;
  plaid?: PipelinePlaid;
  /** Where the snapshot came from. */
  source: 'mock' | 'credit_platform';
}

/** The compliance stages in credit_platform's current display order (DECISION_DESK_STAGE_ORDER). */
export const STAGE_CATALOG: ReadonlyArray<{ id: PipelineStageId; order: number; label: string }> = [
  { id: 'stop-factor-pre', order: 1, label: 'Pre Stop Factors' },
  { id: 'blacklist', order: 2, label: 'Black List Match' },
  { id: 'fmcsa', order: 3, label: 'FMCSA' },
  { id: 'plaid', order: 4, label: 'Plaid / Bank Statement' },
  { id: 'highway', order: 5, label: 'Highway' },
  { id: 'creditsafe', order: 6, label: 'CreditSafe' },
  { id: 'isoftpull', order: 7, label: 'iSoft Pull — Credit Score' },
  { id: 'antifraud', order: 8, label: 'AntiFraud' },
  { id: 'crosscheck', order: 9, label: 'CrossCheck' },
  { id: 'stop-factor-after', order: 10, label: 'Post Stop Factors' },
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

/** stage_flow status (pending|ready|running|ran|approved|failed|skipped) → UI status. */
export function normalizeStageFlowStatus(raw: string | null | undefined): PipelineStageStatus {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'approved') return 'done';
  if (s === 'failed') return 'failed';
  if (s === 'skipped') return 'skipped';
  if (s === 'running' || s === 'ran') return 'pending';
  return 'not_started';
}

/** `null` = no credit_platform request exists for the deal at all (never sent). `queued` = a request
 * exists but the pipeline/manual review hasn't started (QUEUED / SUBMITTED / RUNNING / …). */
export type VerificationState = 'queued' | 'in_progress' | 'approved' | 'rejected';

export function normalizeReviewState(
  status: string | null | undefined,
  manualReviewStatus: string | null | undefined,
  decision: string | null | undefined,
): VerificationState | null {
  const st = (status ?? '').trim().toUpperCase();
  const dec = (decision ?? '').trim().toUpperCase();
  if (st === 'COMPLETED' || dec === 'APPROVED') return 'approved';
  if (st === 'REJECTED' || dec === 'REJECTED') return 'rejected';
  const mrs = (manualReviewStatus ?? '').trim().toLowerCase();
  if (['pending', 'claimed', 'in_progress'].includes(mrs) || st === 'REVIEW') return 'in_progress';
  return 'queued';
}

/**
 * Zoho-only fallback when credit_platform has no request for the deal. Live `summary.state` always
 * wins on the roster. "Declined-Prepay/Secured Only" is a CREDIT product decision (no LOC) — it
 * still maps to `rejected` here so the "Rejected (prepay)" filter has a Zoho-side bucket when the
 * desk has not opened a request. It is NOT proof the verification desk closed the case.
 */
export function deriveZohoState(input: {
  creditDecision: string | null;
  applicationStatus: string | null;
  applicationId: string | null;
}): VerificationState | null {
  const cd = (input.creditDecision ?? '').trim().toLowerCase();
  if (cd) {
    if (cd.startsWith('approved')) return 'approved';
    if (cd.startsWith('declined') || cd.includes('reject')) return 'rejected';
  }
  if (input.applicationId || input.applicationStatus) return 'in_progress';
  return null;
}

/** Compact per-deal verification facts for a roster card (bulk-read; only-relevant, never raw reports/PII). */
export interface VerificationCardSummary {
  state: VerificationState | null;
  status: string;
  updatedAt: string | null;
  plaidLinkUrl: string | null;
  plaidStatus: string | null;
  approvedLimit: number | null;
  paymentType: string | null;
  billingCycle: string | null;
  missingFields: string[];
  docsUploaded: number;
  workingOn: string | null;
  requirementEventIds: string[];
}
