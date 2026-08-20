/**
 * The new-era verification flow — ONE typed client for both desks.
 *
 * Sales calls `/verification/applications*` (intake); Verification calls `/verification/flow/*`
 * (underwriting). They address the same rows, so the DTOs live together: if the shape drifts, it
 * drifts for both at once rather than silently for one.
 */
import { request, requestBlob, requestMultipart } from './transport';
import { openSignedFile } from '../lib/openSignedFile';
import { deliverExport } from '../lib/deliverExport';
import { isTelegramWebView } from '../telegram/webApp';

export type VerificationApplicantType = 'owner_operator' | 'carrier' | 'company';
export type VerificationRoute = 'octane_internal' | 'wex';
export type VerificationBankingSource = 'statements' | 'plaid';
export type VerificationRiskTier = 'strong' | 'moderate' | 'weak';
export type VerificationReviewOrder = 'banking_first' | 'credit_first';

export type VerificationPhaseStatus =
  | 'not_started'
  | 'in_progress'
  | 'passed'
  | 'pending_docs'
  | 'manager_review'
  | 'failed'
  | 'skipped';

export type VerificationPhaseOutcome =
  | 'pass'
  | 'pending_docs'
  | 'manager_review'
  | 'additional_verification'
  | 'decline'
  | 'decline_blacklist'
  | 'deposit_prepaid'
  | 'skip';

export type VerificationDocType =
  | 'drivers_license'
  | 'ssn_card'
  | 'bank_statement'
  | 'lease_agreement'
  | 'corporate_guarantee'
  | 'insurance'
  | 'authority'
  | 'other';

export type VerificationDocStatus = 'requested' | 'received' | 'rejected';
export type VerificationScreeningVerdict = 'unverified' | 'confirmed' | 'false_match';

export type VerificationFinalDecision =
  | 'approve'
  | 'deposit_prepaid'
  | 'manager_review'
  | 'pending_docs'
  | 'declined_customer'
  | 'decline'
  | 'decline_blacklist';

