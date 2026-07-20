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
  BillingPrepayCompanies,
  BillingPrepayLedger,
  BillingReturnCandidates,
  BillingReturnsPage,
  BillingTransactionsPage,
  BillingWriteResult,
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

/** Prepay companies list — mytrion-ops-composed (DWH companies + loads/draws, PG
 *  Zelle/Chase/Merchant, servercrm EFS/CMP/Maintenance externals). */
export function fetchPrepayCompanies(startDate: string, endDate: string): Promise<BillingPrepayCompanies> {
  return billingGet(
    `/billing/prepay/companies?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

/** Live EFS RMVE batch for the visible page (proxied to servercrm). */
export function fetchPrepayRmve(
  carrierIds: string,
  startDate: string,
  endDate: string,
  fresh = false,
): Promise<Record<string, unknown>> {
  const f = fresh ? '&fresh=1' : '';
  return billingGet(
    `/billing/prepay/rmve?carrierIds=${encodeURIComponent(carrierIds)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}${f}`,
  );
}

/** Per-carrier daily reconciliation ledger (modal; proxied to servercrm). */
export function fetchPrepayLedger(
  carrierId: string,
  startDate: string,
  endDate: string,
): Promise<BillingPrepayLedger> {
  return billingGet(
    `/billing/prepay/ledger?carrierId=${encodeURIComponent(carrierId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
}

/** Fuzzy carrier suggestion from a payer name / bank descriptor. */
export function fuzzyCarrier(p: {
  senderName?: string;
  description?: string;
  email?: string;
}): Promise<BillingFuzzyResult> {
  return request('POST', '/billing/carrier/fuzzy', { headers: BILLING_HEADERS, body: p }) as Promise<BillingFuzzyResult>;
}

// ---- Postgres-backed writes (replace the Zoho billing.* write touchpoints; CMP via servercrm) ----

function billingWrite(path: string, body: unknown): Promise<BillingWriteResult> {
  return request('POST', path, { headers: BILLING_HEADERS, body }) as Promise<BillingWriteResult>;
}

const txPath = (id: string, action: string): string =>
  `/billing/transactions/${encodeURIComponent(id)}/${action}`;

/** Map a payment to a CMP invoice. */
export function mapTransaction(
  id: string,
  body: { invoiceId: string; invoiceNumber: string; paymentAmount: number; paymentDate: string; note?: string; carrierId: string },
): Promise<BillingWriteResult> {
  return billingWrite(txPath(id, 'map'), body);
}

/** Prepay top-up. */
export function topUpTransaction(
  id: string,
  body: { carrierId: string; paymentAmount: number; paymentDate: string; note?: string },
): Promise<BillingWriteResult> {
  return billingWrite(txPath(id, 'top-up'), body);
}

/** CRM-only sync (CMP payment pre-existed). */
export function syncCrmOnly(
  id: string,
  body: { carrierId: string; invoiceNumber?: string },
): Promise<BillingWriteResult> {
  return billingWrite(txPath(id, 'sync-crm-only'), body);
}

/** Split a payment across invoices/prepay. */
export function applySplits(id: string, splitsJson: string): Promise<BillingWriteResult> {
  return billingWrite(txPath(id, 'split'), { splitsJson });
}

/** Unmap: reverse CMP + clear the mapping (clearCrm='false' reverses CMP but keeps the mapping). */
export function unmapTransaction(id: string, clearCrm: 'true' | 'false' = 'true'): Promise<BillingWriteResult> {
  return billingWrite(txPath(id, 'unmap'), { clearCrm });
}

/** Match a return to its original payment (reverses CMP, keeps mapping, flags returned). */
export function matchReturn(returnId: string, transactionRecordId: string): Promise<BillingWriteResult> {
  return billingWrite(`/billing/returns/${encodeURIComponent(returnId)}/match`, { transactionRecordId });
}

/** Learn a company → carrier pair (auto-map memory). */
export function saveCarrierMemory(companyName: string, carrierId: string): Promise<BillingWriteResult> {
  return billingWrite('/billing/carrier/memory', { companyName, carrierId });
}

// Data Center is now read-only (the Zoho deal-billing edit was removed) — no write here.

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
