/**
 * Array tradeline snapshots — one row per (carrier_id, report_period).
 *
 * 9k+ rows. Every list is limit+offset with a hard cap; there is no path that dumps the table.
 * Sort is newest period first, then updated_at DESC, id DESC so an offset page cannot skip or
 * duplicate when many filings share a period. `report_period` is a human string that does not
 * sort — see repos/arrayPeriod.ts — so the ordering runs on the derived key, never the column. Facets are distinct values for the filter bar
 * (a handful of periods / Metro 2 codes / agencies), not another page of rows.
 */
import { and, desc, eq, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import { arrayReports, type ArrayReport } from '../db/schema/collection.js';
import type { TenantContext } from '../types/tenantContext.js';
import { reportPeriodSortKey } from './arrayPeriod.js';
import { canReadCollectionSnapshot } from './collectionAccess.js';
import { firstOrUndefined, normalizePagination } from './util.js';

export const ARRAY_REPORTS_MAX_LIMIT = 100;

export interface ArrayReportListFilter {
  limit?: number | undefined;
  offset?: number | undefined;
  reportPeriod?: string | undefined;
  accountStatus?: string | undefined;
  agency?: string | undefined;
  needsDobLookup?: boolean | undefined;
  search?: string | undefined;
}

export interface ArrayReportDto {
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

export interface ArrayReportFacets {
  periods: string[];
  accountStatuses: string[];
  agencies: string[];
}

export interface ArrayReportListResult {
  items: ArrayReportDto[];
  total: number;
  aggregates: ArrayReportAggregates;
}

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);
const day = (d: string | null | undefined): string | null => (d ? d.slice(0, 10) : null);

export function toArrayReportDto(row: ArrayReport): ArrayReportDto {
  return {
    id: row.id,
    carrierId: row.carrierId,
    reportPeriod: row.reportPeriod,
    displayName: row.displayName,
    companyName: row.companyName,
    customerAccountNumber: row.customerAccountNumber,
    firstName: row.firstName,
    lastName: row.lastName,
    city: row.city,
    state: row.state,
    zipCode: row.zipCode,
    telephoneNumber: row.telephoneNumber,
    email: row.email,
    dateOfBirth: day(row.dateOfBirth),
    dateOpen: day(row.dateOpen),
    carrierType: row.carrierType,
    accountStatus: row.accountStatus,
    accountType: row.accountType,
    paymentRating: row.paymentRating,
    paymentHistoryProfile: row.paymentHistoryProfile,
    creditLimit: row.creditLimit,
    highestCredit: row.highestCredit,
    currentBalance: row.currentBalance,
    amountPastDue: row.amountPastDue,
    dateOfFirstDelinquency: day(row.dateOfFirstDelinquency),
    dateOfLastPayment: day(row.dateOfLastPayment),
    dateClosed: day(row.dateClosed),
    placementDate: day(row.placementDate),
    hasAgency: row.hasAgency,
    agencyName: row.agencyName,
    monthsDelinquent: row.monthsDelinquent,
    needsDobLookup: row.needsDobLookup,
    excludedReason: row.excludedReason,
    validationErrors: row.validationErrors,
    currency: row.currency,
    lastSyncedAt: iso(row.lastSyncedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const EMPTY_AGGREGATES: ArrayReportAggregates = { total: 0, needsDob: 0, withAgency: 0 };

/** `agency=none` is the unplaced book — agency_name IS NULL. Anything else is an exact name. */
export function buildArrayWhere(filter: ArrayReportListFilter): SQL | undefined {
  const clauses: SQL[] = [];
  if (filter.reportPeriod) clauses.push(eq(arrayReports.reportPeriod, filter.reportPeriod));
  if (filter.accountStatus) clauses.push(eq(arrayReports.accountStatus, filter.accountStatus));
  if (filter.agency === 'none') {
    clauses.push(sql`${arrayReports.agencyName} IS NULL`);
  } else if (filter.agency) {
    clauses.push(eq(arrayReports.agencyName, filter.agency));
  }
  if (filter.needsDobLookup === true) clauses.push(eq(arrayReports.needsDobLookup, true));
  if (filter.needsDobLookup === false) clauses.push(eq(arrayReports.needsDobLookup, false));
  const q = filter.search?.trim();
  if (q) {
    const like = `%${q}%`;
    const search = or(
      ilike(arrayReports.companyName, like),
      ilike(arrayReports.displayName, like),
      ilike(arrayReports.firstName, like),
      ilike(arrayReports.lastName, like),
      ilike(arrayReports.carrierId, like),
      ilike(arrayReports.customerAccountNumber, like),
    );
    if (search) clauses.push(search);
  }
  return clauses.length ? and(...clauses) : undefined;
}

export function buildArrayListQuery(filter: ArrayReportListFilter) {
  const { limit, offset } = normalizePagination(filter, ARRAY_REPORTS_MAX_LIMIT);
  const where = buildArrayWhere(filter);
  return db
    .select()
    .from(arrayReports)
    .where(where)
    .orderBy(desc(reportPeriodSortKey), desc(arrayReports.updatedAt), desc(arrayReports.id))
    .limit(limit)
    .offset(offset);
}

function emptyList(): ArrayReportListResult {
  return { items: [], total: 0, aggregates: EMPTY_AGGREGATES };
}

export const arrayReportRepo = {
  async list(ctx: TenantContext, filter: ArrayReportListFilter = {}): Promise<ArrayReportListResult> {
    if (!canReadCollectionSnapshot(ctx)) return emptyList();
    const where = buildArrayWhere(filter);
    const [rows, counts, book] = await Promise.all([
      buildArrayListQuery(filter),
      db.select({ count: sql<number>`count(*)::int` }).from(arrayReports).where(where),
      db
        .select({
          total: sql<number>`count(*)::int`,
          needsDob: sql<number>`count(*) FILTER (WHERE ${arrayReports.needsDobLookup} IS TRUE)::int`,
          withAgency: sql<number>`count(*) FILTER (WHERE ${arrayReports.agencyName} IS NOT NULL)::int`,
        })
        .from(arrayReports),
    ]);
    const totals = book[0];
    return {
      items: rows.map(toArrayReportDto),
      total: counts[0]?.count ?? 0,
      aggregates: {
        total: totals?.total ?? 0,
        needsDob: totals?.needsDob ?? 0,
        withAgency: totals?.withAgency ?? 0,
      },
    };
  },

  async findById(ctx: TenantContext, id: string): Promise<ArrayReportDto | undefined> {
    if (!canReadCollectionSnapshot(ctx)) return undefined;
    const row = firstOrUndefined(
      await db.select().from(arrayReports).where(eq(arrayReports.id, id)).limit(1),
    );
    return row ? toArrayReportDto(row) : undefined;
  },

  async facets(ctx: TenantContext): Promise<ArrayReportFacets> {
    if (!canReadCollectionSnapshot(ctx)) return { periods: [], accountStatuses: [], agencies: [] };
    const [periods, statuses, agencies] = await Promise.all([
      // The sort key has to be SELECTed as well as ordered on: SELECT DISTINCT can only order by
      // expressions that appear in the select list.
      db
        .selectDistinct({ v: arrayReports.reportPeriod, k: reportPeriodSortKey })
        .from(arrayReports)
        .orderBy(desc(reportPeriodSortKey)),
      db
        .selectDistinct({ v: arrayReports.accountStatus })
        .from(arrayReports)
        .where(isNotNull(arrayReports.accountStatus))
        .orderBy(arrayReports.accountStatus),
      db
        .selectDistinct({ v: arrayReports.agencyName })
        .from(arrayReports)
        .where(isNotNull(arrayReports.agencyName))
        .orderBy(arrayReports.agencyName),
    ]);
    return {
      periods: periods.map((r) => r.v).filter((v): v is string => Boolean(v)),
      accountStatuses: statuses.map((r) => r.v).filter((v): v is string => Boolean(v)),
      agencies: agencies.map((r) => r.v).filter((v): v is string => Boolean(v)),
    };
  },
};