export interface VerificationCaseRow {
  id: string;
  companyName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  applicantType: VerificationApplicantType | null;
  /** Projected by the list endpoint so the queue's EIN / MC / USDOT search can actually match. */
  ein: string | null;
  mc: string | null;
  dot: string | null;
  underwritingRoute: VerificationRoute | null;
  /** THE GATE. false = red, Sales still owes intake. */
  verificationProcess: boolean;
  phaseCode: string;
  statusCode: string;
  statusLabel?: string;
  boardColumn?: string | null;
  trucksCount: number | null;
  fuelCardsRequested: number | null;
  requestedLimit: string | null;
  approvedLimitAmount: string | null;
  intakeMissing: string[];
  submittedAt: string | null;
  /**
   * The row's ASSIGNEE — NOT the Sales agent, despite the name.
   *
   * `createApplicationFromDeal` falls back to the Verification case owner
   * (`VERIFICATION_CASE_OWNER_NAME`, a credit agent) when a Deal arrives with no owner in Zoho, so on
   * those rows this names somebody who has never worked in Sales. Use `salesOwnerName` for anything a
   * person reads as "the Sales agent"; this pair exists for the Sales list's ownership scoping.
   */
  ownerName: string;
  ownerZohoUserId: string | null;
  /** The DEAL's owner — this is the Sales agent. Null when Zoho has nobody on the Deal. */
  zohoOwnerId: string | null;
  zohoOwnerName: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VerificationPrincipal {
  id: string;
  fullName: string;
  role: string | null;
  ownershipPct: string | null;
  dateOfBirth: string | null;
  ssnLast4: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
}

export interface VerificationDocument {
  id: string;
  docType: VerificationDocType;
  label: string | null;
  status: VerificationDocStatus;
  requestedInPhase: string | null;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  uploadedByName: string | null;
  requestedAt: string | null;
  createdAt: string;
}

export interface VerificationMissingItem {
  field: string;
  label: string;
  section: 'applicant' | 'identity' | 'business' | 'contact' | 'request' | 'banking' | 'principals';
}

export interface ApplicationDetail {
  case: VerificationCaseRow & Record<string, unknown>;
  principals: VerificationPrincipal[];
  documents: VerificationDocument[];
  intake: { complete: boolean; missing: VerificationMissingItem[] };
  /** The desk's ten-phase rail, read-only for Sales. Same rows the Verification workspace shows. */
  phases: VerificationRailPhase[];
  underwritingRoute: VerificationRoute;
  reviewOrder: VerificationReviewOrder;
}

export interface VerificationRailPhase {
  code: string;
  label: string;
  order: number;
  description: string;
  applies: boolean;
  skipReason: string | null;
  status: VerificationPhaseStatus;
  outcome: VerificationPhaseOutcome | null;
  findings: Record<string, unknown>;
  note: string | null;
  decidedAt: string | null;
  decidedBy: string | null;
}

export interface VerificationScreeningHit {
  id: string;
  checkType: 'blacklist' | 'duplicate';
  entryType: string;
  matchedValueDisplay: string | null;
  matchedCaseLabel: string | null;
  /**
   * WHICH LIST OR POPULATION the hit came from, carried as a prefix rather than a separate column.
   *
   * `cp:<id>` is a credit-platform ban-list row, `deal:<zoho id>` is a Zoho Deal, and anything else is
   * one of this desk's own blacklist entries. The pane splits Check B's two populations on this — a
   * duplicate CASE is a live application here, a duplicate DEAL may be a closed one from last
   * quarter, and the reviewer needs to tell them apart.
   */
  matchedEntryId: string | null;
  verdict: VerificationScreeningVerdict;
  note: string | null;
}

export interface VerificationCaseEvent {
  id: string;
  fromPhase: string | null;
  toPhase: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  eventType: string;
  actorName: string | null;
  notes: string | null;
  occurredAt: string;
}

export interface VerificationCreditReview {
  creditScore: number | null;
  latePayments: number | null;
  collections: number | null;
  utilizationPct: string | null;
  inquiries12m: number | null;
  historyMonths: number | null;
  openAccounts: number | null;
  totalDebt: string | null;
  revolvingAccounts: number | null;
  autoLoans: number | null;
  mortgages: number | null;
  repaymentBehavior: string | null;
  recentTrend: string | null;
  bureauNoHit: boolean;
  outcome: string | null;
  note: string | null;
}

export interface VerificationBankingReview {
  periodStart: string | null;
  periodEnd: string | null;
  accountOwnershipVerified: boolean;
  monthlyRevenue: string | null;
  weeklyRevenue: string | null;
  revenueTrend: string | null;
  recurringWeeklyIncome: string | null;
  recurringWeeklyExpenses: string | null;
  /** Server-derived — the form shows it, it never sends it. */
  avgWeeklyNetCashFlow: string | null;
  avgDailyBalance: string | null;
  endingBalance: string | null;
  minimumBalance: string | null;
  negativeBalanceDays: number | null;
  nsfCount: number | null;
  achReturnCount: number | null;
  overdraftCount: number | null;
  avgWeeklyFuelExpense: string | null;
  existingDebtPayments: string | null;
  oneTimeDeposits: string | null;
  unusualTransactions: string | null;
  cashFlowVolatility: string | null;
  bankingInconsistentWithOperations: boolean;
  note: string | null;
}

export interface VerificationRiskAssessment {
  riskTier: VerificationRiskTier | null;
  businessAgeMonths: number | null;
  authorityAgeMonths: number | null;
  avgWeeklyNetCashFlow: string | null;
  avgWeeklyFuelExpense: string | null;
  adjustedWeeklyCapacity: string | null;
  riskFactor: string | null;
  recommendedLimit: string | null;
  requestedLimit: string | null;
  analystRecommendation: string | null;
  keyRisks: string[];
  computedAt: string | null;
}

export interface VerificationDeskDetail {
  case: VerificationCaseRow & Record<string, unknown>;
  rail: VerificationRailPhase[];
  principals: VerificationPrincipal[];
  documents: VerificationDocument[];
  events: VerificationCaseEvent[];
  screening: {
    hits: VerificationScreeningHit[];
    summary: {
      blacklistConfirmed: boolean;
      duplicateConfirmed: boolean;
      unresolved: number;
      clear: boolean;
    };
  };
  credit: VerificationCreditReview | null;
  banking: VerificationBankingReview | null;
  risk: VerificationRiskAssessment | null;
  hardStops: {
    passed: boolean;
    triggered: Array<{ code: string; label: string; detail: string }>;
    outcome: string;
  };
  indicators: string[];
  routing: {
    underwritingRoute: VerificationRoute;
    reviewOrder: VerificationReviewOrder;
    bankFirstTruckMin: number;
    wexCardCutoff: number;
  };
  policy: {
    strongFactor: number | null;
    moderateFactor: number | null;
    weakFactor: number | null;
    tierPriceable: { strong: boolean; moderate: boolean; weak: boolean };
  };
}

export interface VerificationDeskAggregates {
  total: number;
  awaitingSales: number;
  workable: number;
  pendingDocs: number;
  managerReview: number;
  closed: number;
}

/** Defensive: a route that 500s mid-serialisation must not crash a `.map()`. */
function asList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Query values the transport accepts. Booleans become 'true'/'false' strings, which is what the
 * route's zod schema parses — omitted rather than sent as `undefined` so "no filter" and
 * "filter false" stay distinguishable.
 */
type QueryValue = string | number | undefined;
function toQuery(input: Record<string, string | number | boolean | undefined>): Record<string, QueryValue> {
  const out: Record<string, QueryValue> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    out[key] = typeof value === 'boolean' ? String(value) : value;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Sales — intake
// ---------------------------------------------------------------------------------------------

export async function listApplications(query: {
  limit?: number;
  offset?: number;
  statusCode?: string;
  gate?: boolean;
}): Promise<{ items: VerificationCaseRow[]; total: number }> {
  const res = (await request('GET', '/verification/applications', { query: toQuery(query) })) as {
    items?: unknown;
    total?: number;
  };
  return { items: asList<VerificationCaseRow>(res?.items), total: Number(res?.total) || 0 };
}

export async function getApplication(id: string): Promise<ApplicationDetail> {
  return (await request('GET', `/verification/applications/${id}`)) as ApplicationDetail;
}

export async function createApplication(body: {
  applicantType?: VerificationApplicantType;
  companyName?: string;
}): Promise<ApplicationDetail> {
  return (await request('POST', '/verification/applications', { body })) as ApplicationDetail;
}

export interface VerificationDocumentLink {
  url: string;
  fileName: string;
  expiresAt?: string;
}

/**
 * Resolve a short-lived link to a stored document.
 *
 * Two routes, one call: Sales reaches its own application, Verification reaches the case it is
 * underwriting. Same document, same storage — only the department gate differs, so the caller says
 * which desk it is rather than the two surfaces growing separate download code.
 */
export async function getDocumentLink(
  desk: 'sales' | 'verification',
  caseId: string,
  documentId: string,
): Promise<VerificationDocumentLink> {
  return (await request(
    'GET',
    `${documentBase(desk, caseId)}/documents/${encodeURIComponent(documentId)}/download`,
  )) as VerificationDocumentLink;
}

/** Both desks' door onto one document. Shared by the link route and the bytes route. */
function documentBase(desk: 'sales' | 'verification', caseId: string): string {
  return desk === 'sales'
    ? `/verification/applications/${encodeURIComponent(caseId)}`
    : `/verification/flow/cases/${encodeURIComponent(caseId)}`;
}

/**
 * The document's BYTES, from our own origin.
 *
 * Not the Dropbox link: that URL is served `Content-Disposition: attachment` with no CORS, which is
 * why clicking a file used to open a blank tab and then download it. The proxy route sends the real
 * MIME with `inline`, and a `blob:` URL built here is same-origin to this document — so the browser's
 * own PDF and image viewers render it.
 */
export async function fetchDocumentBytes(
  desk: 'sales' | 'verification',
  caseId: string,
  documentId: string,
): Promise<Blob> {
  return requestBlob(
    `${documentBase(desk, caseId)}/documents/${encodeURIComponent(documentId)}/bytes`,
    // A 20 MB bank statement over a phone tether needs longer than the 20s default.
    { timeoutMs: 60_000 },
  );
}

/**
 * PREVIEW a stored document in a new tab.
 *
 * Two things have to be true at once, and they pull in opposite directions: the tab must be claimed
 * while the click is still a user gesture (`openSignedFile`), and the URL can only exist after a
 * fetch that carries the session bearer — a new tab cannot send an Authorization header, so a plain
 * navigation to the API would 401. Claiming first and resolving a `blob:` URL second satisfies both.
 *
 * Inside the Telegram WebView there is no tab to claim, so the file is delivered through the Horizon
 * bot instead — the same fallback every other export in the app uses.
 */
export async function openDocument(
  desk: 'sales' | 'verification',
  caseId: string,
  documentId: string,
  fileName = 'document',
): Promise<void> {
  await openSignedFile(
    async () => {
      const url = URL.createObjectURL(await fetchDocumentBytes(desk, caseId, documentId));
      // Revoked on a delay, never synchronously: the new tab has not loaded the URL yet when this
      // returns, and revoking first leaves a blank viewer. Same 5s the shared download path uses.
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return url;
    },
    {
      shouldUseFallback: isTelegramWebView,
      fallback: async () => {
        await deliverExport(await fetchDocumentBytes(desk, caseId, documentId), fileName);
      },
    },
  );
}

export async function patchApplication(
  id: string,
  body: Record<string, unknown>,
): Promise<ApplicationDetail> {
  return (await request('POST', `/verification/applications/${id}`, { body })) as ApplicationDetail;
}

export async function addPrincipal(
  id: string,
  body: Record<string, unknown>,
): Promise<ApplicationDetail> {
  return (await request('POST', `/verification/applications/${id}/principals`, {
    body,
  })) as ApplicationDetail;
}

export async function removePrincipal(id: string, principalId: string): Promise<ApplicationDetail> {
  return (await request(
    'POST',
    `/verification/applications/${id}/principals/${principalId}/delete`,
  )) as ApplicationDetail;
}

/** One multipart request so the server's response is authoritative about what landed. */
export async function uploadApplicationDocuments(
  id: string,
  files: File[],
  opts: { docType: VerificationDocType; label?: string; fulfilsRequestId?: string },
): Promise<ApplicationDetail> {
  const form = new FormData();
  form.append('docType', opts.docType);
  if (opts.label) form.append('label', opts.label);
  if (opts.fulfilsRequestId) form.append('fulfilsRequestId', opts.fulfilsRequestId);
  for (const file of files) form.append('files', file, file.name);
  return (await requestMultipart(
    `/verification/applications/${id}/documents`,
    form,
  )) as ApplicationDetail;
}

export async function deleteApplicationDocument(
  id: string,
  documentId: string,
): Promise<ApplicationDetail> {
  return (await request(
    'POST',
    `/verification/applications/${id}/documents/${documentId}/delete`,
  )) as ApplicationDetail;
}

export async function submitApplication(id: string): Promise<ApplicationDetail> {
  return (await request('POST', `/verification/applications/${id}/submit`)) as ApplicationDetail;
}

// ---------------------------------------------------------------------------------------------
// Verification — underwriting
// ---------------------------------------------------------------------------------------------

export async function listDeskCases(query: {
  limit?: number;
  offset?: number;
  statusCode?: string;
  phaseCode?: string;
  applicantType?: VerificationApplicantType;
  underwritingRoute?: VerificationRoute;
  gate?: boolean;
  open?: boolean;
  search?: string;
}): Promise<{
  items: VerificationCaseRow[];
  total: number;
  aggregates: VerificationDeskAggregates;
}> {
  const res = (await request('GET', '/verification/flow/cases', { query: toQuery(query) })) as {
    items?: unknown;
    total?: number;
    aggregates?: VerificationDeskAggregates;
  };
  return {
    items: asList<VerificationCaseRow>(res?.items),
    total: Number(res?.total) || 0,
    aggregates:
      res?.aggregates ??
      { total: 0, awaitingSales: 0, workable: 0, pendingDocs: 0, managerReview: 0, closed: 0 },
  };
}

export async function getDeskCase(id: string): Promise<VerificationDeskDetail> {
  return (await request('GET', `/verification/flow/cases/${id}`)) as VerificationDeskDetail;
}

/**
 * Correct the application FROM THE DESK.
 *
 * Same columns as `patchApplication`, different door: that one is Sales-gated and refuses once
 * underwriting starts, this one is verification-gated and allows a correction at any phase short of
 * a decided case. Returns the full desk detail, so the caller never refetches.
 */
export async function patchDeskIntake(
  id: string,
  body: Record<string, unknown>,
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/intake`, {
    body,
  })) as VerificationDeskDetail;
}

/**
 * Reopen a phase — the desk's way back through the rail.
 *
 * `reason` is required by the route (min 3 chars): this withdraws a decision somebody else recorded,
 * and it lands on the case timeline as the `phase_reopened` note. Every phase after the reopened one is
 * un-decided server-side; the response is the fresh detail, so the caller never refetches.
 */
export async function reopenPhase(
  id: string,
  phase: string,
  body: { reason: string },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/phases/${phase}/reopen`, {
    body,
  })) as VerificationDeskDetail;
}

