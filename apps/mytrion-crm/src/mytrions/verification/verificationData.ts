/**
 * Verification's data layer: the client roster, fetched once and cached client-side.
 *
 * Mirrors `mytrions/hr/hrData.ts` and Finance's `FinanceClients.tsx`: the roster is every carrier
 * (~8,000), the row is lean (no address/contact — that's a per-carrier detail fetch on modal open), so
 * one fetch into the shared SWR store (`_shared/swrCache.ts`) makes every filter, the search box and
 * re-entering the tab free of a round trip. Rendering stays fast because the tab paginates the
 * (already-loaded, already-filtered) array client-side — see `tabs/VerificationClients.tsx`.
 */
import { useMemo } from 'react';
import {
  getVerificationClientDetail,
  listVerificationRoster,
  type VerificationClientDetail,
  type VerificationClientRow,
} from '../../api/verificationClients';
import { useCachedLoad, type CachedLoad } from '../_shared/swrCache';

const KEY_ROSTER = 'verification:roster';
/** The roster changes a few times a day at most (Zoho/CMP sync cadence) — an hour is generous. */
const STALE_ROSTER = 60 * 60_000;

export function useVerificationRoster(): CachedLoad<VerificationClientRow[]> {
  return useCachedLoad<VerificationClientRow[]>(
    KEY_ROSTER,
    async () => (await listVerificationRoster()).items,
    { staleMs: STALE_ROSTER },
  );
}

/** One carrier's contact/identity detail, fetched only once a card's modal is open. */
export function useVerificationClientDetail(
  carrierId: string | null,
): CachedLoad<VerificationClientDetail> {
  return useCachedLoad(
    carrierId ? `verification:detail:${carrierId}` : 'verification:detail:none',
    () => getVerificationClientDetail(carrierId!),
    { enabled: carrierId != null, staleMs: STALE_ROSTER },
  );
}

export interface VerificationFilters {
  q: string;
  companyType: string | null;
  paymentTerms: 'all' | 'LOC' | 'Prepay' | 'none';
  debtor: 'all' | 'debtors' | 'clear';
  billingCycleTag: string | null;
}

export const EMPTY_VERIFICATION_FILTERS: VerificationFilters = {
  q: '',
  companyType: null,
  paymentTerms: 'all',
  debtor: 'all',
  billingCycleTag: null,
};

export function filterVerificationClients(
  rows: readonly VerificationClientRow[],
  f: VerificationFilters,
): VerificationClientRow[] {
  const term = f.q.trim().toLowerCase();
  return rows.filter((c) => {
    if (f.companyType && c.companyType !== f.companyType) return false;
    if (f.billingCycleTag && c.billingCycleTag !== f.billingCycleTag) return false;
    if (f.paymentTerms === 'none' ? c.paymentTerms !== '' : f.paymentTerms !== 'all' && c.paymentTerms !== f.paymentTerms) {
      return false;
    }
    if (f.debtor === 'debtors' && !c.isDebtor) return false;
    if (f.debtor === 'clear' && c.isDebtor) return false;
    if (!term) return true;
    return c.companyName.toLowerCase().includes(term) || c.carrierId.includes(term);
  });
}

/** Chip values derived from the loaded data, so a new CMP value can't silently disappear from the UI. */
export function distinctValues(rows: readonly VerificationClientRow[], key: 'companyType' | 'billingCycleTag'): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r[key]) set.add(r[key]);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function useFilteredVerificationClients(
  rows: readonly VerificationClientRow[] | undefined,
  filters: VerificationFilters,
): VerificationClientRow[] {
  const { q, companyType, paymentTerms, debtor, billingCycleTag } = filters;
  return useMemo(
    () => (rows ? filterVerificationClients(rows, { q, companyType, paymentTerms, debtor, billingCycleTag }) : []),
    [rows, q, companyType, paymentTerms, debtor, billingCycleTag],
  );
}
