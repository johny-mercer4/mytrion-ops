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
/** 'manager' has owner-equivalent access — the UI treats owner + manager alike (see isOwner). */
export type Profile = 'owner' | 'manager' | 'driver';

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
  driverName?: string,
): Promise<{ registration: RegistrationView }> {
  return (await request('POST', '/carrier/mini-app/driver-self-register', {
    initData,
    cardNumber,
    ...(driverName ? { driverName } : {}),
  })) as { registration: RegistrationView };
}

export interface CompanyDetails {
  carrierId: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

/** The carrier's company profile for the owner's profile sheet (owner-only upstream). */
export async function fetchCompany(initData: string): Promise<CompanyDetails> {
  return (await request('POST', '/carrier/mini-app/company', { initData })) as CompanyDetails;
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
  /** Live EFS extras (EFS-first fleet, 2026-07-22): status incl. inactive, unit, driver id. */
  efsStatus?: string | null;
  unitNumber?: string | null;
  efsDriverId?: string | null;
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

/** Owner corrects the driver name on one of their cards. The backend resolves the carrier from the
 *  caller's own registration and matches on (carrier, card), so a cardId that isn't theirs 404s. */
export async function renameDriver(
  initData: string,
  cardId: string,
  driverName: string,
): Promise<{ cardId: string; driverName: string }> {
  return (await request('POST', '/carrier/mini-app/driver-name', {
    initData,
    cardId,
    driverName,
  })) as { cardId: string; driverName: string };
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

export interface ManagerInviteResult {
  invite: { id: string };
  inviteUrl: string;
  expiresAt: string;
}

/** Owner (or an existing manager) issues a manager registration link for their carrier — a colleague
 *  with owner-equivalent company access. Carrier-level; the backend binds it to the caller's own
 *  carrier from their verified registration (never the body). `name` labels the manager on the
 *  roster and in the support-bot's allowed-user list once they register. */
export async function createManagerInvite(initData: string, name: string): Promise<ManagerInviteResult> {
  return (await request('POST', '/carrier/mini-app/manager-invites', {
    initData,
    name,
  })) as ManagerInviteResult;
}

export interface ManagerUser {
  id: string;
  name: string | null;
  telegramUsername: string | null;
  createdAt: string;
}

/** The carrier's registered managers — the owner/manager's team roster. */
export async function listManagers(initData: string): Promise<ManagerUser[]> {
  const data = (await request('POST', '/carrier/mini-app/managers', { initData })) as { managers: ManagerUser[] };
  return data.managers;
}

/** Revoke one manager's access. Backend scopes the revoke to the caller's own carrier + managers. */
export async function revokeManager(initData: string, id: string): Promise<{ id: string }> {
  return (await request('POST', '/carrier/mini-app/managers/revoke', { initData, id })) as { id: string };
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
  /** Owner only (feedback #10): available balance, weekly limit, next unpaid due date. */
  billing?: { availableBalance?: number | string | null; weeklyLimit?: number | string | null; dueDate?: string | null } | null;
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

/** Driver-safe funds check — booleans only, never the figure (the amount is the owner's business). */
export interface CardFundsResult {
  /** true/false from the live EFS pool; null = EFS unreachable → show "unknown", not "no money". */
  hasFunds: boolean | null;
  accountActive: boolean | null;
  /** The caller's own card's status (drivers only; null for owners). */
  cardStatus: string | null;
  efsError: string | null;
}

export async function fetchCardFunds(initData: string): Promise<CardFundsResult> {
  return (await request('POST', '/carrier/mini-app/card/funds', { initData })) as CardFundsResult;
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
  /** `cardId` (owner only) narrows to one card — ignored server-side for drivers. */
  range?: { range?: string; from?: string; to?: string; cardId?: string },
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
export async function sendInvoice(initData: string, invoiceId: string, format: 'pdf' | 'xlsx' | 'csv' = 'pdf'): Promise<{ sent?: boolean; fileName?: string }> {
  return (await request('POST', '/carrier/mini-app/invoices/send', { initData, invoiceId, format })) as {
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
  | 'account-reactivate'
  | 'dispute-txn';

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
  range: { range?: string; from?: string; to?: string; cardId?: string },
  format: TxnExportFormat,
  /** 'retail' = the "without discount" variant (EFS Retail Price Only). Ignored for drivers —
   * the backend forces retail for them regardless of what is sent. */
  priceMode: 'discount' | 'retail' = 'discount',
  /** Full card number + Driver/Unit/Driver ID columns. */
  detailed = false,
): Promise<TxnExportSent> {
  return (await request('POST', '/carrier/mini-app/transactions/export', {
    initData,
    ...range,
    format,
    priceMode,
    detailed,
  })) as TxnExportSent;
}

/** Accounting bundle — fuel (both price modes) + EFS money-code reports, Excel+PDF, delivered to
 * the bot chat in one tap. Owner-only server-side. */
export async function sendAccountingBundleReport(
  initData: string,
  range: { range?: string; from?: string; to?: string },
): Promise<TxnExportSent> {
  return (await request('POST', '/carrier/mini-app/transactions/export-bundle', { initData, ...range })) as TxnExportSent;
}

/** EFS money-code report alone (owner-only). The code values are never in the file. */
export async function sendMoneyCodeReport(
  initData: string,
  range: { range?: string; from?: string; to?: string },
  format: TxnExportFormat = 'xlsx',
): Promise<TxnExportSent> {
  return (await request('POST', '/carrier/mini-app/money-code-report', { initData, ...range, format })) as TxnExportSent;
}

// ── Self-service WRITE actions (wired to the agent widget's automations; see backend
//    carrierMiniAppActions.routes.ts). All are feature-flagged server-side: a 503 with code
//    MINIAPP_WRITES_DISABLED / MINIAPP_MONEY_CODE_DISABLED means "fall back to a service request".

/** Live EFS info for one card (status, hold flag, limits) — the diagnostics read. Owners pass the
 * cardId from the fleet list; drivers pass nothing (the backend pins them to their own card). */
export async function fetchCardEfs(initData: string, cardId?: string): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/card/efs', {
    initData,
    ...(cardId ? { cardId } : {}),
  })) as Record<string, unknown>;
}

/** C-16 — override a fraud-held card for ~30 minutes. Drivers: own card only (omit cardId). */
export async function overrideCard(initData: string, cardId?: string): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/card/override', {
    initData,
    ...(cardId ? { cardId } : {}),
  })) as Record<string, unknown>;
}

