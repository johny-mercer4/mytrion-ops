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
import { request, requestBlob, requestMultipart } from './transport';

const V_HEADERS = { 'x-department-access': 'sales' } as const;

export type VerificationClientStage = 'in_pipeline' | 'active' | 'closed';

export interface VerificationClient {
  dealId: string | null;
  carrierId: string | null;
  companyName: string;
  /** `Deal_Name` verbatim — searchable even when companyName resolves to Account_Name. */
  dealName: string;
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
  billingCycle: string | null;
  /** `Payment_Type_Billing`: Line of Credit / Prepay / Deposit / Secured Line of Credit. */
  paymentTerms: string | null;
  companyVerification: string | null;
  billingVerification: string | null;
  lovesVerification: string | null;
  verified: boolean;
  limitsAdded: boolean;
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
  verificationState: 'queued' | 'in_progress' | 'approved' | 'rejected' | null;
  plaidLinkUrl: string | null;
  plaidStatus: string | null;
  cpLimit: number | null;
  cpPaymentType: string | null;
  cpBillingCycle: string | null;
  missingFields: string[];
  docsUploaded: number;
  workingOn: string | null;
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
  used?: boolean;
  stoppedBy?: string;
  related?: Array<{ label: string; value: string }>;
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
/** Current applicant values for prefilling the Sales edit form (live provider only). */
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
  applicant?: PipelineApplicant;
  plaid?: PipelinePlaid;
  source: 'mock' | 'credit_platform';
}

/** One server-paginated pipeline roster page, newest applications first. */
export type VerificationStateFilter = 'all' | 'in_progress' | 'approved' | 'rejected';

export async function getVerificationClients(input: {
  zohoUserId?: string;
  page?: number;
  pageSize?: number;
  query?: string;
  state?: VerificationStateFilter;
} = {}): Promise<VerificationClientPage> {
  const query: Record<string, string | number> = {
    page: input.page ?? 1,
    page_size: input.pageSize ?? 9,
  };
  if (input.zohoUserId) query.zoho_user_id = input.zohoUserId;
  if (input.query?.trim()) query.q = input.query.trim();
  if (input.state && input.state !== 'all') query.state = input.state;
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

/**
 * Queue an applicant-field edit for the credit-platform consumer (owner-scoped server-side). `changes`
 * carries only the fields the agent filled — the server drops empties and applies the rest to the case.
 */
export async function editApplicant(input: {
  requestId: string;
  dealId: string;
  changes: Record<string, string>;
}): Promise<{ status: string; inboxId: number; fields: string[] }> {
  return (await request('POST', '/verification/applicant', {
    body: { requestId: input.requestId, dealId: input.dealId, changes: input.changes },
    headers: V_HEADERS,
  })) as { status: string; inboxId: number; fields: string[] };
}

/**
 * Upload one or more bank statements for the Plaid stage (owner-scoped server-side). The files are
 * ATTACHED to the case for Verification to review — the agent's action never triggers the Plaid parse.
 */
export async function uploadBankStatements(input: {
  requestId: string;
  dealId: string;
  files: File[];
}): Promise<{ status: string; uploaded: number; inboxIds: number[] }> {
  const form = new FormData();
  form.set('requestId', input.requestId);
  form.set('dealId', input.dealId);
  for (const file of input.files) form.append('files', file, file.name);
  return (await requestMultipart('/verification/bank-statements', form, {
    headers: V_HEADERS,
  })) as { status: string; uploaded: number; inboxIds: number[] };
}

export async function generatePlaidLink(input: {
  requestId: string;
  dealId: string;
  regenerate?: boolean;
}): Promise<{ status: string; inboxId: number }> {
  return (await request('POST', '/verification/plaid-link', {
    body: { requestId: input.requestId, dealId: input.dealId, ...(input.regenerate ? { regenerate: true } : {}) },
    headers: V_HEADERS,
  })) as { status: string; inboxId: number };
}

export async function downloadVerificationAttachment(id: string, fileName: string): Promise<void> {
  const blob = await requestBlob(`/verification/attachments/${id}/download`, { headers: V_HEADERS });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName || `attachment-${id}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
