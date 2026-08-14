import { verificationDb } from '../../integrations/verificationDb.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { VerificationCaseStatus } from '../../db/schema/verification_cases.js';
import { verificationCaseRepo } from '../../repos/verificationCaseRepo.js';
import { verificationCaseStageRepo } from '../../repos/verificationCaseStageRepo.js';
import {
  asDate,
  extractOfferFields,
  extractPlaidMode,
  hostedPlaidLink,
} from './verificationCaseDesk.js';
import {
  DECISION_DESK_STAGES,
  normalizeDeskStageId,
  normalizeDeskStageStatus,
} from './verificationStages.js';

interface RequestRow {
  request_id: string;
  status: string | null;
  result: Record<string, unknown> | null;
  updated_at: Date | string | null;
  manual_review_owner_username: string | null;
  plaid_status?: string | null;
  plaid_link_url?: string | null;
  manual_review_claimed_at?: Date | string | null;
  manual_review_updated_at?: Date | string | null;
}

export interface CaseSyncResult {
  bound: boolean;
  requestId: string | null;
  ownerUsername: string | null;
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function txt(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

export function mapRequestStatus(raw: string | null | undefined): VerificationCaseStatus {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === 'REJECTED') return 'rejected';
  if (s === 'FAILED' || s === 'ENGINE_ERROR' || s === 'ENGINE_UNREACHABLE' || s === 'CANCELLED') {
    return 'failed';
  }
  if (s === 'COMPLETED') return 'approved';
  if (s === 'REVIEW') return 'awaiting_decision';
  if (
    s === 'RUNNING' ||
    s === 'ENGINE_SUBMITTING' ||
    s === 'QUEUED' ||
    s === 'PLAID_PENDING' ||
    s === 'PERSISTED'
  ) {
    return 'in_progress';
  }
  return 'new';
}

function stageFlow(result: Record<string, unknown>): Record<string, unknown> {
  const manual = rec(result.manual_review);
  return rec(manual.stage_flow);
}

function mergeStepResult(
  blob: Record<string, unknown>,
  step: Record<string, unknown>,
): Record<string, unknown> {
  const stepStatus = txt(step.status) || txt(blob.step_status);
  const noHit =
    step.no_hit === true ||
    blob.no_hit === true ||
    stepStatus.toUpperCase() === 'NOT_FOUND';
  return {
    ...blob,
    ...(stepStatus ? { step_status: stepStatus } : {}),
    ...(noHit ? { no_hit: true } : {}),
  };
}

export async function syncCaseFromVerificationDb(
  ctx: TenantContext,
  caseId: string,
  requestId: string,
): Promise<CaseSyncResult> {
  if (!verificationDb.isConfigured()) {
    return { bound: false, requestId: null, ownerUsername: null };
  }
  const rows = await verificationDb.query<RequestRow>(
    `select request_id, status, result, updated_at, manual_review_owner_username,
            plaid_status, plaid_link_url, manual_review_claimed_at, manual_review_updated_at
       from requests
      where request_id = $1
         or payload->>'zoho_lead_id' = $1
         or payload->'zoho_raw'->>'id' = $1
      order by updated_at desc nulls last
      limit 1`,
    [requestId],
  );
  const row = rows[0];
  if (!row) return { bound: false, requestId: null, ownerUsername: null };

  const result = rec(row.result);
  const flow = stageFlow(result);
  const stagesBlob = rec(flow.stages);
  const stepResults = rec(result.step_results);
  const currentRaw = txt(flow.current_stage);
  const currentStage = normalizeDeskStageId(currentRaw) ?? (currentRaw || null);
  const ownerUsername =
    txt(row.manual_review_owner_username) ||
    txt(rec(result.manual_review).owner_username) ||
    null;

  const upserts = DECISION_DESK_STAGES.map((stage) => {
    const blob = rec(stagesBlob[stage.id] ?? stagesBlob[stage.id.replace(/_/g, '-')]);
    const step = rec(stepResults[stage.id] ?? stepResults[stage.id.replace(/_/g, '-')]);
    const merged = mergeStepResult(blob, step);
    const status = normalizeDeskStageStatus(txt(merged.status) || undefined);
    return {
      stageId: stage.id,
      status,
      result: merged,
      error: txt(merged.error) || null,
      ranAt: merged.ran_at || merged.ranAt ? new Date(String(merged.ran_at ?? merged.ranAt)) : null,
      approvedAt:
        merged.approved_at || merged.approvedAt
          ? new Date(String(merged.approved_at ?? merged.approvedAt))
          : null,
      approvedBy: txt(merged.approved_by || merged.approvedBy) || null,
    };
  });
  await verificationCaseStageRepo.upsertMany(ctx, caseId, upserts);

  const done = upserts.filter((s) => s.status === 'approved' || s.status === 'skipped').length;
  const decision = txt(rec(result).decision) || txt(rec(rec(result).summary).decision);
  const offer = extractOfferFields(result);
  const manual = rec(result.manual_review);
  await verificationCaseRepo.update(ctx, caseId, {
    requestId: row.request_id,
    status: mapRequestStatus(row.status),
    currentStage,
    stagesDone: done,
    stagesTotal: DECISION_DESK_STAGES.length,
    lastDecision: decision || null,
    lastSyncedAt: new Date(),
    cpOwnerUsername: ownerUsername,
    approvedLimit: offer.approvedLimit,
    paymentType: offer.paymentType,
    billingCycle: offer.billingCycle,
    plaidStatus: txt(row.plaid_status) || null,
    plaidLinkUrl: hostedPlaidLink(row.plaid_link_url),
    plaidMode: extractPlaidMode(result),
    cpClaimedAt: asDate(row.manual_review_claimed_at ?? manual.claimed_at),
    cpReviewUpdatedAt: asDate(row.manual_review_updated_at ?? manual.updated_at ?? row.updated_at),
  });
  return { bound: true, requestId: row.request_id, ownerUsername };
}
