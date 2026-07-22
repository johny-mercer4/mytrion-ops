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
  /** Current Update — Full Wex Task Field (Deluge `wexTaskField`). */
  wexTaskField?: string;
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

/** One physical money-code draw (batch collapsed). Code value is never returned. */
export interface MoneyCodeRequestRow {
  id: number | string;
  carrier_id?: number | string;
  company_name?: string | null;
  money_code_amount?: number | string | null;
  code_total?: number | string | null;
  batch_rows?: number | string | null;
  invoice_ids?: unknown;
  billing_type?: string | null;
  valid_until?: string | null;
  status?: string | null;
  requested_by?: string | null;
  moneycode_reason?: string | null;
  unit_number?: string | null;
  created_at?: string | null;
  voided_at?: string | null;
  void_reason?: string | null;
  has_code?: boolean;
  notified_at?: string | null;
  notify_error?: string | null;
  [k: string]: unknown;
}

export interface MoneyCodeRequestsResult {
  success?: boolean;
  data?: MoneyCodeRequestRow[];
  more_records?: boolean;
  page?: number;
  limit?: number;
}

export interface MoneyCodeVoidResult {
  success?: boolean;
  outcome?:
    | 'voided'
    | 'already_voided_synced'
    | 'never_issued_voided'
    | 'noop_not_issued'
    | 'used_not_voided'
    | string;
  record?: MoneyCodeRequestRow;
  message?: string;
  efs?: { amount?: number | string; numUses?: number | string };
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
    /** Optional day-grain per-carrier feed — enables activity day drilldown. */
    dailyTransactionsByCarrier?: Array<Record<string, unknown>>;
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
  /** Deluge sometimes returns the string `"true"` / `"false"`. */
  success?: boolean | string;
  leadId?: string | number;
  message?: string;
  response?: unknown;
  code?: string;
  details?: { id?: string | number };
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
  /** Local Ops DB ledger (`money_code_requests`) — own draws only. */
  'money_code.list': {
    params: {
      page?: number;
      limit?: number;
      search?: string;
      status?: 'ISSUED' | 'VOIDED' | 'USED';
      carrierId?: string;
    };
    result: MoneyCodeRequestsResult;
  };
  /** Own-only void; EFS-safe path via ServerCRM, writes back to Ops DB. */
  'money_code.void': {
    params: { requestId: number; reason?: string };
    result: MoneyCodeVoidResult;
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
  'browser.boca': {
    params: {
      appId: string;
      assignedTo?: string;
      priority?: '' | 'High' | 'Normal' | 'Low';
      dueDate?: string;
      status?: string;
    };
    result: {
      success?: boolean;
      action?: string;
      status?: string;
      reason?: string;
      message?: string;
      error?: string;
    };
  };
  'browser.close_application': {
    params: {
      appId: string;
      assignedTo?: string;
      priority?: '' | 'High' | 'Normal' | 'Low';
      dueDate?: string;
      status?: string;
    };
    result: {
      success?: boolean;
      action?: string;
      status?: string;
      reason?: string;
      message?: string;
      error?: string;
    };
  };
  'zapier.ticket_email': {
    params: {
      companyName: string;
      carrierId: string;
      agentEmail: string;
      ticketType: 'replacement' | 'reactivation';
      companyAddress?: string;
      address?: string;
      city?: string;
      state?: string;
      zip?: string;
    };
    result: { status?: string; message?: string; error?: string };
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
  // The transaction/return WRITES (map/top-up/sync/split/unmap, carrier.saveMemory, returns.match) and
  // the list/search/fuzzy/memory READS moved to Postgres-backed REST routes (see api/billing.ts). Only
  // billing.invoices.search (CMP) + billing.carrier.type (Zoho) + the DWH/prepay reads remain here.
  'billing.invoices.search': { params: { carrierId: string }; result: BillingInvoicesResult };
  'billing.datacenter.deals': { params: { fresh?: '0' | '1' }; result: BillingDealsResult };
  'billing.debtors.list': { params: { fresh?: '0' | '1' }; result: BillingDebtorsResult };
  'billing.datacenter.avgDays': { params: { carrierId: string }; result: Record<string, unknown> };
  'billing.carrier.type': { params: { carrierId: string }; result: Record<string, unknown> };
  // Prepay reads migrated to PG-backed REST (/v1/billing/prepay/*, see api/billing.ts).

  // ---- Retention Phase 1 (Sales Mytrion — local DB handlers) ----
  'retention.my_cases': {
    params: { open?: boolean; phase_code?: string; limit?: number };
    result: RetentionCasesListResult;
  };
  'retention.case_get': {
    params: { caseId: string };
    result: RetentionCaseDetailResult;
  };
  'retention.case_contact': {
    params: { caseId: string };
    result: { contactPhone: string | null };
  };
  'retention.record_outcome': {
    params: {
      caseId: string;
      outcome: RetentionPhase1Outcome;
      dissatisfaction_reason?: RetentionDissatisfactionReason;
      reason_note?: string;
    };
    result: { case: RetentionCaseRow };
  };
  'retention.log_attempt': {
    params: {
      caseId: string;
      channel: RetentionChannel;
      notes?: string;
      evidence_url?: string;
    };
    result: { case: RetentionCaseRow };
  };
  'retention.pool_list': {
    params: { limit?: number };
    result: RetentionCasesListResult;
  };
  'retention.pool_claim': {
    params: { caseId: string; reason: string };
    result: { case: RetentionCaseRow; pendingApproval: boolean };
  };
  'retention.pool_quota': {
    params: Record<string, never>;
    result: { used: number; max: number; remaining: number };
  };
  'retention.lookups': {
    params: { phase_code?: string };
    result: RetentionLookupsResult;
  };
  'retention.cs_pool_activity': {
    params: { limit?: number; status?: 'approved' | 'expired' | 'all' };
    result: { rows: RetentionPoolActivityRow[]; total: number };
  };
  'retention.cs_cases': {
    params: {
      filter?:
        | 'all_open'
        | 'all'
        | 'sales'
        | 'retention'
        | 'citi'
        | 'new'
        | 'working'
        | 'closed';
      phase?: 'any' | 'sales' | 'retention' | 'citi';
      status?:
        | 'open'
        | 'closed'
        | 'all'
        | 'to_claim'
        | 'working'
        | 'offer_pending'
        | 'calling'
        | 'reached'
        | 'out_of_reach'
        | 'open_pool'
        | 'vacation'
        | 'hold'
        | 'review';
      limit?: number;
    };
    result: RetentionCasesListResult;
  };
  'retention.cs_desk_quota': {
    params: { zohoUserId?: string };
    result: {
      zohoUserId: string;
      assignedToday: number;
      maxPerDay: number;
      pending: number;
      open: number;
      pendingRatio: number;
      maxPendingRatio: number;
      canClaim: boolean;
      canMarkPending: boolean;
    };
  };
  'retention.cs_case_get': {
    params: { caseId: string };
    result: RetentionCaseDetailResult;
  };
  'retention.cs_case_outcome': {
    params: {
      caseId: string;
      outcome:
        | 'claim'
        | 'start_working'
        | 'mark_pending'
        | 'saved'
        | 'refused'
        | 'out_of_business'
        | 'escalate_citi';
      notes?: string;
    };
    result: { case: RetentionCaseRow };
  };
  'retention.cs_log_attempt': {
    params: {
      caseId: string;
      channel: RetentionChannel;
      notes?: string;
      evidence_url?: string;
      call_role?: 'listen' | 'solution';
    };
    result: { case: RetentionCaseRow };
  };
  'retention.cs_citi_list': {
    params: { limit?: number; status_code?: string };
    result: RetentionCasesListResult;
  };
  'retention.cs_citi_confirm': {
    params: { caseIds: string[] };
    result: { updated: RetentionCaseRow[]; skipped: number };
  };
  'retention.cs_citi_export': {
    params: { caseIds: string[] };
    result: {
      csv: string;
      exported: number;
      zohoFailures: Array<{ caseId: string; error: string }>;
    };
  };
  'retention.cs_citi_mark_sent': {
    params: { caseIds: string[] };
    result: { closed: RetentionCaseRow[]; skipped: number };
  };

  // ---- Finance (ServerCRM) ----
  'finance.analytics_fueling': {
    params: Record<string, unknown>;
    result: FinanceAnalyticsFuelingResult;
  };
  'finance.debtors': {
    params: Record<string, unknown>;
    result: FinanceDebtorsResult;
  };
  'finance.main_transactions': {
    params: Record<string, unknown>;
    result: FinanceTransactionsResult;
  };
  'finance.clients': {
    params: Record<string, unknown>;
    result: FinanceClientsResult;
  };
  'finance.client_invoices': {
    params: { carrierId: string; limit?: number };
    result: Record<string, unknown>;
  };
  'finance.client_payments': {
    params: { carrierId: string; limit?: number };
    result: Record<string, unknown>;
  };
  'finance.client_recent_transactions': {
    params: { carrierId: string; limit?: number };
    result: Record<string, unknown>;
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

// ---- Finance result shapes ----
export interface FinanceDebtorsResult {
  debtors?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface FinanceTransactionsResult {
  records?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface FinanceClientsResult {
  clients?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

export interface FinanceAnalyticsFuelingResult {
  fueling?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

// ---- Retention Phase 1 result shapes ----

export type RetentionChannel =
  | 'telegram'
  | 'whatsapp'
  | 'sms'
  | 'ringcentral'
  | 'instagram'
  | 'facebook'
  | 'email';

export type RetentionDissatisfactionReason =
  | 'low_discounts'
  | 'payment_cycle'
  | 'cs_service'
  | 'trust_issues'
  | 'switched_other';

/** Agent-selectable outcomes — Returned is sync-only; Working starts on case create. */
export type RetentionPhase1Outcome =
  | 'reached'
  | 'out_of_reach'
  | 'dissatisfied'
  | 'vacation'
  | 'no_action_2bd'
  | 'escalate_retention'
  | 'send_to_open_pool'
  | 'ops_confirm_vacation'
  | 'ops_deny_vacation';

export interface RetentionCaseRow {
  id: string;
  carrierId: string;
  zohoDealId: string | null;
  companyName: string | null;
  applicationId: string | null;
  agentName: string | null;
  /** Denormalized DWH phone at sync — prefer over lazy case_contact. */
  contactPhone?: string | null;
  preferredLanguage?: string | null;
  isSpanishDesk?: boolean;
  phaseCode: string;
  statusCode: string;
  phaseChangedAt: string;
  transactionFrequency: 'high' | 'medium' | 'low' | null;
  agentOutcome: string | null;
  dissatisfactionReason: RetentionDissatisfactionReason | null;
  reasonNote: string | null;
  assignedAgentZohoUserId: string | null;
  poolOwnerZohoUserId: string | null;
  pendingClaimantZohoUserId: string | null;
  assignmentCount: number;
  openPoolAttemptCount: number;
  /** Times Retention 10 BD expiry returned this case to Open Pool (max 3 → CITI). */
  retentionToPoolCount?: number;
  outOfReachAttempts: number;
  dealOwnerChanged: boolean;
  currentDeadlineAt: string | null;
  currentDeadlineType: string | null;
  vacationCountdownEnd: string | null;
  citiFolderEnteredAt: string | null;
  citiFolderHoldUntil: string | null;
  lastReviewCycleAt: string | null;
  salesManagerZohoUserId: string | null;
  thresholdDays: number | null;
  lastTransactionAt: string | null;
  daysInactive: number | null;
  txCount90d: number | null;
  gallons90d: number | null;
  activeCards: number | null;
  source: 'auto' | 'manual';
  lastSyncedAt: string | null;
  closedAt: string | null;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

/** CS Open Pool activity log — claimed + unclaimed audit rows. */
export interface RetentionPoolActivityRow {
  id: string;
  kind: 'claimed' | 'unclaimed';
  status: string;
  caseId: string;
  carrierId: string;
  zohoDealId: string | null;
  companyName: string | null;
  requesterZohoUserId: string;
  requesterName: string | null;
  reason: string;
  outcomeNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

/** @deprecated Prefer RetentionPoolActivityRow — legacy claim queue shape. */
export interface RetentionPendingClaimRow extends RetentionCaseRow {
  claimRequestId: string;
  claimReason: string;
  claimRequesterName: string | null;
  claimRequestedAt: string;
}

export interface RetentionCaseEventRow {
  id: string;
  caseId: string;
  fromStatus: string | null;
  toStatus: string;
  eventType: string;
  actorZohoUserId: string | null;
  channel: RetentionChannel | null;
  notes: string | null;
  evidenceUrl: string | null;
  occurredAt: string;
}

export interface RetentionCasesListResult {
  cases: RetentionCaseRow[];
  total: number;
}

export interface RetentionCaseDetailResult {
  case: RetentionCaseRow;
  events: RetentionCaseEventRow[];
  /** DWH dim_company contact phone — for RingCentral click-to-dial. */
  contactPhone?: string | null;
}

export interface RetentionLookupsResult {
  phases: Array<{ code: string; label: string; sortOrder: number }>;
  statuses: Array<{
    code: string;
    phaseCode: string;
    label: string;
    isTerminal: boolean;
    boardColumn: string | null;
    sortOrder: number;
  }>;
  channels: RetentionChannel[];
  dissatisfactionReasons: RetentionDissatisfactionReason[];
  outcomes: RetentionPhase1Outcome[];
}

export type TouchpointKey = keyof TouchpointMap;