export async function decidePhase(
  id: string,
  phase: string,
  body: {
    outcome: VerificationPhaseOutcome;
    note?: string;
    findings?: Record<string, unknown>;
  },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/phases/${phase}/decision`, {
    body,
  })) as VerificationDeskDetail;
}

export async function runScreening(id: string): Promise<VerificationDeskDetail> {
  return (await request(
    'POST',
    `/verification/flow/cases/${id}/screening/run`,
  )) as VerificationDeskDetail;
}

export async function setScreeningVerdict(
  id: string,
  hitId: string,
  body: { verdict: VerificationScreeningVerdict; note?: string },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/screening/${hitId}/verdict`, {
    body,
  })) as VerificationDeskDetail;
}

export async function saveCreditReview(
  id: string,
  body: Record<string, unknown>,
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/credit-review`, {
    body,
  })) as VerificationDeskDetail;
}

export async function saveBankingReview(
  id: string,
  body: Record<string, unknown>,
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/banking-review`, {
    body,
  })) as VerificationDeskDetail;
}

export async function saveRiskAssessment(
  id: string,
  body: {
    riskTier: VerificationRiskTier;
    businessAgeMonths?: number;
    authorityAgeMonths?: number;
    analystRecommendation?: string;
    keyRisks?: string[];
  },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/risk`, {
    body,
  })) as VerificationDeskDetail;
}

export async function requestDocuments(
  id: string,
  body: {
    phaseCode: string;
    items: Array<{ docType: VerificationDocType; label?: string }>;
    note?: string;
  },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/documents/request`, {
    body,
  })) as VerificationDeskDetail;
}

