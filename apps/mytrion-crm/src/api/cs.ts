/**
 * Customer Service Mytrion client (/v1/cs/* + the cs.* touchpoints). Every touchpoint call
 * pins departmentAccess to ['customer-service'] (the generic client defaults to sales), and
 * every REST call carries the legacy department header (ignored for verified sessions —
 * kept for the FF_SESSION_DEPT_AUTHORITATIVE=0 rollback and unverified dev calls).
 */
import { request, requestMultipart } from './transport';
import { callTouchpoint } from './touchpoints';
import type { TouchpointKey, TouchpointMap, TrackingResult } from './touchpointTypes';

const CS_HEADERS = { 'x-department-access': 'customer-service' } as const;
const CS_DEPARTMENTS = ['customer-service'];

type CsTouchpointKey = Extract<TouchpointKey, `cs.${string}`>;

/** cs.* touchpoint call with the customer-service department view pinned. */
export function csTouchpoint<K extends CsTouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
  opts: { force?: boolean } = {},
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: CS_DEPARTMENTS, ...(opts.force ? { force: true } : {}) });
}

// ---- Applications writes ----

export interface SaveApplicationResult {
  id: string;
  updatedFields: string[];
  dealId: string | null;
  dealSyncedFields: number;
  warning?: string;
}

export type OnboardingField =
  | 'Email_to_TA'
  | 'TA_EFS_Added'
  | 'Limits_added'
  | 'Mobile_Driver_App'
  | 'Chain_policy';

export function saveApplication(
  id: string,
  changes: Record<string, string | number | boolean | null>,
): Promise<SaveApplicationResult> {
  return request('POST', `/cs/applications/${encodeURIComponent(id)}`, {
    headers: CS_HEADERS,
    body: { changes },
  }) as Promise<SaveApplicationResult>;
}

export function toggleOnboarding(
  id: string,
  field: OnboardingField,
  value: boolean,
): Promise<SaveApplicationResult> {
  return request('POST', `/cs/applications/${encodeURIComponent(id)}/onboarding`, {
    headers: CS_HEADERS,
    body: { field, value },
  }) as Promise<SaveApplicationResult>;
}

// ---- Card tracking (additional card orders — QA 2026-08-07) ----

/**
 * FedEx tracking for a carrier's card shipments — the Deal-level `Tracking_Information` subform,
 * not the Applications record (that module never carried real tracking data; see the empty
 * "Tracking #" column this replaced).
 *
 * A separate touchpoint key from Sales' `carrier.trucking_number_request` (same handler
 * underneath) — that one carries `carrierParam`, which gates non-admins to their own DWH-owned
 * carrier book. CS has no such book: an agent looks up whatever carrier a client calls about, so
 * `cs.carrier.trucking_number_request` (csDeluge.ts) omits it entirely, same as the Billing
 * portfolio-role touchpoints.
 */
export function getCardTrackingNumbers(carrierId: string): Promise<TrackingResult> {
  return csTouchpoint('cs.carrier.trucking_number_request', { carrierId });
}

/**
 * Bulk FedEx tracking for the Clients tab's Tracking # column — one call for every carrierId on
 * the current page, not one per row (see fetchFedexTrackingBulk on the backend for why that
 * matters: up to 2000 rows × 2 Zoho calls each would be the naive per-row alternative).
 */
export function getCardTrackingBulk(carrierIds: string[]): Promise<Record<string, string>> {
  if (carrierIds.length === 0) return Promise.resolve({});
  return request('POST', '/cs/applications/tracking', {
    headers: CS_HEADERS,
    body: { carrierIds },
  }).then((r) => (r as { tracking: Record<string, string> }).tracking);
}

// ---- Citifuel ----

export interface CitiRecordPage {
  rows: Array<Record<string, unknown>>;
  moreRecords: boolean;
}

