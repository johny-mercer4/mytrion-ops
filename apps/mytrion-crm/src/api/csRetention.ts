/**
 * Customer Service Retention touchpoints — Open Pool claims, Phase 2 desk, CITI Folder.
 * Pins departmentAccess to customer-service (mirrors api/cs.ts).
 */
import { callTouchpoint } from './touchpoints';
import type { TouchpointMap } from './touchpointTypes';

const CS = ['customer-service'] as const;

function csTp<K extends keyof TouchpointMap>(
  key: K,
  params: TouchpointMap[K]['params'],
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: [...CS] });
}

export const csRetention = {
  claimsPending: (limit = 100) => csTp('retention.cs_claims_pending', { limit }),
  claimsBadge: () => csTp('retention.cs_claims_badge', {}),
  approveClaim: (caseId: string) => csTp('retention.cs_claim_approve', { caseId }),
  declineClaim: (caseId: string) => csTp('retention.cs_claim_decline', { caseId }),
  cases: (filter?: 'new' | 'working' | 'closed' | 'all_open', limit = 200) =>
    csTp('retention.cs_cases', { ...(filter ? { filter } : {}), limit }),
  deskQuota: () => csTp('retention.cs_desk_quota', {}),
  caseGet: (caseId: string) => csTp('retention.cs_case_get', { caseId }),
  caseOutcome: (
    caseId: string,
    outcome: TouchpointMap['retention.cs_case_outcome']['params']['outcome'],
    notes?: string,
  ) => csTp('retention.cs_case_outcome', { caseId, outcome, ...(notes ? { notes } : {}) }),
  logAttempt: (
    caseId: string,
    channel: TouchpointMap['retention.cs_log_attempt']['params']['channel'],
    notes?: string,
    callRole?: 'listen' | 'solution',
  ) =>
    csTp('retention.cs_log_attempt', {
      caseId,
      channel,
      ...(notes ? { notes } : {}),
      ...(callRole ? { call_role: callRole } : {}),
    }),
  citiList: (limit = 200) => csTp('retention.cs_citi_list', { limit }),
  citiConfirm: (caseIds: string[]) => csTp('retention.cs_citi_confirm', { caseIds }),
  citiExport: (caseIds: string[]) => csTp('retention.cs_citi_export', { caseIds }),
  citiMarkSent: (caseIds: string[]) => csTp('retention.cs_citi_mark_sent', { caseIds }),
};
