/**
 * Sales Verification Pipeline (GET /v1/verification/*) — the agent's applications, read from Zoho
 * CRM Deals (freshest application date first) + a per-client compliance-pipeline snapshot.
 * Owner-scoped server-side; admins pass ?zoho_user_id (View-as). Pipeline data comes from live
 * Verification when configured, with a deterministic development fallback.
 *
 * These fields mirror Zoho `Deals` API names one-for-one — see
 * `src/integrations/salesVerificationDeals.ts` for the field list and its two traps (`DOT1`, and
 * `Verification_Decision` being a FILE, not a decision value).
 */
import { request, requestMultipart } from './transport';

const V_HEADERS = { 'x-department-access': 'sales' } as const;

export type VerificationClientStage = 'in_pipeline' | 'active' | 'closed';

export interface VerificationClient {
  dealId: string | null;
  carrierId: string | null;
  companyName: string;
  /** `Application_Date` — may be null even on a filled application. */
  appFillDate: string | null;
  /** `Stage` — the deal's position in the sales pipeline. */
  dealStage: string;
  /** `Application_Stage` — where the application sits (Adjudication, Implementation, …). */
  applicationStage: string | null;
  /** `Application_Status` — the WEX-side status (Pending Decision, Decisioned, …). */
  applicationStatus: string | null;
  stageUpdatedAt: string | null;
  classification: VerificationClientStage;
  // ---- credit decision ----
  /** `Credit_Decision` ("Approved-Requested", "Declined-Prepay/Secured Only", …). */
  creditDecision: string | null;
  /** `Credit_Score`. Null when unscored — the CRM 0-fills undecided applications. */
  creditScore: number | null;
  creditLimit: number | null;
  creditLineApproved: number | null;
  /** `Risk_Score`: High / Medium / Low. */
  riskScore: string | null;
  /** `CreditSafe_Grade`: A–E. */
  creditSafeGrade: string | null;
  moneyCodeLimit: number | null;
  // ---- billing terms ----
  billingCycle: string | null;
  /** `Payment_Type_Billing`: Line of Credit / Prepay / Deposit / Secured Line of Credit. */
  paymentTerms: string | null;
  // ---- verification checkpoints ----
  companyVerification: string | null;
  billingVerification: string | null;
  lovesVerification: string | null;
  verified: boolean;
  limitsAdded: boolean;
  // ---- narrative + identity ----
  rejectReason: string | null;
  verificationNotes: string | null;
  cardsRequested: number | null;
  applicationId: string | null;
  dot: string | null;
  mc: string | null;
  agentName: string;
  modifiedAt: string | null;
  attentionCount: number;
  verificationStatus: string | null;
  verificationUpdatedAt: string | null;
}

export interface VerificationClientPage {
  clients: VerificationClient[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    pageCount: number;
    /** The owner's history exceeded the COQL drain cap, so `total` is a floor. */
    truncated?: boolean;
  };
  sourceHealth?: {
    crm: 'ok' | 'degraded';
    verification: 'ok' | 'degraded';
    responses: 'ok' | 'degraded';
  };
  partial?: boolean;
  freshness?: 'fresh' | 'stale';
  generatedAt?: string;
  staleReason?: string;
}

export type PipelineStageStatus = 'done' | 'failed' | 'skipped' | 'pending' | 'not_started';
export interface PipelineStage {
  id: string;
  order: number;
  label: string;
  status: PipelineStageStatus;
  detail?: string;
}
export type PipelineOutcome = 'prepaid' | 'loc' | 'rejected' | 'undecided';
export interface PipelineDecision {
  outcome: PipelineOutcome;
  creditScore?: number;
  approvedLimit?: number;
  billingCycle?: string;
  reason?: string;
}
export type PipelineRequirementFieldType = 'text' | 'number' | 'email' | 'date' | 'textarea' | 'select';
export interface PipelineRequirementField {
  id: string;
  label: string;
  type: PipelineRequirementFieldType;
  required: boolean;
  placeholder?: string;
  options?: string[];
}
export interface PipelineRequirementResponse {
  sentAt: string;
  sentBy: string;
  attachmentName: string | null;
  warning: string | null;
}
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
export interface PipelineSnapshot {
  requestId: string;
  status: string;
  updatedAt: string | null;
  stages: PipelineStage[];
  decision: PipelineDecision;
  requirements: PipelineRequirement[];
  events: PipelineTimelineEvent[];
  attachments: PipelineAttachment[];
  source: 'mock' | 'credit_platform';
}

/** One server-paginated pipeline roster page, newest applications first. */
export async function getVerificationClients(input: {
  zohoUserId?: string;
  page?: number;
  pageSize?: number;
  query?: string;
} = {}): Promise<VerificationClientPage> {
  const query: Record<string, string | number> = {
    page: input.page ?? 1,
    page_size: input.pageSize ?? 9,
  };
  if (input.zohoUserId) query.zoho_user_id = input.zohoUserId;
  if (input.query?.trim()) query.q = input.query.trim();
  const res = (await request('GET', '/verification/clients', {
    query,
    headers: V_HEADERS,
  })) as Partial<VerificationClientPage>;
  const clients = res.clients ?? [];
  return {
    clients,
    pagination: res.pagination ?? {
      page: input.page ?? 1,
      pageSize: input.pageSize ?? 9,
      total: clients.length,
      pageCount: 1,
    },
    ...(res.sourceHealth ? { sourceHealth: res.sourceHealth } : {}),
    ...(res.partial != null ? { partial: res.partial } : {}),
    ...(res.freshness ? { freshness: res.freshness } : {}),
    ...(res.generatedAt ? { generatedAt: res.generatedAt } : {}),
    ...(res.staleReason ? { staleReason: res.staleReason } : {}),
  };
}

/** One client's 9-stage pipeline + decision. Pass the identity keys the deal carries. */
export async function getPipeline(keys: {
  dealId?: string | null;
  carrierId?: string | null;
  applicationId?: string | null;
  dot?: string | null;
}): Promise<PipelineSnapshot | null> {
  const query: Record<string, string> = {};
  if (keys.dealId) query.dealId = keys.dealId;
  if (keys.carrierId) query.carrierId = keys.carrierId;
  if (keys.applicationId) query.applicationId = keys.applicationId;
  if (keys.dot) query.dot = keys.dot;
  const res = (await request('GET', '/verification/pipeline', {
    query,
    headers: V_HEADERS,
  })) as { snapshot?: PipelineSnapshot | null };
  return res.snapshot ?? null;
}

export async function sendVerificationResponse(input: {
  requestId: string;
  dealId: string;
  externalEventId: string;
  values: Record<string, string>;
  note?: string;
  file?: File | null;
}): Promise<{ response: PipelineRequirementResponse; duplicate: boolean }> {
  const form = new FormData();
  form.set('requestId', input.requestId);
  form.set('dealId', input.dealId);
  form.set('externalEventId', input.externalEventId);
  form.set('values', JSON.stringify(input.values));
  if (input.note?.trim()) form.set('note', input.note.trim());
  if (input.file) form.set('file', input.file, input.file.name);
  return (await requestMultipart('/verification/responses', form, {
    headers: {
      ...V_HEADERS,
      'idempotency-key': `verification:${input.requestId}:${input.externalEventId}`,
    },
  })) as {
    response: PipelineRequirementResponse;
    duplicate: boolean;
  };
}
