/**
 * Billing Mytrion client (/v1/billing/* + the billing.* touchpoints). Every touchpoint call
 * pins departmentAccess to ['billing'] (the generic client defaults to sales); the deal-billing
 * edit is a REST write that carries the legacy department header. Mirrors api/cs.ts.
 */
import { request } from './transport';
import { callTouchpoint } from './touchpoints';
import type {
  BillingFuzzyResult,
  BillingMemoryResult,
  BillingReturnCandidates,
  BillingReturnsPage,
  BillingTransactionsPage,
  TouchpointKey,
  TouchpointMap,
} from './touchpointTypes';

const BILLING_HEADERS = { 'x-department-access': 'billing' } as const;
const BILLING_DEPARTMENTS = ['billing'];

type BillingTouchpointKey = Extract<TouchpointKey, `billing.${string}`>;

/** billing.* touchpoint call with the billing department view pinned. */
export function billingTouchpoint<K extends BillingTouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: BILLING_DEPARTMENTS });
}

// ---- Postgres-backed reads (replace the Zoho billing.* read touchpoints) ----

function billingGet<T>(path: string): Promise<T> {
  return request('GET', path, { headers: BILLING_HEADERS }) as Promise<T>;
}

/** Paged payment ledger (newest first). */
export function fetchTransactions(page: number, limit: number): Promise<BillingTransactionsPage> {
  return billingGet(`/billing/transactions?page=${page}&limit=${limit}`);
}

/** Full-dataset text search. */
export function searchTransactions(query: string): Promise<BillingTransactionsPage> {
  return billingGet(`/billing/transactions/search?query=${encodeURIComponent(query)}`);
}

/** Paged returns / chargebacks queue. */
export function fetchReturns(page: number, limit: number): Promise<BillingReturnsPage> {
  return billingGet(`/billing/returns?page=${page}&limit=${limit}`);
}

/** Candidate original payments for manually matching a return. */
export function searchReturnCandidates(p: {
  query?: string;
  amount?: string;
  beforeDate?: string;
  customerName?: string;
}): Promise<BillingReturnCandidates> {
  const qs = new URLSearchParams();
  if (p.query) qs.set('query', p.query);
  if (p.amount) qs.set('amount', p.amount);
  if (p.beforeDate) qs.set('beforeDate', p.beforeDate);
  if (p.customerName) qs.set('customerName', p.customerName);
  return billingGet(`/billing/returns/candidates?${qs.toString()}`);
}

/** Learned company → carrier memory (fetched whole). */
export function fetchCarrierMemory(): Promise<BillingMemoryResult> {
  return billingGet('/billing/carrier/memory');
}

/** Fuzzy carrier suggestion from a payer name / bank descriptor. */
export function fuzzyCarrier(p: {
  senderName?: string;
  description?: string;
  email?: string;
}): Promise<BillingFuzzyResult> {
  return request('POST', '/billing/carrier/fuzzy', { headers: BILLING_HEADERS, body: p }) as Promise<BillingFuzzyResult>;
}

// ---- Data Center deal-billing edit (direct Deals update via REST) ----

export function updateDealBilling(
  id: string,
  changes: Partial<{
    Payment_Type_Billing: string | null;
    Billing_Cycle: string | null;
    Billing_Verification: string | boolean | null;
  }>,
): Promise<{ id: string; updatedFields: string[] }> {
  return request('POST', `/billing/data-center/deals/${encodeURIComponent(id)}`, {
    headers: BILLING_HEADERS,
    body: changes,
  }) as Promise<{ id: string; updatedFields: string[] }>;
}

// ---- Real-time mapping relay (Phase 3b) ----

export type MappingAction = 'map' | 'unmap' | 'returned';

export interface MappingBroadcast {
  action: MappingAction;
  transactionRecordId: string;
  source?: string;
  carrierId?: string;
  mappingType?: string;
  mappedAt?: string;
  /** This client's stable session id — the server echoes it so we ignore our own event. */
  originId: string;
}

/**
 * Relay a local mapping change to peers via the backend proxy (which forwards to servercrm's
 * WebSocket hub with the server-side key). Best-effort and fire-and-forget — a relay failure
 * must never surface as a mapping failure.
 */
export function broadcastMapping(payload: MappingBroadcast): void {
  void request('POST', '/billing/mapping-event', {
    headers: BILLING_HEADERS,
    body: payload,
  }).catch(() => undefined);
}