/** C-1 / C-3 — activate or deactivate a card. Owner-only. */
export async function setCardStatus(
  initData: string,
  cardId: string,
  action: 'activate' | 'deactivate' | 'hold' | 'unhold',
): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/card/set-status', { initData, cardId, action })) as Record<
    string,
    unknown
  >;
}

/** C-4 / C-5 — change one EFS limit bucket by `value` (the delta, not the new absolute). Owner-only;
 * the backend rejects deltas above its configured cap. */
export async function setCardLimits(
  initData: string,
  cardId: string,
  change: { limitId: string; value: number; action: 'increase' | 'decrease' },
): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/card/limits', { initData, cardId, ...change })) as Record<
    string,
    unknown
  >;
}

/** C-26 — unit number / driver id / driver name on the card, in EFS. Owner: any card via cardId;
 *  DRIVER: omit cardId (pinned to their own card server-side), unitNumber/driverId only. */
export async function updateCardInfo(
  initData: string,
  cardId: string | undefined,
  fields: { unitNumber?: string; driverId?: string; driverName?: string },
): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/card/info', {
    initData,
    ...(cardId ? { cardId } : {}),
    ...fields,
  })) as Record<string, unknown>;
}

export interface BillingFormInfo {
  verification?: string | null;
  billingForm?: Record<string, unknown> | null;
  notes?: Array<{ title?: string; content?: string; createdTime?: string; createdBy?: string }>;
}

/** Billing form + verification notes on file — owner-only; the same servercrm read the CRM widget uses. */
export async function fetchBillingForm(initData: string): Promise<BillingFormInfo> {
  return (await request('POST', '/carrier/mini-app/billing-form', { initData })) as BillingFormInfo;
}

