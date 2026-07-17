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

// ---- panel result shapes (user-keyed touchpoints; identity is server-injected) ----

/** mytrionhomesnapshot — arrives as {snapshot, brief_context} or a 1-element array of it. */
export interface HomeSnapshotFields {
  active_clients?: number;
  inactive_clients?: number;
  stuck_deals_count?: number;
  total_debt_amount?: number;
  total_debtors?: number;
  total_hard_debtors?: number;
  swipes_this_week?: number;
  swipes_trend?: string;
  gallons_this_week?: number;
  gallons_trend?: string;
  new_cards_this_week?: number;
  new_cards_trend?: string;
  swipes_today?: number;
  gallons_today?: number;
  new_cards_today?: number;
  [k: string]: unknown;
}
export type HomeSnapshotResult =
  | { snapshot?: HomeSnapshotFields; brief_context?: string }
  | Array<{ snapshot?: HomeSnapshotFields; brief_context?: string }>;

export interface ZohoAnnouncement {
  Type?: string;
  Subject?: string;
  Name?: string;
  Content?: string;
  Priority?: string;
  Created_Time?: string;
}

export interface InboxListResult {
  status?: string;
  messages?: Array<{
    id?: string | number;
    recordId?: string | number;
    type?: string;
    priority?: string;
    subject?: string;
    name?: string;
    content?: string;
    createdTime?: string;
    tag?: string;
    sourceUrl?: string;
    ownerId?: string | number;
  }>;
}

export interface DatacenterLead {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  lead_source?: string;
  utm_source?: string;
  lead_status?: string;
  application_id?: string | number;
  created_time?: string;
  company?: string;
}
export interface DatacenterLeadsResult {
  converted?: DatacenterLead[];
  unconverted?: DatacenterLead[];
}

export interface ByAgentClientRow {
  carrier_id?: number | string;
  company_name?: string;
  deal_stage?: string;
  payment_terms?: string | null;
  credit_limit?: number | string | null;
  balance?: number | string | null;
  prepay_balance?: number | string | null;
  computed_is_active?: boolean | number | string | null;
  is_loc_suspended?: boolean | number | string | null;
  computed_debt?: number | string | null;
  computed_debt_days?: number | string | null;
  overdue_invoices_count?: number | string | null;
  dot?: number | string | null;
  [k: string]: unknown;
}

export interface AgentActivityResult {
  success?: boolean;
  resolved_by?: string;
  range?: { from?: string; to?: string; days_in_range?: number };
  metrics?: Record<string, { count?: number; completed?: number; total_duration_sec?: number; error?: string; [k: string]: unknown }>;
  averages?: Record<string, number>;
}

export interface LeaderboardRow {
  rank?: number;
  agent_name?: string;
  deal_count?: number;
  value_total?: number;
  value_avg?: number;
  zoho_user_id?: string | number;
}
export interface LeaderboardResult {
  success?: boolean;
  /** servercrm returns the rows under `leaderboard` (verified live). */
  leaderboard?: LeaderboardRow[];
  data?: LeaderboardRow[];
  current_agent?: { zoho_user_id?: string | number; rank?: number; found_in_top?: boolean };
}

/** mytrionAgentSalesDashboard — {success, data:{cycle,kpi,cardsByCompany,dailyActivity,transactions}} */
export interface SalesDashboardResult {
  success?: boolean;
  data?: {
    cycle?: { start?: string; end?: string };
    kpi?: Record<string, number | string | null>;
    cardsByCompany?: Array<Record<string, unknown>>;
    dailyActivity?: Array<Record<string, unknown>>;
    cardActivity?: Array<Record<string, unknown>>;
    transactions?: Array<Record<string, unknown>>;
  };
  error?: string;
}

export interface CompanyDashboardResult {
  status?: string;
  data?: {
    as_of?: string;
    week_start?: string;
    fills_today?: number;
    fills_this_week?: number;
    fills_this_month?: number;
    gallons_today?: number;
    gallons_this_week?: number;
    gallons_this_month?: number;
    [k: string]: unknown;
  };
}

export interface DebtorsResult {
  debtors?: Array<{
    carrier_id?: number | string;
    deal_name?: string;
    company_name?: string;
    is_hard_debtor?: boolean;
    worst_status?: string;
    total_remaining?: number;
    total_paid?: number;
    total_owed?: number;
    invoice_count?: number;
    max_debt_days?: number;
    invoices?: Array<Record<string, unknown>>;
    [k: string]: unknown;
  }>;
  total_debtors?: number;
  total_hard_debtors?: number;
  total_debt_amount?: number;
}

