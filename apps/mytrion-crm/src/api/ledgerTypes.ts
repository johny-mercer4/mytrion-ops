/**
 * Wire shapes for /v1/billing/ledger/* — the Billing Ledger (AR accounting) surface.
 *
 * A NEW file rather than an addition to ./touchpointTypes.ts, which is already ~1160 lines against
 * the 600-line cap; growing it would deepen an existing violation.
 *
 * TWO CONTRACT RULES the backend also states, worth repeating where the client reads them:
 *   • `endDate` is INCLUSIVE on every ledger endpoint (the rest of billing is exclusive). All
 *     range→querystring conversion goes through `toWireRange()` in mytrions/billing/ledgerModel.ts so
 *     this can never drift into a per-call-site shift.
 *   • Errors are thrown `ApiError`s, not `{status:'error'}` envelopes — the ledger uses the modern
 *     convention, unlike the legacy widget-parity billing writes.
 */

export const LEDGER_SECTION_IDS = ['cb-loc', 'unbilled', 'ar', 'cb-prepay', 'untopped'] as const;
export type LedgerSectionId = (typeof LEDGER_SECTION_IDS)[number];

export type LedgerClientType = 'LOC' | 'Prepay';

/** Why a carrier is not in the ledger. Distinct values because the UI messages differ. */
export type LedgerScopeReason = 'wex-funded' | 'no-type' | 'not-found';

export interface LedgerSectionDefWire {
  id: LedgerSectionId;
  label: string;
  clientType: LedgerClientType;
  debit: string;
  credit: string;
  positiveMeans: string;
  externalSource: string;
  shouldTrendToZero: boolean;
  description: string;
}

export interface LedgerSectionsResponse {
  sections: LedgerSectionDefWire[];
}

// ─── Opening balances ───────────────────────────────────────────────────────────────────────

