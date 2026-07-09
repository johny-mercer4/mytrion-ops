/**
 * Touchpoint key → { params, result } map. Keys MUST match the backend catalog
 * (src/modules/touchpoints/catalog/*) exactly — hand-duplicated per repo convention.
 * Phase 1 types only what the Sales Automations tab consumes; the map grows as more
 * panels get wired (entries are cheap; result interfaces are the bulk).
 *
 * Identity note: user-keyed touchpoints (dashboards, inbox, rosters) take NO identity
 * params from the UI — the backend injects the verified session's Zoho user id.
 */

// ---- result shapes (widget-observed; fields the UI actually renders) ----

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

export interface TrackingResult {
  dealName?: string;
  fedexTracking?: string | null;
  trackingInfo?: Array<{ trackingNumber?: string; startDate?: string; cardsOrdered?: number | string }>;
}

export interface PaymentInfoResult {
  window?: unknown;
  invoices?: { count?: number; totals?: Record<string, number | string | null>; data?: unknown[] };
  payments?: { count?: number; total_amount?: number | string; by_source?: Record<string, unknown>; data?: unknown[] };
}

export interface CmpInvoiceList {
  invoices?: Array<{
    invoiceNumber?: string;
    status?: string;
    totalAmount?: number | string;
    totalPaid?: number | string;
    remainingAmount?: number | string;
    period?: string;
    createdDate?: string;
    id?: string | number;
  }>;
}

export interface SalesInvoicesResult {
  data?: Array<Record<string, unknown>>;
  count?: number;
  summary?: Record<string, unknown>;
}

export interface WexTasksResult {
  wexTasks?: Array<{ sbj?: string; description?: string; createdDate?: string }>;
  dealId?: string;
}

export interface WexApplicationResult {
  appId?: string | number;
  found?: boolean;
  status?: string;
  statusGroup?: string;
  lastModified?: string;
  application?: Record<string, unknown>;
}

export interface CardActionResult {
  previousStatus?: string;
  newStatus?: string;
  cardNumber?: string;
  message?: string;
}

export interface CardLimitsResult {
  limitId?: string;
  previousLimit?: number | string;
  newLimit?: number | string;
  message?: string;
}

export interface EfsCardsResult {
  count?: number;
  data?: Array<{ card_number?: string; status?: string; [k: string]: unknown }>;
}

export interface BillingFormResult {
  deal?: { billingVerification?: string };
  billingForm?: Record<string, unknown> | null;
  notes?: Array<{ title?: string; content?: string; createdTime?: string; createdBy?: string }>;
}

export interface MoneyCodePreview {
  company_name?: string;
  available?: number | string;
  eligible?: boolean;
  drawn?: number | string;
  credit_limit?: number | string;
  billing_cycle_label?: string;
}

export interface MoneyCodeDrawResult {
  money_code_amount?: number | string;
  available_after?: number | string;
  valid_until?: string;
  company_name?: string;
  request_id?: string | number;
}

export interface SignedUrlResult {
  url?: string;
  expiresIn?: number;
}

export interface TransactionsResult {
  totals?: Record<string, number | string | null>;
  data?: Array<Record<string, unknown>>;
  pagination?: Record<string, unknown>;
}

// ---- the key map ----

export interface TouchpointMap {
  'dwh.carrier_balance': { params: { carrierId: string }; result: CarrierBalance };
  'dwh.carrier_overview': { params: { carrierId: string }; result: CarrierOverview };
  'dwh.payment_info': { params: { carrierId: string; days?: number }; result: PaymentInfoResult };
  'dwh.transactions': {
    params: { carrierId: string; range?: string; from?: string; to?: string; limit?: number };
    result: TransactionsResult;
  };
  'dwh.cards': { params: { carrierId: string }; result: EfsCardsResult };
  'dwh.card_activate': { params: { carrierId: string; cardNumber: string }; result: Record<string, unknown> };
  'dwh.money_code': { params: { carrierId: string }; result: MoneyCodePreview };
  'dwh.money_code_draw': {
    params: { carrierId: string; amount: number; moneycode_reason: string };
    result: MoneyCodeDrawResult;
  };
  'carrier.trucking_number_request': { params: { carrierId: string }; result: TrackingResult };
  'carrier.check_payment': { params: { carrierId: string }; result: CmpInvoiceList };
  'carrier.billing_form_info': { params: { carrierId: string }; result: BillingFormResult | string };
  'cards.status': {
    params: { carrierId: string; cardNumber: string; action: 'ACTIVATE' | 'DEACTIVATE' };
    result: CardActionResult;
  };
  'cards.limits': {
    params: {
      carrierId: string;
      cardNumber: string;
      limitId: string;
      limitValue: string;
      action: 'INCREASE' | 'DECREASE';
    };
    result: CardLimitsResult;
  };
  'efs.cards': { params: { carrierId: string }; result: EfsCardsResult };
  'efs.card_info': {
    params: {
      carrierId: string;
      cardNumber: string;
      unitNumber?: string;
      driverId?: string;
      driverName?: string;
    };
    result: Record<string, unknown>;
  };
  'efs.card_override': { params: { carrierId: string; cardNumber: string }; result: CardActionResult };
  'fraud.hold_release': {
    params: {
      companyName: string;
      carrierId: string;
      agentEmail: string;
      cardNumber: string;
      ticketType?: 'fraud_hold' | 'fraud_release';
    };
    result: Record<string, unknown>;
  };
  'application.update': { params: { appId: string }; result: WexTasksResult };
  'wex.application': { params: { appId: string }; result: WexApplicationResult };
  'sales_mytrion.fetch_invoices': {
    params: { carrierId: string; range?: string; status?: string; from?: string; to?: string };
    result: SalesInvoicesResult;
  };
  'sales_mytrion.invoice_signed_url': {
    params: { invoiceId: string; type?: 'pdf' | 'excel' };
    result: SignedUrlResult;
  };
}

export type TouchpointKey = keyof TouchpointMap;
