/**
 * Billing Mytrion client (/v1/billing/* + the billing.* touchpoints). Every touchpoint call
 * pins departmentAccess to ['billing'] (the generic client defaults to sales); the deal-billing
 * edit is a REST write that carries the legacy department header. Mirrors api/cs.ts.
 */
import { request, requestBlob, requestMultipart } from './transport';
import { callTouchpoint } from './touchpoints';
import type {
  CarrierOpeningsResponse,
  ClientTypeBookResponse,
  ClientTypeOverrideResult,
  ClientTypeOverrideWire,
  ClientTypeResolution,
  LedgerClientType,
  LedgerImportBatchSummaryWire,
  LedgerImportChangeKind,
  LedgerImportCommitResult,
  LedgerImportPreviewResponse,
  LedgerImportRowsPage,
  LedgerImportVerdict,
  LedgerArAgingResponse,
  LedgerControlSumsResponse,
  LedgerPaymentsResponse,
  LedgerSectionId,
  LedgerSectionResponse,
  LedgerSectionsResponse,
  LedgerStatementResponse,
  LedgerSummaryResponse,
  LedgerUnbilledAgingResponse,
  LedgerUntoppedAgingResponse,
  LedgerVariancesResponse,
  OpeningBalancesPage,
  OpeningCoverageResponse,
  OpeningHistoryResponse,
  OpeningRevertResult,
  OpeningUpsertResult,
} from './ledgerTypes';
import type {
  BillingFuzzyResult,
  BillingInvoicesResult,
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

/**
 * A ledger read that legitimately takes a while.
 *
 * The transport's 20s default is tuned for row lookups. A section or statement request aggregates the
 * whole in-scope carrier book across seven warehouse queries and rolls each carrier's opening balance
 * forward — measured around 1s from a machine next to the database, but several times that over a WAN
 * to the managed instance, and occasionally past 20s. Failing a correct-but-slow analytical query with
 * "the backend took too long" is worse than waiting for it, so these get their own budget. The same
 * reasoning already applies to `requestMultipart`, which defaults to 45s.
 *
 * The durable fix is the nightly snapshot table, which makes a period O(1) — until that has run in an
 * environment, this is the live path.
 */
const LEDGER_SLOW_TIMEOUT_MS = 60_000;

function billingGetSlow<T>(path: string): Promise<T> {
  return request('GET', path, {
    headers: BILLING_HEADERS,
    timeoutMs: LEDGER_SLOW_TIMEOUT_MS,
  }) as Promise<T>;
}

/** Paged payment ledger (newest first). */
/** Server-side list filters. Applied in Postgres so a filter reaches records beyond the loaded
 *  page(s) — e.g. Chase txns that are older than the newest 200 and wouldn't be in memory yet. */
export interface TxListFilters {
  source?: 'mx' | 'zelle' | 'chase' | 'stripe';
  isMapped?: boolean;
}

export function fetchTransactions(
  page: number,
  limit: number,
  filters: TxListFilters = {},
): Promise<BillingTransactionsPage> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.source) qs.set('source', filters.source);
  if (filters.isMapped !== undefined) qs.set('isMapped', String(filters.isMapped));
  return billingGet(`/billing/transactions?${qs.toString()}`);
}

/** Full-dataset text search. */
export function searchTransactions(query: string): Promise<BillingTransactionsPage> {
  return billingGet(`/billing/transactions/search?query=${encodeURIComponent(query)}`);
}

/** Last-365-day invoices for a carrier (the mapping picker) — CMP read via servercrm.
 *  `withPaymentDates` additionally resolves each PAID/PARTIALLY_PAID invoice's payment date — costs
 *  extra CMP calls, so only Data Center's detail modal passes it. */
export function searchCarrierInvoices(
  carrierId: string,
  opts?: { withPaymentDates?: boolean },
): Promise<BillingInvoicesResult> {
  const qs = opts?.withPaymentDates ? '&withPaymentDates=1' : '';
  return billingGet(`/billing/invoices/search?carrierId=${encodeURIComponent(carrierId)}${qs}`);
}

export interface BillingTxStats {
  total: number;
  mapped: number;
  unmapped: number;
  totalAmount: number;
  bySource: Record<string, number>;
}

/** Whole-dataset transaction aggregates (source counts + mapped/total) — pagination-independent. */
export function fetchTransactionStats(): Promise<BillingTxStats> {
  return billingGet('/billing/transactions/stats');
}

/** Paged returns / chargebacks queue. */
export function fetchReturns(page: number, limit: number): Promise<BillingReturnsPage> {
  return billingGet(`/billing/returns?page=${page}&limit=${limit}`);
}

/** Candidate original payments for manually matching a return. `returnId` lets the server derive
 *  which payment rail is eligible (MX vs Stripe) from the return itself — never send a rail/source
 *  directly, the server owns that decision. */