export interface MoneyCodeDrawRow {
  id: number;
  date: string;
  amount: number;
  used: number;
  status: string;
  reason: string;
  unit: string;
  requestedBy: string;
  validUntil: string;
}

/** Money-code draw history (code values never present). Owner-only. */
export async function fetchMoneyCodeHistory(initData: string, range = 'month'): Promise<{ draws: MoneyCodeDrawRow[] }> {
  return (await request('POST', '/carrier/mini-app/money-code/history', { initData, range })) as { draws: MoneyCodeDrawRow[] };
}

/** C-24 safe-void of one of the carrier's own draws. Owner-only; FF money-code gated. */
export async function voidMoneyCodeDraw(initData: string, requestId: number, reason?: string): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/money-code/void', { initData, requestId, ...(reason ? { reason } : {}) })) as Record<string, unknown>;
}

/** C-10 — raise a fraud hold/release request (a human on the fraud team acts on it). Owner-only. */
export async function sendFraudRequest(
  initData: string,
  cardId: string,
  requestType: 'fraud_hold' | 'fraud_release',
): Promise<Record<string, unknown>> {
  return (await request('POST', '/carrier/mini-app/card/fraud-request', {
    initData,
    cardId,
    request: requestType,
  })) as Record<string, unknown>;
}

export interface MoneyCodePreview {
  eligible?: boolean;
  available?: number | string | null;
  drawn?: number | string | null;
  moneycode_reasons?: string[];
  [k: string]: unknown;
}

/** C-17 step 1 — the drawable window. The backend (ultimately servercrm) owns the limit math. */
export async function fetchMoneyCodePreview(initData: string): Promise<MoneyCodePreview> {
  return (await request('POST', '/carrier/mini-app/money-code/preview', { initData })) as MoneyCodePreview;
}

export interface MoneyCodeDrawResult {
  money_code_amount?: number | string;
  available_after?: number | string | null;
  moneycode_reason?: string;
  [k: string]: unknown;
}

/** C-17 step 2 — draw. The code value is never in the response (delivery happens upstream);
 * report the outcome, not a code. */
export async function drawMoneyCode(
  initData: string,
  draw: { amount: number; unitNumber: string; reason: string },
): Promise<MoneyCodeDrawResult> {
  return (await request('POST', '/carrier/mini-app/money-code/draw', { initData, ...draw })) as MoneyCodeDrawResult;
}

// ── Inbox: news Octane writes + this user's notification history + the live WS feed ──────────
export interface LocalizedNewsText {
  en: string;
  ru?: string;
  uz?: string;
  es?: string;
}
export interface NewsFeedItem {
  id: string;
  title: LocalizedNewsText;
  body: LocalizedNewsText;
  severity: 'info' | 'important';
  pinned: boolean;
  publishAt: string;
  read: boolean;
}
export interface InboxNotification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
  /** Server-persisted per-user read state (absent on older payloads → treated as unread). */
  read?: boolean;
}
export interface InboxFeed {
  news: NewsFeedItem[];
  notifications: InboxNotification[];
}

export async function fetchInboxFeed(initData: string): Promise<InboxFeed> {
  return (await request('POST', '/carrier/mini-app/inbox', { initData })) as InboxFeed;
}

export async function markNewsRead(initData: string, newsId: string): Promise<void> {
  await request('POST', '/carrier/mini-app/inbox/news-read', { initData, newsId });
}

export async function markNotificationRead(initData: string, notificationId: string): Promise<void> {
  await request('POST', '/carrier/mini-app/inbox/notification-read', { initData, notificationId });
}

/** ws(s):// URL for the live inbox feed — the backend's existing realtime hub, entered through
 *  the initData-authenticated mini-app WS route (subscribe-only, own topic). */
export function inboxRealtimeUrl(initData: string): string {
  const { baseUrl } = resolveApiConfig();
  const base = baseUrl || window.location.origin;
  return v1Url(base, '/carrier/mini-app/realtime').replace(/^http/, 'ws') + `?initData=${encodeURIComponent(initData)}`;
}