export interface OpeningBalanceWire {
  id: string;
  carrierId: string;
  companyName: string | null;
  clientType: string | null;
  section: LedgerSectionId;
  asOfDate: string;
  amount: number;
  currency: string;
  source: string;
  note: string | null;
  importBatchId: string | null;
  revision: number;
  supersedesId: string | null;
  /** null ⇒ the live revision. */
  supersededAt: string | null;
  supersededByName: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface OpeningBalancesPage {
  rows: OpeningBalanceWire[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface LedgerCarrierWire {
  carrierId: string;
  companyName: string;
  clientType: LedgerClientType;
  billingCycle: string;
  typeSource: 'dwh' | 'override';
  dwhValue: string;
  isActive: boolean;
}

/** The manual-entry lookup. `found: false` still carries enough to explain WHY. */
export interface CarrierOpeningsResponse {
  found: boolean;
  carrier?: LedgerCarrierWire;
  applicableSections?: LedgerSectionId[];
  openings: OpeningBalanceWire[];
  reason?: LedgerScopeReason;
  companyName?: string | null;
  dwhValue?: string | null;
  isWexFunded?: boolean;
}

export interface OpeningHistoryResponse {
  carrierId: string;
  revisions: OpeningBalanceWire[];
}

export interface OpeningUpsertResult {
  row: OpeningBalanceWire;
  previous: OpeningBalanceWire | null;
}

export interface OpeningRevertResult {
  row: OpeningBalanceWire;
  restoredFrom: OpeningBalanceWire;
}

/** Migration progress — how much of the launch balance entry is still outstanding. */
export interface OpeningCoverageResponse {
  sections: {
    section: LedgerSectionId;
    label: string;
    recorded: number;
    eligible: number;
    missing: number;
  }[];
  excluded: { wexFunded: number; noType: number; inactive: number };
}

// ─── Client type ────────────────────────────────────────────────────────────────────────────

export interface ClientTypeOverrideWire {
  id: string;
  carrierId: string;
  clientType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  dwhValueAtWrite: string | null;
  createdByName: string | null;
  createdAt: string;
  closedAt: string | null;
  closedByName: string | null;
}

export interface ClientTypeResolution {
  carrierId: string;
  resolved: LedgerClientType | null;
  source: 'dwh' | 'override' | null;
  companyName: string | null;
  dwhValue: string | null;
  normalizedDwhValue: LedgerClientType | null;
  isWexFunded: boolean;
  reason: LedgerScopeReason | null;
  override: ClientTypeOverrideWire | null;
}

export interface ClientTypeBookResponse {
  carriers: {
    carrierId: string;
    companyName: string;
    clientType: LedgerClientType;
    source: 'dwh' | 'override';
    dwhValue: string;
    billingCycle: string;
  }[];
  total: number;
  excluded: { wexFunded: number; noType: number; inactive: number };
}

export interface ClientTypeOverrideResult {
  row: ClientTypeOverrideWire;
  previous: ClientTypeOverrideWire | null;
}

// ─── Excel bulk import ──────────────────────────────────────────────────────────────────────

export type LedgerImportVerdict = 'accept' | 'reject' | 'unchanged';
export type LedgerImportChangeKind = 'new' | 'changed' | 'unchanged';
export type LedgerImportStatus = 'pending' | 'committed' | 'discarded' | 'reverted';

export interface LedgerImportSummary {
  rowCount: number;
  accepted: number;
  rejected: number;
  changed: number;
  new: number;
  unchanged: number;
}

export interface LedgerImportPreviewRow {
  /** 1-based SPREADSHEET row, so an error can say "fix row 47". */
  rowNumber: number;
  carrierId: string;
  companyName: string;
  clientType: LedgerClientType | '';
  section: LedgerSectionId | '';
  asOfDate: string;
  amount: number | null;
  note: string | null;
  verdict: LedgerImportVerdict;
  changeKind: LedgerImportChangeKind;
  /** EVERY reason, not just the first — a row can fail two ways at once. */
  reasons: string[];
  previousAmount: number | null;
  previousAsOfDate: string | null;
  previousRevisionId: string | null;
  delta: number | null;
}

/** The response to an upload. Writes nothing — `batchId` is what commit references. */
export interface LedgerImportPreviewResponse {
  batchId: string;
  /** True when identical bytes already had a pending batch, so this resumed it. */
  resumed: boolean;
  fileName: string;
  templateVersion: string | null;
  summary: LedgerImportSummary;
  /** Whole-file problems: wrong sheet, re-arranged columns, stale template version. */
  fileErrors: string[];
  expiresAt: string | null;
  maxRows?: number;
}

export interface LedgerImportRowsPage {
  batchId: string;
  status: LedgerImportStatus;
  fileName: string;
  templateVersion: string | null;
  summary: LedgerImportSummary;
  fileErrors: string[];
  /** False once the sweep has dropped the per-row detail; the counts survive. */
  detailAvailable: boolean;
  rows: LedgerImportPreviewRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
  expiresAt: string | null;
  uploadedByName: string | null;
  uploadedAt: string;
  committedAt: string | null;
  revertedAt: string | null;
}

export interface LedgerImportCommitResult {
  batchId: string;
  committed: number;
  skipped: number;
  rejected: number;
  unchanged: number;
}

export interface LedgerImportBatchSummaryWire {
  batchId: string;
  status: LedgerImportStatus;
  fileName: string;
  rowCount: number;
  accepted: number;
  rejected: number;
  changed: number;
  uploadedByName: string | null;
  uploadedAt: string;
  committedAt: string | null;
  revertedAt: string | null;
}

// ─── Computed sections + statement ──────────────────────────────────────────────────────────

export type LedgerOpeningSource = 'recorded' | 'rolled-forward' | 'missing' | 'predates-inception';

export interface LedgerSectionRow {
  carrierId: string;
  companyName: string;
  clientType: LedgerClientType;
  /** RAW Zoho enum (e.g. WEEKLY_MON_SUN) — the client runs fmtCycle(). */
  billingCycle: string;
  section: LedgerSectionId;
  /** null ⇒ no opening balance on file. NEVER 0 in that case. */
  opening: number | null;
  openingAsOf: string | null;
  openingSource: LedgerOpeningSource;
  debit: number;
  credit: number;
  /** opening + debit − credit; null when opening is null. */
  closing: number | null;
  /** Display-ready per-term breakdown, e.g. { 'Fuel': 5300, 'Money code': 750 }. */
  components: Record<string, number>;
  warnings: string[];
}

export interface LedgerSectionTotals {
  carriers: number;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  /** Rows that could not state a closing balance — the migration backlog. */
  missingOpening: number;
}

export interface LedgerSectionResponse {
  section: LedgerSectionId;
  label: string;
  clientType: LedgerClientType;
  externalSource: string;
  shouldTrendToZero: boolean;
  /** Echoed so a reply for a period no longer displayed can be detected. */
  period: { startDate: string; endDate: string };
  rows: LedgerSectionRow[];
  totals: LedgerSectionTotals;
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  excluded: { wexFunded: number; noType: number; inactive: number };
}

export type LedgerStatementRefType =
  | 'topup'
  | 'draw'
  | 'transaction'
  | 'invoice'
  | 'payment'
  | 'maintenance'
  | 'money-code';

export interface LedgerStatementLine {
  /** Stable key — dates repeat, so an index key would break reconciliation on a refetch. */
  id: string;
  date: string;
  description: string;
  /** Exactly one of debit/credit is non-null. */
  debit: number | null;
  credit: number | null;
  /** SERVER-computed. Never derive this client-side. */
  running: number;
  refType: LedgerStatementRefType;
  refId?: string;
}

export interface LedgerStatementResponse {
  carrierId: string;
  companyName: string;
  clientType: string;
  section: LedgerSectionId;
  sectionLabel: string;
  period: { startDate: string; endDate: string; endDateExclusive: string };
  opening: number | null;
  openingAsOf: string | null;
  openingSource: LedgerOpeningSource;
  debit: number;
  credit: number;
  closing: number | null;
  lines: LedgerStatementLine[];
  /** True when the line cap was hit; the header totals still cover the whole period. */
  truncated: boolean;
  warnings: string[];
}
