import { request, requestBlob, requestMultipart } from './transport';
import { deliverExport } from '../lib/deliverExport';

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

export type VerificationFirstRunStatus = 'idle' | 'in_flight' | 'completed' | 'error';

export type VerificationOwnerScope = 'unclaimed' | 'mine' | 'others';

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
  firstRunStatus?: VerificationFirstRunStatus;
  firstRunError?: string | null;
  cpOwnerUsername?: string | null;
  approvedLimit?: string | null;
  paymentType?: string | null;
  billingCycle?: string | null;
  plaidStatus?: string | null;
  plaidLinkUrl?: string | null;
  plaidMode?: string | null;
  slaStale?: boolean;
  slaIdleMinutes?: number;
  slaLabel?: string;
  createdAt: string;
}

export interface VerificationCaseAttachment {
  id: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  scope: string;
  createdAt: string | null;
}

export interface VerificationStageReadiness {
  ready: boolean;
  missing: string[];
  paid: boolean;
  alreadyPaid?: boolean;
  circuitOpen?: boolean;
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
  new?: number;
  approved?: number;
  rejected?: number;
  failed?: number;
  unclaimed?: number;
  mine?: number;
  stale?: number;
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
  attachments?: VerificationCaseAttachment[];
  readiness?: { requestId: string; stages: Record<string, VerificationStageReadiness> } | null;
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
      new: 0,
      approved: 0,
      rejected: 0,
      failed: 0,
      unclaimed: 0,
      mine: 0,
      stale: 0,
    },
    total: raw.total ?? 0,
  };
}

export async function listVerificationCases(input: {
  status?: VerificationCaseStatus | '';
  q?: string;
  unmatched?: boolean;
  owner?: VerificationOwnerScope | '';
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
} = {}): Promise<VerificationCaseListResult> {
  const data = await request('GET', '/verification/cases', {
    query: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q?.trim() ? { q: input.q.trim() } : {}),
      ...(input.unmatched ? { unmatched: '1' } : {}),
      ...(input.owner ? { owner: input.owner } : {}),
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
  opts: { bureauProvider?: string } = {},
): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/stages/${encodeURIComponent(stageId)}/run`,
    { body: opts.bureauProvider ? { bureauProvider: opts.bureauProvider } : {} },
  )) as VerificationCaseDetail;
}

export async function runVerificationIsoftpullAll(id: string): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/stages/isoftpull/run-all`,
  )) as VerificationCaseDetail;
}

export async function startVerificationFirstRun(id: string): Promise<unknown> {
  return request('POST', `/verification/cases/${encodeURIComponent(id)}/first-run`, { body: {} });
}

export async function claimVerificationCase(id: string): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/claim`,
    { body: {} },
  )) as VerificationCaseDetail;
}

export async function releaseVerificationCase(id: string): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/release`,
    { body: {} },
  )) as VerificationCaseDetail;
}

export async function generateVerificationPlaidLink(
  id: string,
  regenerate = false,
): Promise<{ status: string; inboxId: number }> {
  return (await request('POST', `/verification/cases/${encodeURIComponent(id)}/plaid-link`, {
    body: { regenerate },
  })) as { status: string; inboxId: number };
}

export async function parseVerificationBankStatements(
  id: string,
  attachmentIds?: number[],
): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/bank-statements/parse`,
    { body: attachmentIds?.length ? { attachmentIds } : {} },
  )) as VerificationCaseDetail;
}

export async function exportVerificationCases(input: {
  status?: VerificationCaseStatus | '';
  q?: string;
  unmatched?: boolean;
  owner?: VerificationOwnerScope | '';
}): Promise<void> {
  const blob = await requestBlob('/verification/cases/export', {
    timeoutMs: 60_000,
    query: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.q?.trim() ? { q: input.q.trim() } : {}),
      ...(input.unmatched ? { unmatched: '1' } : {}),
      ...(input.owner ? { owner: input.owner } : {}),
    },
  });
  await deliverExport(blob, `verification-cases-${new Date().toISOString().slice(0, 10)}.csv`);
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

export async function resetVerificationCaseStage(
  id: string,
  stageId: string,
): Promise<VerificationCaseDetail> {
  return (await request(
    'POST',
    `/verification/cases/${encodeURIComponent(id)}/stages/${encodeURIComponent(stageId)}/reset`,
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

export async function uploadVerificationCaseFiles(
  id: string,
  files: File[],
): Promise<{ status: string; uploaded: number; inboxIds: number[] }> {
  const form = new FormData();
  for (const file of files) form.append('files', file, file.name);
  return (await requestMultipart(
    `/verification/cases/${encodeURIComponent(id)}/attachments`,
    form,
  )) as { status: string; uploaded: number; inboxIds: number[] };
}

export async function downloadVerificationCaseAttachment(
  caseId: string,
  attachmentId: string,
  fileName: string,
): Promise<void> {
  const blob = await requestBlob(
    `/verification/cases/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
  );
  await deliverExport(blob, fileName || `attachment-${attachmentId}`);
}
