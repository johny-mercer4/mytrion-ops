import { request } from './transport';

export type VerificationCaseStatus =
  | 'new'
  | 'in_progress'
  | 'awaiting_decision'
  | 'approved'
  | 'rejected'
  | 'failed';

export type VerificationStageStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'ran'
  | 'approved'
  | 'skipped'
  | 'failed';

export interface VerificationCaseRow {
  id: string;
  zohoDealId: string;
  zohoApplicationId: string | null;
  requestId: string | null;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  dot: string | null;
  mc: string | null;
  zohoStage: string | null;
  applicationStatus: string | null;
  applicationDate: string | null;
  creditScore: string | null;
  distributeType: 'personal' | 'shared';
  ownerZohoUserId: string;
  ownerName: string;
  matchedSnapshotId: string | null;
  matchedVia: string | null;
  carrierOperatingStatus: string | null;
  status: VerificationCaseStatus;
  currentStage: string | null;
  stagesDone: number;
  stagesTotal: number;
  lastDecision: string | null;
  createdAt: string;
}

export interface VerificationCaseStageRow {
  id: string;
  stageId: string;
  status: VerificationStageStatus;
  result: Record<string, unknown>;
  error: string | null;
  ranAt: string | null;
  approvedAt: string | null;
}

export interface VerificationCaseCatalogItem {
  id: string;
  label: string;
  order: number;
}

export interface VerificationCaseAggregates {
  open: number;
  shared: number;
  inProgress: number;
  awaitingDecision: number;
  unmatched: number;
  total: number;
}

export interface VerificationCaseListResult {
  items: VerificationCaseRow[];
  aggregates: VerificationCaseAggregates;
  total: number;
}

export interface VerificationCaseDetail {
  case: VerificationCaseRow;
  stages: VerificationCaseStageRow[];
  catalog: VerificationCaseCatalogItem[];
}

function asList(data: unknown): VerificationCaseListResult {
  const raw = data as Partial<VerificationCaseListResult>;
  return {
    items: (raw.items ?? []) as VerificationCaseRow[],
    aggregates: raw.aggregates ?? {
      open: 0,
      shared: 0,
      inProgress: 0,
      awaitingDecision: 0,
      unmatched: 0,
      total: 0,
    },
    total: raw.total ?? 0,
  };
}

export async function listVerificationCases(input: {
  status?: VerificationCaseStatus | '';
  q?: string;
  unmatched?: boolean;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<VerificationCaseListResult> {
  const data = await request('GET', '/verification/cases', {
    query: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q?.trim() ? { q: input.q.trim() } : {}),
      ...(input.unmatched ? { unmatched: '1' } : {}),
      limit: input.limit ?? 50,
      offset: input.offset ?? 0,
    },
    ...(input.signal ? { signal: input.signal } : {}),
  });
  return asList(data);
}

export async function getVerificationCase(
  id: string,
  signal?: AbortSignal,
): Promise<VerificationCaseDetail> {
  return (await request('GET', `/verification/cases/${encodeURIComponent(id)}`, {
    ...(signal ? { signal } : {}),
  })) as VerificationCaseDetail;
}

export async function refreshVerificationCase(id: string): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/refresh`,
  )) as VerificationCaseDetail;
}

export async function runVerificationCaseStage(
  id: string,
  stageId: string,
): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/stages/${encodeURIComponent(stageId)}/run`,
  )) as VerificationCaseDetail;
}

export async function approveVerificationCaseStage(
  id: string,
  stageId: string,
  note?: string,
): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/stages/${encodeURIComponent(stageId)}/approve`,
    { body: note ? { note } : {} },
  )) as VerificationCaseDetail;
}

export async function decideVerificationCase(
  id: string,
  decision: 'APPROVED' | 'REJECTED' | 'REVIEW',
  reason?: string,
): Promise<VerificationCaseDetail> {
  return (await request('POST', `/verification/cases/${encodeURIComponent(id)}/decision`, {
    body: { decision, ...(reason ? { reason } : {}) },
  })) as VerificationCaseDetail;
}
