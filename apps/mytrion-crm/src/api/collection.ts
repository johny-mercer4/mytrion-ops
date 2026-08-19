/**
 * Collection desk — cases and Array tradeline snapshots.
 *
 * Reads `/v1/collection/*`. Numbers on money columns arrive as numeric strings (Drizzle's
 * wire format). Format them at the edge; do not `Number()` them into a float for storage.
 */
import { request } from './transport';
import type { CaseDeskInfo } from './collectionDesk';

const COLLECTION_HEADERS = { 'x-department-access': 'collection' } as const;

export const COLLECTION_CASE_STATUSES = ['open', 'closed'] as const;
export type CollectionCaseStatus = (typeof COLLECTION_CASE_STATUSES)[number];

export const COLLECTION_STAGES = [
  'intake',
  'connected',
  'with_agency',
  'payment_plan',
  'skip_tracing',
  'small_claims',
  'closed_successfully',
  'case_lost',
] as const;
export type CollectionStage = (typeof COLLECTION_STAGES)[number];

export const COLLECTION_CLOSED_REASONS = [
  'paid_in_full',
  'below_threshold',
  'left_cmp',
  'manual',
  'case_lost',
] as const;
export type CollectionClosedReason = (typeof COLLECTION_CLOSED_REASONS)[number];

export interface CollectionCaseRow {
  id: string;
  carrierId: string;
  status: CollectionCaseStatus;
  collectionStage: CollectionStage;
  displayName: string | null;
  debtorCompanyName: string | null;
  debtorFullName: string | null;
  debtorEmail: string | null;
  debtorSecondaryEmail: string | null;
  debtorPhone: string | null;
  debtorCellPhone: string | null;
  debtorAddress: string | null;
  debtorCity: string | null;
  debtorState: string | null;
  debtorZipCode: string | null;
  debtorMcDot: string | null;
  debtorDateOfBirth: string | null;
  totalDebtAmount: string;
  totalInvoiceAmount: string;
  totalAmountPaid: string;
  issueInvoiceCount: number;
  daysPastDue: number;
  firstDelinquentDate: string | null;
  placementDate: string | null;
  caseCreatedDate: string;
  closedAt: string | null;
  closedReason: CollectionClosedReason | null;
  zohoDealId: string | null;
  zohoRecordId: string | null;
  agencyTransferDate: string | null;
  firstCollectionAgency: string | null;
  assigneeUserId: string | null;
  currency: string;
  reopenCount: number;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CollectionInvoiceRow {
  id: string;
  caseId: string;
  cmpInvoiceId: number;
  invoiceNumber: string | null;
  cmpStage: string | null;
  status: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  periodLabel: string | null;
  totalAmount: string;
  totalPaid: string;
  remainingAmount: string;
  totalMerchantFee: string;
  dueDate: string | null;
  cmpCreateDate: string | null;
  paymentDay: string | null;
  invoiceNotes: string | null;
  zohoDealId: string | null;
}

export interface CollectionCaseAggregates {
  open: number;
  closed: number;
  remainingDebt: string;
  byStage: Record<string, number>;
}

export interface CollectionCaseListResult {
  items: CollectionCaseRow[];
  total: number;
  aggregates: CollectionCaseAggregates;
  /**
   * Desk state per case id — last touch, open promise, plan progress. A SIBLING map rather than a
   * field on each item, so the finder-owned row above stays exactly what the finder writes and
   * what this app added to it is visibly separate. See api/collectionDesk.ts.
   */
  desk?: Record<string, CaseDeskInfo>;
}

export interface CollectionCaseListFilter {
  limit?: number;
  offset?: number;
  status?: CollectionCaseStatus;
  stage?: CollectionStage;
  closedReason?: CollectionClosedReason;
  search?: string;
  /** Saved view: at least this much still outstanding. */
  minRemaining?: number;
  /** Saved view: no contact attempt has ever been logged. */
  neverContacted?: boolean;
}

export interface ArrayReportRow {
  id: string;
  carrierId: string;
  reportPeriod: string;
  displayName: string | null;
  companyName: string | null;
  customerAccountNumber: string | null;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  telephoneNumber: string | null;
  email: string | null;
  dateOfBirth: string | null;
  dateOpen: string | null;
  carrierType: string | null;
  accountStatus: string | null;
  accountType: string | null;
  paymentRating: string | null;
  paymentHistoryProfile: string | null;
  creditLimit: string | null;
  highestCredit: string | null;
  currentBalance: string | null;
  amountPastDue: string | null;
  dateOfFirstDelinquency: string | null;
  dateOfLastPayment: string | null;
  dateClosed: string | null;
  placementDate: string | null;
  hasAgency: boolean | null;
  agencyName: string | null;
  monthsDelinquent: number | null;
  needsDobLookup: boolean | null;
  excludedReason: string | null;
  validationErrors: string | null;
  currency: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ArrayReportAggregates {
  total: number;
  needsDob: number;
  withAgency: number;
}

export interface ArrayReportListResult {
  items: ArrayReportRow[];
  total: number;
  aggregates: ArrayReportAggregates;
}

export interface ArrayReportFacets {
  periods: string[];
  accountStatuses: string[];
  agencies: string[];
}

export interface ArrayReportListFilter {
  limit?: number;
  offset?: number;
  reportPeriod?: string;
  accountStatus?: string;
  agency?: string;
  needsDobLookup?: boolean;
  search?: string;
}

function queryOf(
  filter: object,
): Record<string, string | number> {
  const query: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'boolean') query[key] = String(value);
    else if (typeof value === 'number' || typeof value === 'string') query[key] = value;
  }
  return query;
}

export async function listCollectionCases(
  filter: CollectionCaseListFilter = {},
): Promise<CollectionCaseListResult> {
  const data = await request('GET', '/collection/cases', {
    query: queryOf(filter),
    headers: COLLECTION_HEADERS,
  });
  return data as CollectionCaseListResult;
}

export async function getCollectionCase(id: string): Promise<{ case: CollectionCaseRow }> {
  const data = await request('GET', `/collection/cases/${encodeURIComponent(id)}`, {
    headers: COLLECTION_HEADERS,
  });
  return data as { case: CollectionCaseRow };
}

export async function listCollectionInvoices(
  caseId: string,
  page: { limit?: number; offset?: number } = {},
): Promise<{ items: CollectionInvoiceRow[]; total: number }> {
  const data = await request('GET', `/collection/cases/${encodeURIComponent(caseId)}/invoices`, {
    query: queryOf(page),
    headers: COLLECTION_HEADERS,
  });
  return data as { items: CollectionInvoiceRow[]; total: number };
}

export async function listArrayReports(
  filter: ArrayReportListFilter = {},
): Promise<ArrayReportListResult> {
  const data = await request('GET', '/collection/array-reports', {
    query: queryOf(filter),
    headers: COLLECTION_HEADERS,
  });
  return data as ArrayReportListResult;
}

export async function getArrayReport(id: string): Promise<{ report: ArrayReportRow }> {
  const data = await request('GET', `/collection/array-reports/${encodeURIComponent(id)}`, {
    headers: COLLECTION_HEADERS,
  });
  return data as { report: ArrayReportRow };
}

export async function listArrayFacets(): Promise<ArrayReportFacets> {
  const data = await request('GET', '/collection/array-reports/facets', {
    headers: COLLECTION_HEADERS,
  });
  return data as ArrayReportFacets;
}
