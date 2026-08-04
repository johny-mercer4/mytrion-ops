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

/**
 * Mart line items — the shared DWH transaction shape (backend `DwhTxnResult`).
 *
 * Rows live under `data`, NOT `transactions`/`rows`. Getting that wrong renders an empty table for
 * every carrier while looking like a legitimate "no activity" result, so the field is typed
 * explicitly rather than probed.
 */
export interface FinanceTxnResponse {
  data: Record<string, unknown>[];
  totals: {
    transactions?: number;
    line_items?: number;
    funded_total?: number;
    fuel_quantity?: number;
    total_fuel_quantity?: number;
    discount_amount?: number;
  };
  range?: Record<string, unknown>;
  pagination?: Record<string, unknown>;
}

/** Ranges the modal offers. `all_time` is the default — see the Transactions panel for why. */
export type TxnRange = 'month' | 'quarter' | 'year' | 'all_time';

export function getClientTransactions(
  carrierId: string,
  range: TxnRange = 'all_time',
): Promise<FinanceTxnResponse> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/transactions`, {
    query: { range, limit: 100 },
    headers: FIN_HEADERS,
  }) as Promise<FinanceTxnResponse>;
}

// ─── EFS (live vendor state, via servercrm) ──────────────────────────────────────────────────

/**
 * These four reads go out to EFS through servercrm, so they are SECONDS not milliseconds (the
 * money-code history is parent-wide upstream and runs ~7s). Each panel fetches on tab open and each
 * carries its own skeleton — nothing here is loaded with the modal.
 */

export interface EfsContract {
  contractId: string;
  description: string;
  balance: number;
}

export interface EfsCard {
  cardNumber: string;
  status: string;
  type: string;
  balance: number;
}

export interface EfsSnapshot {
  carrierId: string;
  totalBalance: number;
  contracts: EfsContract[];
  cards: EfsCard[];
  cardCount: number;
  /** Set when EFS answered contracts but not card detail — the balance is real, the cards partial. */
  cardDetailError: string | null;
  fetchedAt: string;
}

export function getClientEfs(carrierId: string): Promise<EfsSnapshot> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/efs`, {
    headers: FIN_HEADERS,
  }) as Promise<EfsSnapshot>;
}

export interface EfsLoad {
  direction: 'TOPUP' | 'SWEEP';
  amount: number;
  amountAbs: number;
  contractId: string;
  when: string | null;
  responseId: string | null;
  refNum: string | null;
}

export interface EfsLoadsResponse {
  window: { from: string; to: string; days: number; custom: boolean };
  summary: {
    total: number;
    topupCount: number;
    topupAmount: number;
    sweepCount: number;
    sweepAmount: number;
    net: number;
  };
  loads: EfsLoad[];
}

/** EFS caps the window at 90 days — the presets are 7 / 30 / 90 and nothing wider. */
export type EfsDays = 7 | 30 | 90;

/**
 * A window is either a rolling preset or an explicit pair of calendar dates (both inclusive).
 *
 * EFS's 90-day ceiling applies to both; the server rejects a wider custom span with a 400 rather
 * than letting the vendor answer with a SOAP fault.
 */
export type EfsRange = { kind: 'days'; days: EfsDays } | { kind: 'custom'; from: string; to: string };

export const rollingRange = (days: EfsDays): EfsRange => ({ kind: 'days', days });

/** Query params for a range — the one place the wire shape is built. */
export function rangeQuery(range: EfsRange): Record<string, string | number> {
  return range.kind === 'custom' ? { from: range.from, to: range.to } : { days: range.days };
}

/** Stable, human-readable identity for a range — used in cache keys and captions. */
export function rangeLabel(range: EfsRange): string {
  return range.kind === 'custom' ? `${range.from}_${range.to}` : `${range.days}d`;
}

export function getClientEfsLoads(
  carrierId: string,
  range: EfsRange = rollingRange(30),
): Promise<EfsLoadsResponse> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/efs/loads`, {
    query: rangeQuery(range),
    headers: FIN_HEADERS,
  }) as Promise<EfsLoadsResponse>;
}

// ─── Money codes ─────────────────────────────────────────────────────────────────────────────

/**
 * A money code with the redeemable digits REMOVED — `codeLast4` is all the API returns, by design.
 * An unredeemed code is a bearer instrument, so the value never reaches a browser; it reaches the
 * carrier through the CMP notification. See the backend `financeEfs.ts` header.
 */
export interface FinanceMoneyCode {
  id: string;
  codeLast4: string;
  status: string;
  efsStatus: string;
  amount: number;
  amountUsed: number;
  amountRemaining: number;
  feeAmount: number;
  contractId: string;
  issuedTo: string;
  notes: string;
  payee: string;
  issuedBy: string;
  codeType: string;
  createdAt: string | null;
  firstUseAt: string | null;
  voided: boolean;
  voidedAt: string | null;
}

export const MONEY_CODE_STATUSES = ['ALL', 'OPEN', 'USED', 'PARTIAL', 'VOIDED'] as const;
export type MoneyCodeStatus = (typeof MONEY_CODE_STATUSES)[number];

export interface MoneyCodesResponse {
  window: { from: string; to: string; days: number; custom: boolean };
  status: MoneyCodeStatus;
  summary: {
    total: number;
    openCount: number;
    openAmount: number;
    usedCount: number;
    usedAmount: number;
    partialCount: number;
    partialAmount: number;
    voidedCount: number;
    feeTotal: number;
  };
  codes: FinanceMoneyCode[];
}

export function getClientMoneyCodes(
  carrierId: string,
  range: EfsRange = rollingRange(30),
  status: MoneyCodeStatus = 'ALL',
): Promise<MoneyCodesResponse> {
  return request('GET', `/finance/clients/${encodeURIComponent(carrierId)}/money-codes`, {
    query: { ...rangeQuery(range), status },
    headers: FIN_HEADERS,
  }) as Promise<MoneyCodesResponse>;
}

export interface MoneyCodeUse {
  amount: number;
  checkNumber: string;
  at: string | null;
}

export interface MoneyCodeDetail {
  id: string;
  codeLast4: string;
  status: string;
  amount: number;
  amountUsed: number;
  uses: MoneyCodeUse[];
  firstUseAt: string | null;
  voided: boolean;
  voidedAt: string | null;
}

/** Redemption detail by EFS `codeId` — never by the code itself (that call crashes EFS). */
export function getMoneyCodeDetail(codeId: string): Promise<MoneyCodeDetail> {
  return request('GET', `/finance/money-codes/${encodeURIComponent(codeId)}`, {
    headers: FIN_HEADERS,
  }) as Promise<MoneyCodeDetail>;
}