export function searchReturnCandidates(p: {
  returnId?: string;
  query?: string;
  amount?: string;
  beforeDate?: string;
  customerName?: string;
}): Promise<BillingReturnCandidates> {
  const qs = new URLSearchParams();
  if (p.returnId) qs.set('returnId', p.returnId);
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

/** Deferred prepay externals (EFS money codes + Zoho Maintenance + CMP Stripe) — the slow source,
 *  loaded in the background after the companies list renders and patched into rows. */
export function fetchPrepayExternals(startDate: string, endDate: string): Promise<Record<string, unknown>> {
  return billingGet(
    `/billing/prepay/externals?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
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

export interface ManualChaseInput {
  amount: number;
  postingDate: string; // yyyy-mm-dd
  senderName?: string | undefined;
  description?: string | undefined;
  reference?: string | undefined;
  memo?: string | undefined;
}

/** Manually add a Chase transaction (Chase has no email/API feed) → lands unmapped in PG. */
export function addManualChaseTransaction(
  body: ManualChaseInput,
): Promise<{ status: string; sourceRecordId?: string; message?: string }> {
  return request('POST', '/billing/transactions/manual', { headers: BILLING_HEADERS, body }) as Promise<{
    status: string;
    sourceRecordId?: string;
    message?: string;
  }>;
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

// ---- Billing Ledger (/v1/billing/ledger/*) ----
// Reads and writes for the AR accounting module. Unlike the mapping writes above, these THROW an
// ApiError on failure instead of returning a `{status:'error'}` envelope — the ledger is new, so it
// uses the modern convention rather than the legacy widget-parity one. See api/ledgerTypes.ts.

/** The section catalog. Drives the Ledger sub-nav so the client keeps no parallel list. */
export function fetchLedgerSections(): Promise<LedgerSectionsResponse> {
  return billingGet('/billing/ledger/sections');
}

/** Saved opening balances (live revisions only), paged. */
export function fetchOpeningBalances(
  page: number,
  limit: number,
  filters: { section?: LedgerSectionId; carrierId?: string } = {},
): Promise<OpeningBalancesPage> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.section) qs.set('section', filters.section);
  if (filters.carrierId) qs.set('carrierId', filters.carrierId);
  return billingGet(`/billing/ledger/opening-balances?${qs.toString()}`);
}

/**
 * One carrier's identity + live openings — the manual-entry lookup. Resolves (never throws) for an
 * unknown or out-of-scope carrier: `found:false` plus a `reason` the modal turns into a message.
 */
export function fetchCarrierOpenings(carrierId: string): Promise<CarrierOpeningsResponse> {
  return billingGet(`/billing/ledger/opening-balances/${encodeURIComponent(carrierId)}`);
}

export function fetchOpeningHistory(
  carrierId: string,
  section?: LedgerSectionId,
): Promise<OpeningHistoryResponse> {
  const qs = section ? `?section=${encodeURIComponent(section)}` : '';
  return billingGet(`/billing/ledger/opening-balances/${encodeURIComponent(carrierId)}/history${qs}`);
}

/** Migration progress per section (recorded vs eligible carriers). */
export function fetchOpeningCoverage(): Promise<OpeningCoverageResponse> {
  return billingGet('/billing/ledger/opening-balances-coverage');
}

/**
 * Save one opening balance. `expectedRevisionId` is the live revision the agent was looking at —
 * the server 409s (`LEDGER_OB_STALE`) rather than overwriting someone else's correction.
 */
export function saveOpeningBalance(body: {
  carrierId: string;
  section: LedgerSectionId;
  asOfDate: string;
  amount: number;
  note?: string;
  expectedRevisionId?: string | null;
}): Promise<OpeningUpsertResult> {
  return request('POST', '/billing/ledger/opening-balances', {
    headers: BILLING_HEADERS,
    body,
  }) as Promise<OpeningUpsertResult>;
}

/** Restore a superseded revision as a NEW revision (never un-supersedes in place). */
export function revertOpeningBalance(revisionId: string): Promise<OpeningRevertResult> {
  return request('POST', `/billing/ledger/opening-balances/${encodeURIComponent(revisionId)}/revert`, {
    headers: BILLING_HEADERS,
  }) as Promise<OpeningRevertResult>;
}

/** Resolved client type for one carrier (LOC/Prepay, DWH value vs override, WEX flag). */
export function fetchClientType(carrierId: string): Promise<ClientTypeResolution> {
  return billingGet(`/billing/ledger/client-types?carrierId=${encodeURIComponent(carrierId)}`);
}

/** The whole in-scope book, with the counts of what was excluded and why. */
export function fetchClientTypeBook(): Promise<ClientTypeBookResponse> {
  return billingGet('/billing/ledger/client-types');
}

export function saveClientTypeOverride(
  carrierId: string,
  body: { clientType: LedgerClientType; reason: string; effectiveFrom?: string },
): Promise<ClientTypeOverrideResult> {
  return request('POST', `/billing/ledger/client-types/${encodeURIComponent(carrierId)}`, {
    headers: BILLING_HEADERS,
    body,
  }) as Promise<ClientTypeOverrideResult>;
}

/** Drop the override — the carrier reverts to DWH truth. */
export function clearClientTypeOverride(carrierId: string): Promise<{ cleared: ClientTypeOverrideWire }> {
  return request('DELETE', `/billing/ledger/client-types/${encodeURIComponent(carrierId)}`, {
    headers: BILLING_HEADERS,
  }) as Promise<{ cleared: ClientTypeOverrideWire }>;
}

// ---- Ledger: Excel template + bulk import ----

/** Download a URL as a file, reusing the transport's auth + 401-refresh via requestBlob. */
async function downloadBlob(path: string, fallbackName: string): Promise<void> {
  const blob = await requestBlob(path, { headers: BILLING_HEADERS });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * The fill-in template for one section. Built server-side so the importer parses exactly what the
 * template emits — see src/modules/billing/ledger/excelTemplate.ts.
 */
export function downloadOpeningTemplate(
  section: LedgerSectionId,
  includeCarriers: 'all' | 'missing' | 'with-value' = 'missing',
): Promise<void> {
  const qs = new URLSearchParams({ section, includeCarriers });
  return downloadBlob(
    `/billing/ledger/opening-balances/template?${qs.toString()}`,
    `opening-balances-${section}.xlsx`,
  );
}

/** Export the balances already saved. */
export function downloadOpeningExport(section?: LedgerSectionId): Promise<void> {
  const qs = section ? `?section=${encodeURIComponent(section)}` : '';
  return downloadBlob(
    `/billing/ledger/opening-balances/export${qs}`,
    'opening-balances-saved.xlsx',
  );
}

/** The rejected rows, annotated with a Reason column — how a large file actually gets fixed. */
export function downloadRejectedRows(batchId: string): Promise<void> {
  return downloadBlob(
    `/billing/ledger/opening-balances/import/${encodeURIComponent(batchId)}/rejected.xlsx`,
    'opening-balances-rejected.xlsx',
  );
}

/** Upload for validation. Writes NOTHING — returns a batchId plus the summary. */
export function previewOpeningImport(file: File): Promise<LedgerImportPreviewResponse> {
  const form = new FormData();
  form.append('file', file, file.name);
  return requestMultipart('/billing/ledger/opening-balances/import/preview', form, {
    headers: BILLING_HEADERS,
  }) as Promise<LedgerImportPreviewResponse>;
}

/** Page the stored per-row verdicts. */
export function fetchOpeningImportRows(
  batchId: string,
  page: number,
  limit: number,
  filters: { verdict?: LedgerImportVerdict; changeKind?: LedgerImportChangeKind } = {},
): Promise<LedgerImportRowsPage> {
  const qs = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.verdict) qs.set('verdict', filters.verdict);
  if (filters.changeKind) qs.set('changeKind', filters.changeKind);
  return billingGet(
    `/billing/ledger/opening-balances/import/${encodeURIComponent(batchId)}?${qs.toString()}`,
  );
}

/**
 * Apply the previewed rows. Sends only the batchId — never the rows, so a client cannot write values
 * the validator never saw. `acknowledgeChanged` is required when the batch would overwrite existing
 * balances.
 */
export function commitOpeningImport(
  batchId: string,
  acknowledgeChanged: boolean,
): Promise<LedgerImportCommitResult> {
  return request('POST', `/billing/ledger/opening-balances/import/${encodeURIComponent(batchId)}/commit`, {
    headers: BILLING_HEADERS,
    body: { acknowledgeChanged },
  }) as Promise<LedgerImportCommitResult>;
}

export function discardOpeningImport(batchId: string): Promise<{ batchId: string; status: string }> {
  return request('POST', `/billing/ledger/opening-balances/import/${encodeURIComponent(batchId)}/discard`, {
    headers: BILLING_HEADERS,
  }) as Promise<{ batchId: string; status: string }>;
}

/** Undo a committed batch. Refuses when later changes have replaced everything it wrote. */
export function revertOpeningImport(
  batchId: string,
): Promise<{ batchId: string; restored: number; cleared: number }> {
  return request('POST', `/billing/ledger/opening-balances/import/${encodeURIComponent(batchId)}/revert`, {
    headers: BILLING_HEADERS,
  }) as Promise<{ batchId: string; restored: number; cleared: number }>;
}

/** Recent import batches — the history strip. */
export function fetchOpeningImports(): Promise<{ batches: LedgerImportBatchSummaryWire[] }> {
  return billingGet('/billing/ledger/opening-balances/imports');
}

// ---- Ledger: computed sections + drill-down statement ----

/**
 * One sub-ledger over a period. `endDate` is INCLUSIVE — pass what the agent typed; go through
 * `toWireRange()` in ledgerModel.ts rather than building the range here.
 */
export function fetchLedgerSection(
  section: LedgerSectionId,
  range: { startDate: string; endDate: string },
  opts: {
    page?: number;
    limit?: number;
    search?: string;
    missingOpeningOnly?: boolean;
    sort?: 'company' | 'carrier' | 'closing' | 'debit' | 'credit';
    dir?: 'asc' | 'desc';
  } = {},
): Promise<LedgerSectionResponse> {
  const qs = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate });
  if (opts.page) qs.set('page', String(opts.page));
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.search) qs.set('search', opts.search);
  if (opts.missingOpeningOnly) qs.set('missingOpeningOnly', 'true');
  if (opts.sort) qs.set('sort', opts.sort);
  if (opts.dir) qs.set('dir', opts.dir);
  return billingGetSlow(`/billing/ledger/sections/${encodeURIComponent(section)}?${qs.toString()}`);
}

/** One carrier's lines for one section, with the server-computed running balance. */
export function fetchLedgerStatement(p: {
  carrierId: string;
  section: LedgerSectionId;
  startDate: string;
  endDate: string;
}): Promise<LedgerStatementResponse> {
  const qs = new URLSearchParams({
    carrierId: p.carrierId,
    section: p.section,
    startDate: p.startDate,
    endDate: p.endDate,
  });
  return billingGetSlow(`/billing/ledger/statement?${qs.toString()}`);
}

// ---- Ledger: control points + payments journal ----

/** Per-section reconciliation status for a day, from the nightly snapshot. */
export function fetchLedgerSummary(asOfDate?: string): Promise<LedgerSummaryResponse> {
  const qs = asOfDate ? `?asOfDate=${encodeURIComponent(asOfDate)}` : '';
  return billingGet(`/billing/ledger/summary${qs}`);
}

/** The variance work queue for a day, worst first. */
export function fetchLedgerVariances(
  opts: { asOfDate?: string; section?: LedgerSectionId; status?: string; page?: number; limit?: number } = {},
): Promise<LedgerVariancesResponse> {
  const qs = new URLSearchParams();
  if (opts.asOfDate) qs.set('asOfDate', opts.asOfDate);
  if (opts.section) qs.set('section', opts.section);
  if (opts.status) qs.set('status', opts.status);
  if (opts.page) qs.set('page', String(opts.page));
  if (opts.limit) qs.set('limit', String(opts.limit));
  const s = qs.toString();
  return billingGet(`/billing/ledger/variances${s ? `?${s}` : ''}`);
}

export function fetchLedgerArAging(): Promise<LedgerArAgingResponse> {
  return billingGetSlow('/billing/ledger/aging/ar');
}

export function fetchLedgerUnbilledAging(limit = 100): Promise<LedgerUnbilledAgingResponse> {
  return billingGetSlow(`/billing/ledger/aging/unbilled?limit=${limit}`);
}

export function fetchLedgerUntoppedAging(): Promise<LedgerUntoppedAgingResponse> {
  return billingGet('/billing/ledger/aging/untopped');
}

export function fetchLedgerControlSums(
  range?: { startDate: string; endDate: string },
): Promise<LedgerControlSumsResponse> {
  const qs = range ? `?startDate=${range.startDate}&endDate=${range.endDate}` : '';
  return billingGetSlow(`/billing/ledger/control-sums${qs}`);
}

/** Payments in ledger framing — which sub-ledger each one landed in. */
export function fetchLedgerPayments(
  opts: {
    page?: number;
    limit?: number;
    source?: 'mx' | 'zelle' | 'chase' | 'stripe';
    match?: 'matched' | 'unmatched';
  } = {},
): Promise<LedgerPaymentsResponse> {
  const qs = new URLSearchParams();
  if (opts.page) qs.set('page', String(opts.page));
  if (opts.limit) qs.set('limit', String(opts.limit));
  if (opts.source) qs.set('source', opts.source);
  if (opts.match) qs.set('match', opts.match);
  const s = qs.toString();
  return billingGet(`/billing/ledger/payments${s ? `?${s}` : ''}`);
}

/** Queue a snapshot recompute for a day. Write-gated server-side. */
export function recomputeLedger(
  asOfDate?: string,
  sections?: LedgerSectionId[],
): Promise<{ jobId: string; asOfDate: string; queue: string }> {
  return request('POST', '/billing/ledger/recompute', {
    headers: BILLING_HEADERS,
    body: { ...(asOfDate ? { asOfDate } : {}), ...(sections?.length ? { sections } : {}) },
  }) as Promise<{ jobId: string; asOfDate: string; queue: string }>;
}
