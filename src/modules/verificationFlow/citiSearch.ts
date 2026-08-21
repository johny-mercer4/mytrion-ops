/**
 * Data Center CITI Fuel search — Zoho Deals Citifuel standing, one key per call.
 *
 * Reuses `queryDealsForNeedles` (the Phase 3 Deal COQL: `Email` / `Secondary_Email` / `MC` /
 * `DOT1` / `Deal_Name` + `citifuel_Status`). That is the standing query, not a second Deal
 * scan and not `fetchAgentDeals` (owner-scoped, no Citifuel column). Org-wide: no Owner
 * filter. No phone — COQL has no reliable phone match, same reason Phase 3 never invented one.
 *
 * READ-ONLY. Never writes the case. CMP live Collections
 * (`cmp-backend.production.united-fuel.com`) is backlog — no `X-API-Key` / `CITI_API_KEY`.
 * Zoho down is `{ available: false }`, never a 403.
 */
import {
  CITI_SEARCH_DEFAULT_PAGE_SIZE,
  CITI_SEARCH_MAX_PAGE_SIZE,
  citifuelVerdict,
  queryDealsForNeedles,
  type CitifuelVerdict,
  type DealScreeningNeedles,
} from '../../integrations/verificationDealScreening.js';
import { jsonFields, type JsonValue } from '../../lib/jsonFields.js';

export type CitiSearchBy = 'dot' | 'mc' | 'email' | 'name';

export interface CitiDealRecord {
  dealId: string;
  dealName: string | null;
  dotNumber: string | null;
  mcNumber: string | null;
  stage: string | null;
  citifuelStatus: string | null;
  citifuelVerdict: CitifuelVerdict;
  /** Every column the existing COQL already selected. */
  fields?: Record<string, JsonValue>;
}

export interface SearchPagination {
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface CitiSearchResult {
  available: boolean;
  error: string | null;
  matchedOn: CitiSearchBy | null;
  notFound: boolean;
  /** Same signal as `pagination.hasMore`. */
  truncated: boolean;
  pagination: SearchPagination;
  records: CitiDealRecord[];
}

function needlesFor(by: CitiSearchBy, q: string): DealScreeningNeedles {
  return {
    dealId: null,
    email: by === 'email' ? q : null,
    mc: by === 'mc' ? q : null,
    dot: by === 'dot' ? q : null,
    companyName: by === 'name' ? q : null,
  };
}

function textCell(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  const value = raw == null ? '' : String(raw).trim();
  return value === '' ? null : value;
}

function toRecord(row: Record<string, unknown>): CitiDealRecord | null {
  const dealId = textCell(row, 'id');
  if (dealId === null) return null;
  const status = textCell(row, 'citifuel_Status');
  const record: CitiDealRecord = {
    dealId,
    dealName: textCell(row, 'Deal_Name'),
    dotNumber: textCell(row, 'DOT1'),
    mcNumber: textCell(row, 'MC'),
    stage: textCell(row, 'Stage'),
    citifuelStatus: status,
    citifuelVerdict: citifuelVerdict(status),
  };
  const fields = jsonFields(row);
  if (fields !== undefined) record.fields = fields;
  return record;
}

function clampCitiPage(page: number | undefined): number {
  const n = Math.floor(page ?? 1);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function clampCitiPageSize(pageSize: number | undefined): number {
  const n = Math.floor(pageSize ?? CITI_SEARCH_DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(n) || n < 1) return CITI_SEARCH_DEFAULT_PAGE_SIZE;
  return Math.min(n, CITI_SEARCH_MAX_PAGE_SIZE);
}

export async function searchCitifuel(query: {
  by: CitiSearchBy;
  q: string;
  page?: number | undefined;
  pageSize?: number | undefined;
}): Promise<CitiSearchResult> {
  const by = query.by;
  const page = clampCitiPage(query.page);
  const pageSize = clampCitiPageSize(query.pageSize);
  const pagination = { page, pageSize, hasMore: false };
  const queried = await queryDealsForNeedles(needlesFor(by, query.q.trim()), {
    offset: (page - 1) * pageSize,
    limit: pageSize,
  });
  if (!queried.available) {
    return {
      available: false,
      error: queried.error,
      matchedOn: null,
      notFound: false,
      truncated: false,
      pagination,
      records: [],
    };
  }

  const records = queried.rows
    .map(toRecord)
    .filter((row): row is CitiDealRecord => row !== null);
  const hasMore = queried.truncated;
  return {
    available: true,
    error: null,
    matchedOn: by,
    notFound: records.length === 0,
    truncated: hasMore,
    pagination: { page, pageSize, hasMore },
    records,
  };
}
