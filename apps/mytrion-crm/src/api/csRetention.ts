/**
 * Customer Service Retention touchpoints — Phase 2 desk, CITI Folder, Open Pool (read-only).
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
  poolList: (limit = 200) => csTp('retention.cs_pool_list', { limit }),
  cases: (
    opts:
      | TouchpointMap['retention.cs_cases']['params']['filter']
      | {
          phase?: TouchpointMap['retention.cs_cases']['params']['phase'];
          status?: TouchpointMap['retention.cs_cases']['params']['status'];
          filter?: TouchpointMap['retention.cs_cases']['params']['filter'];
          limit?: number;
        } = {},
    limit = 200,
  ) => {
    if (typeof opts === 'string') {
      return csTp('retention.cs_cases', { filter: opts, limit });
    }
    const lim = opts.limit ?? limit;
    return csTp('retention.cs_cases', {
      ...(opts.phase ? { phase: opts.phase } : {}),
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.filter ? { filter: opts.filter } : {}),
      limit: lim,
    });
  },
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
