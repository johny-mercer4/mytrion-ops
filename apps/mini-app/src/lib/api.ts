/**
 * Public API client — no auth headers. The registration link's id (in the URL) is the
 * capability; the real identity proof is Telegram's initData HMAC, verified server-side on redeem.
 */
import { resolveApiConfig, v1Url } from './config';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const { baseUrl } = resolveApiConfig();
  const url = v1Url(baseUrl, path);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch (e) {
    throw new ApiError(`Could not reach Octane. ${(e as Error)?.message ?? ''}`, 'NETWORK', 0);
  }
  const raw = await res.text();
  let json: unknown = null;
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
  }
  if (!res.ok) {
    const err =
      json && typeof json === 'object' ? (json as { error?: { message?: string; code?: string } }).error : null;
    throw new ApiError(err?.message ?? `Backend returned HTTP ${res.status}.`, err?.code ?? `HTTP_${res.status}`, res.status);
  }
  return json;
}

export type CompanyType = 'owner-operator' | 'fleet-manager';
export type Profile = 'owner' | 'driver';

export interface RegistrationPreview {
  id: string;
  profile: Profile;
  companyName: string | null;
  companyType: CompanyType | null;
  cardCount: number | null;
  agentName: string | null;
  /** ISO deadline — drives the "This link expires in …" pill on the confirm screen. */
  expiresAt?: string;
}

export type PreviewResult =
  | { invite: RegistrationPreview; status: 'pending' }
  | { invite: null; status: 'redeemed'; companyName: string | null; agentName: string | null };

export async function fetchRegistrationPreview(id: string): Promise<PreviewResult> {
  return (await request('GET', `/carrier-invitations/${encodeURIComponent(id)}/public`)) as PreviewResult;
}

export interface RegistrationView {
  id: string;
  profile: Profile;
  companyName: string | null;
  carrierId: string | null;
  companyType: CompanyType | null;
  cardCount: number | null;
  cardId: string | null;
  agentName: string | null;
  /** Driver only: the real fuel-card number (from the DWH replica), null when unresolved. */
  cardNumber: string | null;
}

/** Aggregate fleet summary — counts only, deliberately no card numbers or driver identities. */
export interface FleetSummary {
  cardCount: number | null;
  registeredDrivers: number;
}

export type RedeemResult =
  | { registration: RegistrationView; fleet?: FleetSummary }
  | { alreadyRegistered: true; registration: RegistrationView };

export async function redeemRegistration(id: string, initData: string): Promise<RedeemResult> {
  return (await request('POST', `/carrier-invitations/${encodeURIComponent(id)}/redeem`, {
    initData,
  })) as RedeemResult;
}

export async function fetchMiniAppSession(initData: string): Promise<{ registration: RegistrationView }> {
  return (await request('POST', '/carrier/mini-app/session', { initData })) as { registration: RegistrationView };
}

/** Driver self-registration by fuel-card number — no invite link (the number identifies the carrier
 * + card; Telegram initData proves identity). Owners/companies still register via invite links. */
export async function driverSelfRegister(
  initData: string,
  cardNumber: string,
): Promise<{ registration: RegistrationView }> {
  return (await request('POST', '/carrier/mini-app/driver-self-register', {
    initData,
    cardNumber,
  })) as { registration: RegistrationView };
}

// ── Owner fleet management (owner-authenticated via initData) ────────────────────────────────
export type CardStatus = 'registered' | 'pending' | 'open';

export interface FleetCard {
  cardId: string | null;
  cardNumber: string | null;
  cardType: string | null;
  driverName: string | null;
  status: CardStatus;
  /** Pending only — the generated link + its 24h deadline; "expired" is derived from expiresAt. */
  link?: string | null;
  expiresAt?: string | null;
}

export interface FleetResponse {
  company: { companyName: string | null; carrierId: string; companyType: CompanyType | null };
  fleet: FleetCard[];
}

export async function fetchFleet(initData: string): Promise<FleetResponse> {
  return (await request('POST', '/carrier/mini-app/fleet', { initData })) as FleetResponse;
}

export interface DriverInviteResult {
  invite: { id: string; cardId: string | null; driverName: string | null };
  inviteUrl: string;
  expiresAt: string;
}

export async function createDriverInvite(
  initData: string,
  cardId: string,
  driverName: string,
): Promise<DriverInviteResult> {
  return (await request('POST', '/carrier/mini-app/driver-invites', {
    initData,
    cardId,
    driverName,
  })) as DriverInviteResult;
}

// ── Self-service reads (any registered user — owner or driver) ──────────────────────────────
// Result shapes copied verbatim from apps/mytrion-crm/src/api/touchpointTypes.ts — same servercrm
// endpoints, already production-verified there ("widget-observed; fields the UI actually renders").

export interface CarrierBalance {
  account_type?: string;
  payment_terms?: string;
  company_name?: string;
  credit_limit?: number | string | null;
  credit_remaining?: number | string | null;
  credit_used?: number | string | null;
  balance?: number | string | null;
  efs_balance?: number | string | null;
  billing_cycle?: string | null;
  efs_error?: string | null;
}

export interface CarrierOverview {
  company_name?: string;
  payment_terms?: string;
  account_type?: string;
  is_active?: boolean;
  credit_limit?: number | string | null;
  efs_balance?: number | string | null;
  efs_error?: string | null;
  cmp_debt?: {
    total_debt?: number;
    invoice_count?: number;
    max_debt_days?: number;
    is_hard_debtor?: boolean;
    worst_status?: string;
    error?: string;
  };
  cards?: { count?: number; active_count?: number; error?: string };
}