export async function resumeAfterDocuments(id: string): Promise<VerificationDeskDetail> {
  return (await request(
    'POST',
    `/verification/flow/cases/${id}/documents/resume`,
  )) as VerificationDeskDetail;
}

export async function submitFinalDecision(
  id: string,
  body: { decision: VerificationFinalDecision; approvedLimit?: number; note?: string },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/decision`, {
    body,
  })) as VerificationDeskDetail;
}

export interface VerificationPolicy {
  strongFactor: string | null;
  moderateFactor: string | null;
  weakFactor: string | null;
  adbReviewThreshold: string;
  nsfReviewThreshold: number;
  bankFirstTruckMin: number;
  wexCardCutoff: number;
  /**
   * The Verification agent — desk config, not row data.
   *
   * Nothing in the schema records a per-case underwriter (`decided_by` is unwritten, case events
   * carry no actor, `distribute_type` is `shared`), and one configured agent is notified about every
   * application. Null when the server cannot resolve them; a desk screen still loads, it just does
   * not name anybody rather than inventing a label.
   */
  verificationOwner: { zohoUserId: string; name: string } | null;
}

/** Only the numeric factors are writable — `verificationOwner` is resolved, never posted. */
type PolicyNumberKey =
  | 'strongFactor'
  | 'moderateFactor'
  | 'weakFactor'
  | 'adbReviewThreshold'
  | 'nsfReviewThreshold'
  | 'bankFirstTruckMin'
  | 'wexCardCutoff';

export async function getPolicy(): Promise<VerificationPolicy> {
  return (await request('GET', '/verification/flow/policy')) as VerificationPolicy;
}

export async function savePolicy(
  body: Partial<Record<PolicyNumberKey, number | null>>,
): Promise<VerificationPolicy> {
  return (await request('POST', '/verification/flow/policy', { body })) as VerificationPolicy;
}

/** A field the warehouse could fill on this application. `field` maps to an intake form input. */
export interface PrefillSuggestion {
  field:
    | 'dot'
    | 'phone'
    | 'email'
    | 'businessAddress'
    | 'residentialAddress'
    | 'trucksCount'
    | 'principalName';
  label: string;
  value: string;
}

export interface PrefillResult {
  match: {
    matchedOn: 'phone' | 'dot' | 'email';
    dotNumber: string | null;
    ownerFullName: string | null;
    physicalAddress: string | null;
    operatingStatus: string | null;
    authorityAddedOn: string | null;
  } | null;
  suggestions: PrefillSuggestion[];
}

/**
 * Carrier records the warehouse already holds for this application.
 *
 * The lookup keys come from the CASE server-side — there is nothing to pass and nothing the client
 * could widen the search with. Matches roughly a quarter of cases, so an empty result is ordinary.
 */
export async function getApplicationPrefill(id: string): Promise<PrefillResult> {
  return (await request('GET', `/verification/applications/${id}/prefill`)) as PrefillResult;
}

/**
 * The desk attaching a document itself.
 *
 * Same service and the same gate re-evaluation as the Sales upload — a reviewer holding a scan
 * Sales emailed them should not have to ask Sales to re-key it. Verification-gated route.
 */
export async function uploadDeskDocuments(
  caseId: string,
  files: File[],
  opts: { docType: VerificationDocType; label?: string; fulfilsRequestId?: string },
): Promise<VerificationDeskDetail> {
  const form = new FormData();
  form.append('docType', opts.docType);
  if (opts.label) form.append('label', opts.label);
  if (opts.fulfilsRequestId) form.append('fulfilsRequestId', opts.fulfilsRequestId);
  for (const file of files) form.append('files', file, file.name);
  return (await requestMultipart(
    `/verification/flow/cases/${caseId}/documents`,
    form,
  )) as VerificationDeskDetail;
}
