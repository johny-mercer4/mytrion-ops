/** Sales Call Hub — agent call history (Mytrion + Zoho + optional Gong). */
import { request } from './transport';

export type CallHubSource = 'mytrion' | 'zoho' | 'gong';
export type CallHubStatus = 'answered' | 'missed' | 'unknown';

export interface CallHubLinked {
  type: 'lead' | 'deal' | 'retention_case';
  id: string;
  label?: string;
}

export interface CallHubItem {
  id: string;
  source: CallHubSource;
  direction: string;
  status: CallHubStatus;
  phone: string;
  startedAt: string;
  durationSeconds: number | null;
  result: string;
  subject: string | null;
  linked: CallHubLinked | null;
}

export interface CallHubListFilter {
  from?: string;
  to?: string;
  source?: CallHubSource | 'all';
  status?: CallHubStatus | 'all';
  page?: number;
  pageSize?: number;
}

export interface CallHubListResult {
  calls: CallHubItem[];
  page: number;
  pageSize: number;
  total: number;
  agentZohoUserId: string;
}

export async function listCallHubCalls(filter: CallHubListFilter = {}): Promise<CallHubListResult> {
  return (await request('GET', '/sales/call-hub/calls', {
    query: {
      ...(filter.from ? { from: filter.from } : {}),
      ...(filter.to ? { to: filter.to } : {}),
      ...(filter.source && filter.source !== 'all' ? { source: filter.source } : {}),
      ...(filter.status && filter.status !== 'all' ? { status: filter.status } : {}),
      ...(filter.page !== undefined ? { page: filter.page } : {}),
      ...(filter.pageSize !== undefined ? { page_size: filter.pageSize } : {}),
    },
  })) as CallHubListResult;
}