export function listCitifuel(opts: {
  status?: string;
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<CitiRecordPage> {
  return request('GET', '/cs/citifuel', {
    headers: CS_HEADERS,
    query: {
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.search ? { search: opts.search } : {}),
      page: String(opts.page ?? 1),
      perPage: String(opts.perPage ?? 50),
    },
  }) as Promise<CitiRecordPage>;
}

export interface CitiMeta {
  statusOptions: string[];
  requestOptions: string[];
  actionOptions: string[];
}

export function getCitifuelMeta(): Promise<CitiMeta> {
  return request('GET', '/cs/citifuel/meta', { headers: CS_HEADERS }) as Promise<CitiMeta>;
}

export function getCitifuelStats(): Promise<{ total: number; byStatus: Record<string, number> }> {
  return request('GET', '/cs/citifuel/stats', { headers: CS_HEADERS }) as Promise<{
    total: number;
    byStatus: Record<string, number>;
  }>;
}

/** Citi-vs-Octane counts for a Date_of_Request window (QA feedback: report over any period). */
export interface CitiDecisionSplit {
  from: string;
  to: string;
  total: number;
  citifuel: number;
  octane: number;
  undecided: number;
  byDecision: Array<{ decision: string; count: number }>;
}

export function getCitifuelDecisionSplit(from: string, to: string): Promise<CitiDecisionSplit> {
  return request('GET', '/cs/citifuel/decision-split', {
    headers: CS_HEADERS,
    query: { from, to },
  }) as Promise<CitiDecisionSplit>;
}

export function lookupAccounts(q: string): Promise<{ accounts: Array<{ id: string; Account_Name?: string }> }> {
  return request('GET', '/cs/citifuel/lookup/accounts', {
    headers: CS_HEADERS,
    query: { q },
  }) as Promise<{ accounts: Array<{ id: string; Account_Name?: string }> }>;
}

export function lookupUsers(): Promise<{ users: Array<{ id: string; name: string | null; email: string | null }> }> {
  return request('GET', '/cs/citifuel/lookup/users', { headers: CS_HEADERS }) as Promise<{
    users: Array<{ id: string; name: string | null; email: string | null }>;
  }>;
}

export type CitiWriteValue = string | number | boolean | null | { id: string };

export function createCitifuel(data: Record<string, CitiWriteValue>): Promise<{ id: string }> {
  return request('POST', '/cs/citifuel', { headers: CS_HEADERS, body: data }) as Promise<{ id: string }>;
}

export function updateCitifuel(id: string, data: Record<string, CitiWriteValue>): Promise<{ id: string }> {
  return request('PATCH', `/cs/citifuel/${encodeURIComponent(id)}`, {
    headers: CS_HEADERS,
    body: data,
  }) as Promise<{ id: string }>;
}

export function deleteCitifuel(id: string): Promise<{ id: string; deleted: boolean }> {
  return request('DELETE', `/cs/citifuel/${encodeURIComponent(id)}`, {
    headers: CS_HEADERS,
  }) as Promise<{ id: string; deleted: boolean }>;
}

// ---- Maintenance cases ----
// Postgres-backed end to end: the Zoho `Maintenance` module was migrated once and is not read
// again, so none of these hit Zoho (see src/routes/v1/csMaintenance.routes.ts).

export interface MaintenanceRecord {
  id: string;
  zohoRecordId: string | null;
  source: 'zoho_migration' | 'mytrion';
  name: string | null;
  companyZohoId: string | null;
  companyName: string | null;
  carrierId: string | null;
  unitNumber: string | null;
  status: string | null;
  caseType: string | null;
  caseDate: string | null;
  caseCompletion: string | null;
  driverName: string | null;
  phone: string | null;
  shopNumber: string | null;
  parts: string | null;
  workOrderId: string | null;
  referenceNumber: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  invoiced: boolean | null;
  cardDigits: string | null;
  /** NUMERIC arrives as a string — format, never arithmetic on the raw value. */
  totalAmount: string | null;
  completionCompensation: string | null;
  halfCompletionCompensation: string | null;
  leadCompensation: string | null;
  ownerZohoUserId: string | null;
  ownerName: string | null;
  /** Second agent on a jointly worked case — splits the bonus 50/50 with the Owner. */
  bonusCompletionUserId: string | null;
  bonusCompletionName: string | null;
  bonusLeadName: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaintenanceFacets {
  total: number;
  byStatus: Record<string, number>;
  byCaseType: Record<string, number>;
  byPaymentStatus: Record<string, number>;
  totalAmount: number;
}

export interface MaintenancePage {
  rows: MaintenanceRecord[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
  facets: MaintenanceFacets;
}

export interface MaintenanceQuery {
  search?: string;
  status?: string[];
  caseType?: string[];
  paymentMethod?: string[];
  paymentStatus?: string[];
  owner?: string;
  carrierId?: string;
  completed?: boolean;
  dateFrom?: string;
  dateTo?: string;
  sort?: 'date' | 'created' | 'amount' | 'company' | 'carrier';
  dir?: 'asc' | 'desc';
  page?: number;
  perPage?: number;
}

/** Multi-selects travel as `a,b,c`; empty values are dropped so they never widen the filter. */
function maintenanceParams(q: MaintenanceQuery): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (q.search?.trim()) out.search = q.search.trim();
  if (q.status?.length) out.status = q.status.join(',');
  if (q.caseType?.length) out.caseType = q.caseType.join(',');
  if (q.paymentMethod?.length) out.paymentMethod = q.paymentMethod.join(',');
  if (q.paymentStatus?.length) out.paymentStatus = q.paymentStatus.join(',');
  if (q.owner) out.owner = q.owner;
  if (q.carrierId) out.carrierId = q.carrierId;
  if (q.completed !== undefined) out.completed = String(q.completed);
  if (q.dateFrom) out.dateFrom = q.dateFrom;
  if (q.dateTo) out.dateTo = q.dateTo;
  if (q.sort) out.sort = q.sort;
  if (q.dir) out.dir = q.dir;
  out.page = q.page ?? 1;
  out.perPage = q.perPage ?? 24;
  return out;
}

export function listMaintenance(q: MaintenanceQuery = {}): Promise<MaintenancePage> {
  return request('GET', '/cs/maintenance', {
    headers: CS_HEADERS,
    query: maintenanceParams(q),
  }) as Promise<MaintenancePage>;
}

export function getMaintenanceStats(): Promise<MaintenanceFacets> {
  return request('GET', '/cs/maintenance/stats', {
    headers: CS_HEADERS,
  }) as Promise<MaintenanceFacets>;
}

export interface MaintenanceMeta {
  statusOptions: string[];
  caseTypeOptions: string[];
  paymentMethodOptions: string[];
  paymentStatusOptions: string[];
  owners: Array<{ ownerZohoUserId: string; ownerName: string; count: number }>;
  editableFields: string[];
}

export function getMaintenanceMeta(): Promise<MaintenanceMeta> {
  return request('GET', '/cs/maintenance/meta', {
    headers: CS_HEADERS,
  }) as Promise<MaintenanceMeta>;
}

export interface CompanyOption {
  carrierId: string;
  companyName: string;
  isActive: boolean;
  paymentTerms: string | null;
}

/**
 * Company typeahead from the DWH (`octane.dim_company`) — the authoritative company ↔ carrier-id map.
 * Selecting one fills the carrier id, so an agent never types it. 49 company names map to more than
 * one carrier, which is why the carrier id travels with each option and must be shown.
 */
export function lookupMaintenanceCompanies(q: string): Promise<{ companies: CompanyOption[] }> {
  return request('GET', '/cs/maintenance/lookup/companies', {
    headers: CS_HEADERS,
    query: { q },
  }) as Promise<{ companies: CompanyOption[] }>;
}

export type MaintenanceWriteValue = string | number | boolean | null;

export function createMaintenance(
  data: Record<string, MaintenanceWriteValue>,
): Promise<MaintenanceRecord> {
  return request('POST', '/cs/maintenance', {
    headers: CS_HEADERS,
    body: data,
  }) as Promise<MaintenanceRecord>;
}

export function updateMaintenance(
  id: string,
  data: Record<string, MaintenanceWriteValue>,
): Promise<MaintenanceRecord> {
  return request('PATCH', `/cs/maintenance/${encodeURIComponent(id)}`, {
    headers: CS_HEADERS,
    body: data,
  }) as Promise<MaintenanceRecord>;
}

/** Hard delete — test-case cleanup only, see the route's own doc comment. */
export function deleteMaintenance(id: string): Promise<{ id: string; deleted: boolean }> {
  return request('DELETE', `/cs/maintenance/${encodeURIComponent(id)}`, {
    headers: CS_HEADERS,
  }) as Promise<{ id: string; deleted: boolean }>;
}

// ---- Maintenance attachments (CS feedback 2026-07-31 — the CRM has this on every record) ----

export interface MaintenanceAttachment {
  id: string;
  caseId: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
  uploadedByName: string | null;
  createdAt: string;
}

export function listMaintenanceAttachments(caseId: string): Promise<{ attachments: MaintenanceAttachment[] }> {
  return request('GET', `/cs/maintenance/${encodeURIComponent(caseId)}/attachments`, {
    headers: CS_HEADERS,
  }) as Promise<{ attachments: MaintenanceAttachment[] }>;
}

export function uploadMaintenanceAttachment(caseId: string, file: File): Promise<MaintenanceAttachment> {
  const form = new FormData();
  form.append('file', file, file.name);
  return requestMultipart(`/cs/maintenance/${encodeURIComponent(caseId)}/attachments`, form, {
    headers: CS_HEADERS,
  }) as Promise<MaintenanceAttachment>;
}

export function getMaintenanceAttachmentDownloadUrl(
  caseId: string,
  attachmentId: string,
): Promise<{ id: string; name: string; url: string; expiresAt: string }> {
  return request(
    'GET',
    `/cs/maintenance/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
    { headers: CS_HEADERS },
  ) as Promise<{ id: string; name: string; url: string; expiresAt: string }>;
}

export function deleteMaintenanceAttachment(
  caseId: string,
  attachmentId: string,
): Promise<{ id: string; deleted: boolean }> {
  return request(
    'DELETE',
    `/cs/maintenance/${encodeURIComponent(caseId)}/attachments/${encodeURIComponent(attachmentId)}`,
    { headers: CS_HEADERS },
  ) as Promise<{ id: string; deleted: boolean }>;
}

// ---- Maintenance Timeline History (CS feedback 2026-07-31) ----

export interface MaintenanceHistoryChange {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

export interface MaintenanceHistoryEntry {
  id: string;
  caseId: string;
  action: 'created' | 'updated';
  changedByName: string | null;
  changes: MaintenanceHistoryChange[];
  changedAt: string;
}

export function listMaintenanceHistory(caseId: string): Promise<{ history: MaintenanceHistoryEntry[] }> {
  return request('GET', `/cs/maintenance/${encodeURIComponent(caseId)}/history`, {
    headers: CS_HEADERS,
  }) as Promise<{ history: MaintenanceHistoryEntry[] }>;
}

// ---- Analytics ----

export interface CsContext {
  isManager: boolean;
  deskAgentId: string | null;
  email: string | null;
  unmatched: boolean;
}

export function getCsContext(): Promise<CsContext> {
  return request('GET', '/cs/context', { headers: CS_HEADERS }) as Promise<CsContext>;
}

export interface AnalyticsWindow {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export interface TicketsAgentRow {
  assignee_id?: string | number;
  total?: number;
  prev_total?: number;
  open_count?: number;
  closed_count?: number;
  avg_resolution_secs?: number | null;
}

export interface DailyPoint {
  day?: string;
  count?: number;
}

export interface StatusSlice {
  status?: string;
  count?: number;
}

export interface TicketsAnalytics {
  unmatched?: boolean;
  data?: {
    agents?: TicketsAgentRow[];
    totals?: { current?: number; previous?: number };
    daily?: DailyPoint[];
    byPriority?: Array<{ priority?: string; count?: number }>;
    byStatus?: StatusSlice[];
  };
}

export interface CallsAgentRow {
  owner_id?: string | number;
  name?: string;
  email?: string;
  total?: number;
  prev_total?: number;
}

export interface CallsAnalytics {
  unmatched?: boolean;
  data?: {
    agents?: CallsAgentRow[];
    totals?: { current?: number; previous?: number };
    daily?: DailyPoint[];
    byStatus?: StatusSlice[];
  };
}

function windowQuery(w: AnalyticsWindow): Record<string, string> {
  return { from: w.from, to: w.to, prevFrom: w.prevFrom, prevTo: w.prevTo };
}

export function getTicketsAnalytics(
  w: AnalyticsWindow,
  assigneeId?: string,
): Promise<TicketsAnalytics> {
  return request('GET', '/cs/analytics/tickets', {
    headers: CS_HEADERS,
    query: { ...windowQuery(w), ...(assigneeId ? { assigneeId } : {}) },
  }) as Promise<TicketsAnalytics>;
}

export function getCallsAnalytics(w: AnalyticsWindow, ownerEmail?: string): Promise<CallsAnalytics> {
  return request('GET', '/cs/analytics/calls', {
    headers: CS_HEADERS,
    query: { ...windowQuery(w), ...(ownerEmail ? { ownerEmail } : {}) },
  }) as Promise<CallsAnalytics>;
}

/** Maintenance analytics — native COQL (replaced the cs.analytics.maintenance Deluge). Envelope
 *  matches what the panel already reads, so only the transport changed. */
export interface MaintenanceAnalytics {
  success: boolean;
  data: {
    totals: {
      current: number;
      previous: number;
      open: number;
      closed: number;
      halfComplete: number;
      fullComplete: number;
    };
    byStatus: Array<{ status?: string; count?: number }>;
    byCaseType: Array<{ caseType?: string; count?: number }>;
    daily: Array<{ day?: string; count?: number }>;
    byOwner: Array<{
      id?: string;
      name?: string;
      count?: number;
      /** Closed with a Case_Completion date — earns the full per-case bonus. */
      fullComplete?: number;
      halfComplete?: number;
      /** Server-computed: $5 per fully complete + $2.50 per half (QA feedback 2026-07-28). */
      bonusUsd?: number;
    }>;
  };
}

export function getMaintenanceAnalytics(w: AnalyticsWindow): Promise<MaintenanceAnalytics> {
  return request('GET', '/cs/analytics/maintenance', {
    headers: CS_HEADERS,
    query: windowQuery(w),
  }) as Promise<MaintenanceAnalytics>;
}

/** Count for the Home "Maintenance" tile (windowed — the old Deluge count had no WHERE and read 0). */
export function getMaintenanceCount(from: string, to: string): Promise<{ count: number }> {
  return request('GET', '/cs/analytics/maintenance/count', {
    headers: CS_HEADERS,
    query: { from, to },
  }) as Promise<{ count: number }>;
}

/** One open Desk ticket for the Home team panel — number, status, and assigned owner. */
export interface CsOpenTicket {
  id: string;
  ticketNumber: string | null;
  status: string | null;
  statusType: string | null;
  priority: string | null;
  subject: string | null;
  owner: string | null;
}

export interface TeamOpenTickets {
  openTickets: number;
  byPriority: Array<{ priority?: string; count?: number }>;
  tickets: CsOpenTicket[];
}

export function getTeamOpenTickets(from: string, to: string): Promise<TeamOpenTickets> {
  return request('GET', '/cs/analytics/tickets/team-open', {
    headers: CS_HEADERS,
    query: { from, to },
  }) as Promise<TeamOpenTickets>;
}

export interface DeskRosterAgent {
  id: string;
  name: string | null;
  email: string | null;
}

export function getDeskRoster(): Promise<{ agents: DeskRosterAgent[] }> {
  return request('GET', '/cs/analytics/roster', { headers: CS_HEADERS }) as Promise<{
    agents: DeskRosterAgent[];
  }>;
}

// ---- Data Center ----

export function updateDealBilling(
  id: string,
  changes: Partial<{
    Payment_Type_Billing: string | null;
    Billing_Cycle: string | null;
    Billing_Verification: string | boolean | null;
  }>,
): Promise<{ id: string; updatedFields: string[] }> {
  return request('POST', `/cs/data-center/deals/${encodeURIComponent(id)}`, {
    headers: CS_HEADERS,
    body: changes,
  }) as Promise<{ id: string; updatedFields: string[] }>;
}