export interface EfsCardsResult {
  count?: number;
  data?: Array<{ card_number?: string; status?: string; [k: string]: unknown }>;
}

export interface StatusResult {
  overview: CarrierOverview;
  cards: EfsCardsResult;
}

export interface TransactionsResult {
  totals?: Record<string, number | string | null>;
  data?: Array<Record<string, unknown>>;
  pagination?: Record<string, unknown>;
  range?: { from?: string; to?: string };
  /** `pending: true` marks the fast DWH-only phase — the live EFS tail hasn't been merged yet. */
  live?: { merged?: number; pending?: boolean; as_of?: string | null };
}

/** Shape unconfirmed by any existing caller — render defensively, don't assume exact field names. */
export interface LastUsedResult {
  data?: Array<Record<string, unknown>>;
  count?: number;
  [k: string]: unknown;
}

export interface PaymentInfoResult {
  window?: unknown;
  invoices?: { count?: number; totals?: Record<string, number | string | null>; data?: unknown[] };
  payments?: { count?: number; total_amount?: number | string; by_source?: Record<string, unknown>; data?: unknown[] };
}

export interface SalesInvoicesResult {
  data?: Array<Record<string, unknown>>;
  count?: number;
  summary?: Record<string, unknown>;
}

export interface SignedUrlResult {
  url?: string;
  expiresIn?: number;
}

export interface TrackingResult {
  dealName?: string;
  fedexTracking?: string | null;
  trackingInfo?: Array<{ trackingNumber?: string; startDate?: string; cardsOrdered?: number | string }>;
}

export async function fetchBalance(initData: string): Promise<CarrierBalance> {
  return (await request('POST', '/carrier/mini-app/balance', { initData })) as CarrierBalance;
}

export async function fetchAccountStatus(initData: string): Promise<StatusResult> {
  return (await request('POST', '/carrier/mini-app/status', { initData })) as StatusResult;
}

/**
 * Transactions, in two phases. `live: false` (the default) reads the DWH mart only and lands in
 * well under a second; `live: true` asks the backend for the same window merged with a live EFS
 * gap-fill, which is authoritative but costs seconds. Call the fast one first, paint, then upgrade.
 */
export async function fetchTransactions(
  initData: string,
  range?: { range?: string; from?: string; to?: string },
  live = false,
): Promise<TransactionsResult> {
  return (await request('POST', '/carrier/mini-app/transactions', { initData, ...range, live })) as TransactionsResult;
}

export async function fetchLastUsed(initData: string, range?: string): Promise<LastUsedResult> {
  return (await request('POST', '/carrier/mini-app/last-used', { initData, ...(range ? { range } : {}) })) as LastUsedResult;
}

export async function fetchPaymentInfo(initData: string): Promise<PaymentInfoResult> {
  return (await request('POST', '/carrier/mini-app/payment-info', { initData })) as PaymentInfoResult;
}

export async function fetchInvoices(
  initData: string,
  range?: { range?: string; status?: string; from?: string; to?: string },
): Promise<SalesInvoicesResult> {
  return (await request('POST', '/carrier/mini-app/invoices', { initData, ...range })) as SalesInvoicesResult;
}

export async function fetchInvoiceSignedUrl(initData: string, invoiceId: string): Promise<SignedUrlResult> {
  return (await request('POST', '/carrier/mini-app/invoices/signed-url', { initData, invoiceId })) as SignedUrlResult;
}

/**
 * Deliver one invoice PDF to this user's Telegram chat. Same reason the transaction report goes that
 * way: a Telegram WebApp cannot reliably save a file, and the signed URL expires — in the chat the
 * document persists and can be forwarded.
 */
export async function sendInvoice(initData: string, invoiceId: string): Promise<{ sent?: boolean; fileName?: string }> {
  return (await request('POST', '/carrier/mini-app/invoices/send', { initData, invoiceId })) as {
    sent?: boolean;
    fileName?: string;
  };
}

export async function fetchTracking(initData: string): Promise<TrackingResult> {
  return (await request('POST', '/carrier/mini-app/tracking', { initData })) as TrackingResult;
}

export type ServiceRequestKey =
  | 'override-card'
  | 'money-code'
  | 'card-activate'
  | 'card-limit'
  | 'card-replace'
  | 'card-fraud'
  | 'billing-form'
  | 'ref-guides';

/**
 * File a real Zoho Desk ticket. The card is NOT sent — the backend resolves a driver's card from
 * their own registration, so this payload cannot aim the request at someone else's card.
 */
export async function sendServiceRequest(
  initData: string,
  service: ServiceRequestKey,
  comment?: string,
): Promise<{ ticketId: string; subject: string }> {
  return (await request('POST', '/carrier/mini-app/service-request', {
    initData,
    service,
    ...(comment ? { comment } : {}),
  })) as { ticketId: string; subject: string };
}

export type TxnExportFormat = 'csv' | 'xlsx' | 'pdf';

export interface TxnExportSent {
  sent?: boolean;
  fileName?: string;
  rows?: number;
}

/**
 * Build the transactions report server-side and have the bot deliver it to this user's Telegram
 * chat. Nothing downloads here: a Telegram WebApp can't reliably save a file, so the document lands
 * in the bot chat instead — where it persists and can be forwarded.
 */
export async function sendTransactionsReport(
  initData: string,
  range: { range?: string; from?: string; to?: string },
  format: TxnExportFormat,
): Promise<TxnExportSent> {
  return (await request('POST', '/carrier/mini-app/transactions/export', {
    initData,
    ...range,
    format,
  })) as TxnExportSent;
}
