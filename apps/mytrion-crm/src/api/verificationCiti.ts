/**
 * Verification Data Center → CITI Fuel (Zoho Deals Citifuel standing) search.
 *
 * Own file next to the other Data Center clients. Shape mirrors `CitiSearchResult`
 * on the API. Compact type + value: USDOT, MC, email, name — the keys the existing
 * Deal COQL already filters. No phone.
 */
import { request } from './transport';

export type CitiSearchBy = 'dot' | 'mc' | 'email' | 'name';
export type CitiVerdict = 'flagged' | 'clear' | 'unknown' | 'absent';

export interface CitiDealRecord {
  dealId: string;
  dealName: string | null;
  dotNumber: string | null;
  mcNumber: string | null;
  stage: string | null;
  citifuelStatus: string | null;
  citifuelVerdict: CitiVerdict;
  fields?: Record<string, unknown>;
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
  truncated: boolean;
  pagination: SearchPagination;
  records: CitiDealRecord[];
}

export async function searchCiti(query: {
  by: CitiSearchBy;
  q: string;
  page?: number | undefined;
  pageSize?: number | undefined;
}): Promise<CitiSearchResult> {
  return (await request('GET', '/verification/flow/citi/search', {
    query: { by: query.by, q: query.q, page: query.page, pageSize: query.pageSize },
  })) as CitiSearchResult;
}
