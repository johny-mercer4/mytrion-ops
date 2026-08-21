/**
 * Verification Data Center → Blacklist (ban / duplicate / debtor) search.
 *
 * Own file next to the other Data Center clients. Shape mirrors `BlacklistSearchResult`
 * on the API. Compact type + value: USDOT, MC, email, phone, name.
 */
import { request } from './transport';

export type BlacklistSearchBy = 'dot' | 'mc' | 'email' | 'phone' | 'name';

export interface BlacklistBanHit {
  list: 'own' | 'credit_platform';
  entryType: string;
  display: string;
  reason: string | null;
  sourceCaseId: string | null;
  date: string | null;
  fields?: Record<string, unknown>;
}

export interface BlacklistDuplicateHit {
  source: 'case' | 'deal';
  matchedField: string;
  id: string;
  label: string;
  stage: string | null;
  date: string | null;
  fields?: Record<string, unknown>;
}

export interface BlacklistDebtorRecord {
  carrierId: string;
  companyName: string;
  computedDebt: number;
  computedDebtDays: number;
  openInvoices: number;
  fields?: Record<string, unknown>;
}

export interface BlacklistProbe<T> {
  available: boolean;
  error: string | null;
  hits: T[];
}

export interface BlacklistSearchResult {
  matchedOn: BlacklistSearchBy;
  ban: BlacklistProbe<BlacklistBanHit> & { ownAvailable: boolean; platformAvailable: boolean };
  duplicates: BlacklistProbe<BlacklistDuplicateHit> & {
    casesAvailable: boolean;
    dealsAvailable: boolean;
  };
  debtors: { available: boolean; error: string | null; records: BlacklistDebtorRecord[] };
}

export async function searchBlacklist(query: {
  by: BlacklistSearchBy;
  q: string;
}): Promise<BlacklistSearchResult> {
  return (await request('GET', '/verification/flow/blacklist/search', {
    query: { by: query.by, q: query.q },
  })) as BlacklistSearchResult;
}