export interface CarrierSearchRow {
  id?: string | number;
  dot_number?: string | number;
  owner_full_name?: string;
  phone_number?: string;
  email?: string;
  operating_status?: string;
  power_units?: number | string;
  physical_address?: string;
  truck_size?: string;
  add_date?: string;
  change_date?: string;
}
export interface CarrierSearchResult {
  success?: boolean;
  carriers?: CarrierSearchRow[];
  total?: number;
  more_records?: boolean;
  message?: string;
}

/** mytrioncreatelead — permissive: the UI inspects success/leadId/response (DUPLICATE_DATA). */
export interface CreateLeadResult {
  success?: boolean;
  leadId?: string | number;
  message?: string;
  response?: unknown;
}

export interface CreateEscalationResult {
  ticketId?: string | number;
  escalationId?: string | number;
  message?: string;
}

export interface TransactionsResult {
  totals?: Record<string, number | string | null>;
  data?: Array<Record<string, unknown>>;
  pagination?: Record<string, unknown>;
  range?: { from?: string; to?: string };
}

export interface TransactionInvoicesResult {
  data?: Array<{ transaction_id?: string | number; invoice_ref?: string | number }>;
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
  'dwh.transaction_invoices': {
    params: { carrierId: string; range?: string; from?: string; to?: string };
    result: TransactionInvoicesResult;
  };
  'dwh.cards': { params: { carrierId: string }; result: EfsCardsResult };
  'dwh.card_activate': { params: { carrierId: string; cardNumber: string }; result: Record<string, unknown> };
  'dwh.money_code': { params: { carrierId: string }; result: MoneyCodePreview };
  'dwh.money_code_draw': {
    params: {
      carrierId: string;
      amount: number;
      moneycode_reason: string;
      /** Forwarded to ServerCRM when present (unit the code is for). */
      unit_number?: string;
    };
    result: MoneyCodeDrawResult;
  };
  'dwh.cards_last_used': {
    params: { carrierId: string; range?: string };
    result: { data?: Array<Record<string, unknown>>; count?: number; [k: string]: unknown };
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
  'wex.applications_search': {
    params: {
      appId?: string;
      firstName?: string;
      lastName?: string;
      company?: string;
      email?: string;
      phone?: string;
      mc?: string;
      dot?: string;
    };
    result: { data?: Array<Record<string, unknown>>; applications?: Array<Record<string, unknown>>; count?: number };
  };
  'sales_mytrion.fetch_invoices': {
    params: { carrierId: string; range?: string; status?: string; from?: string; to?: string };
    result: SalesInvoicesResult;
  };
  'sales_mytrion.invoice_signed_url': {
    params: { invoiceId: string; type?: 'pdf' | 'excel' };
    result: SignedUrlResult;
  };
  // ---- panel touchpoints (identity server-injected; params are empty or filters only) ----
  'dashboard.home_snapshot': { params: Record<string, never>; result: HomeSnapshotResult };
  'inbox.announcements': { params: Record<string, never>; result: ZohoAnnouncement[] | ZohoAnnouncement };
  'inbox.list': { params: Record<string, never>; result: InboxListResult };
  'inbox.delete_message': { params: { recordId: string }; result: unknown };
  'leads.datacenter': { params: Record<string, never>; result: DatacenterLeadsResult };
  'clients.by_agent': { params: Record<string, never>; result: { success?: boolean; data?: ByAgentClientRow[] } };
  'clients.recent_transactions': {
    params: { carrierId: string; limit?: number };
    result: { success?: boolean; data?: Array<Record<string, unknown>>; count?: number };
  };
  'activity.agent': { params: { range?: 'daily' | 'weekly' | 'monthly' }; result: AgentActivityResult };
  'activity.leaderboard': {
    params: { range?: string; limit?: number; metric?: 'value_total' | 'deal_count' | 'value_avg' };
    result: LeaderboardResult;
  };
  'dashboard.agent_sales': {
    params: { startDate?: string; endDate?: string };
    result: SalesDashboardResult;
  };
  'dashboard.company': { params: Record<string, never>; result: CompanyDashboardResult };
  'dashboard.debtors': { params: Record<string, never>; result: DebtorsResult };
  'sales.carriers_search': { params: { query: string; limit?: number }; result: CarrierSearchResult };
  'leads.create': {
    params: { createPayload: Record<string, string> };
    result: CreateLeadResult;
  };
  'tickets.create_escalation': {
    params: { escalationReason: string; questionSubject: string; description: string; attachmentUrl?: string };
    result: CreateEscalationResult;
  };
  // ---- Customer Service (departmentAccess: ['customer-service'] — use api/cs.ts csTouchpoint) ----
  'cs.home.metrics': { params: Record<string, never>; result: CsHomeMetrics };
  'cs.applications.list': {
    params: { tab: 'apps' | 'clients'; search?: string; page?: number; perPage?: number };
    result: CsApplicationsList;
  };
  'cs.analytics.maintenance': {
    params: { fromDate: string; toDate: string; prevFromDate: string; prevToDate: string };
    result: CsMaintenanceAnalytics;
  };
  'cs.datacenter.deals': {
    params: { lastSyncTime?: string };
    result: CsDataCenterDeals;
  };
  // ---- Billing (departmentAccess: ['billing'] — use api/billing.ts billingTouchpoint) ----
  // mappedBy/unmappedBy are injected server-side from the session; the UI never sends them.
  'billing.transactions.list': {
    params: { page: number; limit?: number };
    result: BillingTransactionsPage;
  };
  'billing.transactions.search': { params: { query: string }; result: BillingTransactionsPage };
  'billing.invoices.search': { params: { carrierId: string }; result: BillingInvoicesResult };
  'billing.carrier.fuzzy': {
    params: { senderName?: string; description?: string; email?: string };
    result: BillingFuzzyResult;
  };
  'billing.carrier.memory': { params: Record<string, never>; result: BillingMemoryResult };
  'billing.transactions.mapInvoice': {
    params: {
      invoiceId: string;
      invoiceNumber: string;
      paymentAmount: number;
      paymentDate: string;
      note?: string;
      transactionRecordId: string;
      type: BillingTxType;
      carrierId: string;
    };
    result: BillingWriteResult;
  };
  'billing.transactions.topUp': {
    params: {
      carrierId: string;
      paymentAmount: number;
      paymentDate: string;
      note?: string;
      transactionRecordId: string;
      type: BillingTxType;
    };
    result: BillingWriteResult;
  };
  'billing.transactions.syncCrmOnly': {
    params: {
      transactionRecordId: string;
      type: BillingTxType;
      carrierId: string;
      invoiceNumber?: string;
    };
    result: BillingWriteResult;
  };
  'billing.transactions.applySplits': {
    params: { transactionRecordId: string; type: BillingTxType; splitsJson: string };
    result: BillingWriteResult;
  };
  'billing.transactions.unmap': {
    params: { transactionRecordId: string; type: BillingTxType; clearCrm?: 'true' | 'false' };
    result: BillingWriteResult;
  };
  'billing.carrier.saveMemory': {
    params: { companyName: string; carrierId: string };
    result: BillingWriteResult;
  };
  'billing.datacenter.deals': { params: { fresh?: '0' | '1' }; result: BillingDealsResult };
  'billing.debtors.list': { params: { fresh?: '0' | '1' }; result: BillingDebtorsResult };
  'billing.datacenter.avgDays': { params: { carrierId: string }; result: Record<string, unknown> };
  'billing.carrier.type': { params: { carrierId: string }; result: Record<string, unknown> };
  // Prepay (Phase 2)
  'billing.prepay.companies': {
    params: { startDate: string; endDate: string; fresh?: '0' | '1' };
    result: BillingPrepayCompanies;
  };
  'billing.prepay.rmve': {
    params: { carrierIds: string; startDate: string; endDate: string; fresh?: '0' | '1' };
    result: Record<string, unknown>;
  };
  'billing.prepay.ledger': {
    params: { carrierId: string; startDate: string; endDate: string };
    result: BillingPrepayLedger;
  };
  // Returns (Phase 2) — matchedBy injected server-side; UI never sends it.
  'billing.returns.list': { params: { page: number; limit?: number }; result: BillingReturnsPage };
  'billing.returns.candidates': {
    params: { query?: string; amount?: string; beforeDate?: string; customerName?: string };
    result: BillingReturnCandidates;
  };
  'billing.returns.match': {
    params: { returnRecordId: string; transactionRecordId: string };
    result: BillingWriteResult;
  };
}

// ---- Customer Service result shapes (widget-observed; legitimately-sparse fields optional) ----

export interface CsRecentApp {
  id?: string;
  Name?: string;
  Application_IDD?: string;
  Stage?: string;
  Status?: string;
  Modified_Time?: string;
  Last_Modified_Date?: string;
}

export interface CsHomeMetrics {
  status?: string;
  pendingApps?: number | string;
  activeClients?: number | string;
  maintenanceCases?: number | string;
  myPendingApps?: number | string;
  myClients?: number | string;
  recentApps?: CsRecentApp[];
}

/** One enriched Applications row (mytrionGetApplications select list + Deal enrichment). */
export type CsApplicationRow = Record<string, unknown>;

export interface CsApplicationsList {
  status?: string;
  data?: CsApplicationRow[];
  more_records?: boolean;
  page?: number | string;
  per_page?: number | string;
}

export interface CsMaintenanceAnalytics {
  success?: boolean;
  data?: {
    totals?: {
      current?: number;
      previous?: number;
      closed?: number;
      halfComplete?: number;
      fullComplete?: number;
      open?: number;
    };
    daily?: Array<{ day?: string; count?: number }>;
    byStatus?: Array<{ status?: string; count?: number }>;
    byOwner?: Array<{ id?: string; name?: string; count?: number }>;
  };
}

export interface CsDataCenterDeal {
  id?: string;
  Deal_Name?: string;
  Stage?: string;
  Amount?: number | string;
  Carrier_ID?: string;
  Payment_Type_Billing?: string;
  Billing_Cycle?: string;
  Billing_Verification?: string | boolean;
  Closing_Date?: string;
  Created_Time?: string;
  Application_Date?: string;
  Modified_Time?: string;
  [key: string]: unknown;
}

export interface CsDataCenterDeals {
  status?: string;
  total_deals?: number;
  deals?: CsDataCenterDeal[];
  is_delta?: boolean;
}

// ---- Billing result shapes (loose — the panels map the raw widget payloads) ----

/** Transaction source `type` as the Deluge functions expect it (BM_TX_SOURCES). */
export type BillingTxType = 'Zelle' | 'Chase' | 'Mx_Merchant' | 'Stripe' | 'ACH' | 'Wire' | 'Check' | 'Card';

/** Paged transaction fetch — the widget reads `transactions` + `hasMore`/`totals`. */
export interface BillingTransactionsPage {
  transactions?: Array<Record<string, unknown>>;
  records?: Array<Record<string, unknown>>;
  hasMore?: boolean;
  more_records?: boolean;
  page?: number;
  totals?: Record<string, number | string | null>;
  [k: string]: unknown;
}

export interface BillingInvoicesResult {
  invoices?: Array<Record<string, unknown>>;
  prepay?: Record<string, unknown> | null;
  [k: string]: unknown;
}

export interface BillingFuzzyResult {
  matches?: Array<Record<string, unknown>>;
  carrierId?: string | number | null;
  [k: string]: unknown;
}

export interface BillingMemoryResult {
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

/** Every mapping write returns {status:'success'|'partial'|'error', message?, …} (widget parity). */
export interface BillingWriteResult {
  status?: 'success' | 'partial' | 'error' | string;
  message?: string;
  paymentId?: string | number;
  topUpId?: string | number;
  appliedCount?: number;
  reversed?: unknown[];
  [k: string]: unknown;
}

/** DWH deals feed — array under `deals`/`data`, or a bare array. */
export interface BillingDealsResult {
  deals?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface BillingDebtorsResult {
  debtors?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface BillingPrepayCompanies {
  companies?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface BillingPrepayLedger {
  rows?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  totals?: Record<string, number | string | null>;
  [k: string]: unknown;
}

export interface BillingReturnsPage {
  returns?: Array<Record<string, unknown>>;
  records?: Array<Record<string, unknown>>;
  hasMore?: boolean;
  has_more?: boolean;
  page?: number;
  [k: string]: unknown;
}

export interface BillingReturnCandidates {
  status?: string;
  records?: Array<Record<string, unknown>>;
  mode?: string;
  message?: string;
  [k: string]: unknown;
}

export type TouchpointKey = keyof TouchpointMap;
