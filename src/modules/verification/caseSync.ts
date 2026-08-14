import { verificationDb } from '../../integrations/verificationDb.js';
import type { TenantContext } from '../../types/tenantContext.js';
import type { VerificationCaseStatus } from '../../db/schema/verification_cases.js';
import { verificationCaseRepo } from '../../repos/verificationCaseRepo.js';
import { verificationCaseStageRepo } from '../../repos/verificationCaseStageRepo.js';
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

export async function syncCaseFromVerificationDb(
  ctx: TenantContext,
  caseId: string,
  requestId: string,
): Promise<void> {
  if (!verificationDb.isConfigured()) return;
  const rows = await verificationDb.query<RequestRow>(
    `select request_id, status, result, updated_at
       from requests
      where request_id = $1
         or payload->>'zoho_lead_id' = $1
         or payload->'zoho_raw'->>'id' = $1
      order by updated_at desc nulls last
      limit 1`,
    [requestId],
  );
  const row = rows[0];
  if (!row) return;

  const result = rec(row.result);
  const flow = stageFlow(result);
  const stagesBlob = rec(flow.stages);
  const currentRaw = txt(flow.current_stage);
  const currentStage = normalizeDeskStageId(currentRaw) ?? (currentRaw || null);

  const upserts = DECISION_DESK_STAGES.map((stage) => {
    const blob = rec(stagesBlob[stage.id] ?? stagesBlob[stage.id.replace(/_/g, '-')]);
    const status = normalizeDeskStageStatus(txt(blob.status) || undefined);
    return {
      stageId: stage.id,
      status,
      result: blob,
      error: txt(blob.error) || null,
      ranAt: blob.ran_at || blob.ranAt ? new Date(String(blob.ran_at ?? blob.ranAt)) : null,
      approvedAt:
        blob.approved_at || blob.approvedAt ? new Date(String(blob.approved_at ?? blob.approvedAt)) : null,
      approvedBy: txt(blob.approved_by || blob.approvedBy) || null,
    };
  });
  await verificationCaseStageRepo.upsertMany(ctx, caseId, upserts);

  const done = upserts.filter((s) => s.status === 'approved' || s.status === 'skipped').length;
  const decision = txt(rec(result).decision) || txt(rec(rec(result).summary).decision);
  await verificationCaseRepo.update(ctx, caseId, {
    requestId: row.request_id,
    status: mapRequestStatus(row.status),
    currentStage,
    stagesDone: done,
    stagesTotal: DECISION_DESK_STAGES.length,
    lastDecision: decision || null,
    lastSyncedAt: new Date(),
  });
}
