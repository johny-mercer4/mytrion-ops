/**
 * Finance Mytrion client — the finance-gated `/v1/finance/*` reads plus the EFS parent-balance
 * touchpoint. All read-only; Finance has no write surface yet.
 *
 * The roster is deliberately split in two: `listFinanceClients()` returns a LEAN row for every
 * carrier (the table filters and searches client-side, so it must be small on the wire), and
 * `getFinanceClient()` fetches the rest of one carrier's profile when its modal opens. See the
 * backend `financeClients.ts` header for the sizing that drove the split.
 */
import { callTouchpoint } from './touchpoints';
import { request } from './transport';
import type { FinanceParentSnapshot, TouchpointKey, TouchpointMap } from './touchpointTypes';

const FINANCE_DEPARTMENTS = ['finance'];
type FinanceTouchpointKey = Extract<TouchpointKey, `finance.${string}`>;

// LEGACY department assertion — ignored for verified sessions (the server derives access from the
// session), kept only for the API-key / rollback path. Mirrors api/referrals.ts's MGR_HEADERS.
const FIN_HEADERS = { 'x-department-access': 'finance' } as const;

/** finance.* touchpoint call with the finance department view pinned. */
export function financeTouchpoint<K extends FinanceTouchpointKey>(
  key: K,
  params: TouchpointMap[K]['params'],
): Promise<TouchpointMap[K]['result']> {
  return callTouchpoint(key, params, { departmentAccess: FINANCE_DEPARTMENTS });
}

// ─── Home: EFS parent balance ────────────────────────────────────────────────────────────────

export interface ParentBalance {
  /** Coerced to a number — Deluge returns `balance` as a string. */
  balance: number;
  mode: string;
  capturedAt: string | null;
  snapshotName: string;
}

/** Latest EFS parent balance snapshot, normalized. */
export async function getParentBalance(): Promise<ParentBalance> {
  const raw: FinanceParentSnapshot = await financeTouchpoint('finance.parent_snapshot', {});
  const n = Number(raw.balance ?? 0);
  return {
    balance: Number.isFinite(n) ? n : 0,
    mode: (raw.mode ?? '').trim(),
    capturedAt: raw.captured_at ?? null,
    snapshotName: (raw.name ?? '').trim(),
  };
}

/** Trigger a fresh balance run. Fire-and-forget — re-fetch the snapshot afterwards. */
export function runBalanceRefresh(): Promise<unknown> {
  return financeTouchpoint('finance.balance_run', {});
}

// ─── Clients ─────────────────────────────────────────────────────────────────────────────────

/** Lean roster row — mirrors the backend `FinanceClientRow`. */
export interface FinanceClient {
  carrierId: string;
  companyName: string;
  /** 'LOC' | 'Prepay' | '' */
  paymentTerms: string;
  /** 'BANK' | 'DIRECT' | 'MERCHANT_CARD' | 'ZELLE' | '' */
  billingType: string;
  activeCards: number;
  computedDebt: number;
  computedDebtDays: number;
  openInvoices: number;
  isDebtor: boolean;
  computedIsActive: boolean;
}

/** Full profile for the modal's Details tab — mirrors `FinanceClientDetail`. */
export interface FinanceClientDetail extends FinanceClient {
  contact: string;
  phone: string;
  email: string;
  agentName: string;
  billingCycle: string;
  paymentDay: string;
  creditLimit: number;
  creditScore: number;
  moneyCode: string;
  dot: string;
  isLocSuspended: boolean;
  lastTransactionAt: string | null;
  firstSwipeAt: string | null;
}

export interface FinanceClientsResponse {
  clients: FinanceClient[];
  total: number;
  fetchedAt: string;
}

/** Every carrier, highest debt first (server-ordered). */
export function listFinanceClients(): Promise<FinanceClientsResponse> {
  return request('GET', '/finance/clients', { headers: FIN_HEADERS }) as Promise<FinanceClientsResponse>;
}

export function getFinanceClient(carrierId: string): Promise<FinanceClientDetail> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}`, {
    headers: FIN_HEADERS,
  }) as Promise<FinanceClientDetail>;
}

// ─── Modal tabs ──────────────────────────────────────────────────────────────────────────────

export interface FinanceInvoice {
  id: string;
  invoiceDate: string | null;
  dueDate: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  status: string;
  billingType: string;
  billingCycle: string;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  discount: number;
  merchantFee: number;
  moneyCodeTotal: number;
  ageDays: number;
  isOpen: boolean;
}

export interface FinanceInvoicesResponse {
  invoices: FinanceInvoice[];
  totalOutstanding: number;
  openCount: number;
}

export function getClientInvoices(carrierId: string): Promise<FinanceInvoicesResponse> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/invoices`, {
    headers: FIN_HEADERS,
  }) as Promise<FinanceInvoicesResponse>;
}

/** A row from our own `payment_transactions` ledger. Most fields are nullable by rail. */
export interface FinancePayment {
  id: number;
  source: string;
  amount: string | null;
  currency: string | null;
  occurredAt: string | null;
  name: string | null;
  status: string | null;
  txnType: string | null;
  externalTxnId: string | null;
  senderName: string | null;
  memo: string | null;
  isInvoiceMapped: boolean;
  mappingType: string | null;
  isReturned: boolean;
}

export interface FinancePaymentsResponse {
  payments: FinancePayment[];
  totalAmount: number;
}

export function getClientPayments(carrierId: string): Promise<FinancePaymentsResponse> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/payments`, {
    headers: FIN_HEADERS,
  }) as Promise<FinancePaymentsResponse>;
}

/** Mart line items — the shared DWH transaction shape (see backend dwhTransactions.ts). */
export interface FinanceTxnResponse {
  transactions?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  [k: string]: unknown;
}

export function getClientTransactions(carrierId: string, range = 'month'): Promise<FinanceTxnResponse> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/transactions`, {
    query: { range, limit: 100 },
    headers: FIN_HEADERS,
  }) as Promise<FinanceTxnResponse>;
}
