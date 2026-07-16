/**
 * Customer Service Mytrion client (/v1/cs/* + the cs.* touchpoints). Every touchpoint call
 * pins departmentAccess to ['customer-service'] (the generic client defaults to sales), and
 * every REST call carries the legacy department header (ignored for verified sessions —
 * kept for the FF_SESSION_DEPT_AUTHORITATIVE=0 rollback and unverified dev calls).
 */
import { request } from './transport';
import { callTouchpoint } from './touchpoints';
import type { TouchpointKey, TouchpointMap } from './touchpointTypes';

const CS_HEADERS = { 'x-department-access': 'customer-service' } as const;
const CS_DEPARTMENTS = ['customer-service'];

type CsTouchpointKey = Extract<TouchpointKey, `cs.${string}`>;

/** cs.* touchpoint call with the customer-service department view pinned. */
export function csTouchpoint<K extends CsTouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: CS_DEPARTMENTS });
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

export function getTeamOpenTickets(
  from: string,
  to: string,
): Promise<{ openTickets: number; byPriority: Array<{ priority?: string; count?: number }> }> {
  return request('GET', '/cs/analytics/tickets/team-open', {
    headers: CS_HEADERS,
    query: { from, to },
  }) as Promise<{ openTickets: number; byPriority: Array<{ priority?: string; count?: number }> }>;
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
