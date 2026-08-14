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
import { listInboxMessages, type InboxMessage } from '../../api/inbox';
import {
  getVerificationCase,
  listVerificationCases,
  type VerificationCaseDetail,
  type VerificationCaseListResult,
  type VerificationCaseStatus,
} from '../../api/verificationCases';
import {
  getVerificationClientDetail,
  listVerificationRoster,
  type VerificationClientDetail,
  type VerificationClientRow,
} from '../../api/verificationClients';
import {
  listDecisionStrategies,
  listStopFactors,
  type DecisionStrategyRow,
  type StopFactorRow,
} from '../../api/verificationStrategies';
import { useCachedLoad, type CachedLoad } from '../_shared/swrCache';
import { hasCreditScore } from './verificationFormat';

const KEY_ROSTER = 'verification:roster';
const KEY_INBOX = 'verification:inbox';
/** The roster changes a few times a day at most (Zoho/CMP sync cadence) — an hour is generous. */
const STALE_ROSTER = 60 * 60_000;
const STALE_CASES = 30_000;
const STALE_CASE = 15_000;
const STALE_INBOX = 60_000;
const STALE_RULES = 30_000;

export const CASES_PAGE_SIZE = 25;

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

/**
 * Cases list. Keyed by the query so a filter change never paints the previous page's rows, while
 * Refresh / tab remount keep the last result (ModuleShell unmounts inactive tabs).
 *
 * No AbortSignal: transport joins identical GETs, and a cancelled unmount would drop the cache
 * write that makes coming back to the tab instant. Filter changes are a new key, not a double GET.
 */
export function useVerificationCasesList(input: {
  status: VerificationCaseStatus | '';
  q: string;
  unmatched: boolean;
  page: number;
}): CachedLoad<VerificationCaseListResult> {
  const { status, q, unmatched, page } = input;
  const key = `verification:cases:${status}:${unmatched ? 1 : 0}:${q}:${page}`;
  return useCachedLoad(
    key,
    () =>
      listVerificationCases({
        ...(status ? { status } : {}),
        q,
        unmatched,
        limit: CASES_PAGE_SIZE,
        offset: (page - 1) * CASES_PAGE_SIZE,
      }),
    { staleMs: STALE_CASES },
  );
}

export function useVerificationCaseDetail(caseId: string | null): CachedLoad<VerificationCaseDetail> {
  return useCachedLoad(
    caseId ? `verification:case:${caseId}` : 'verification:case:none',
    () => getVerificationCase(caseId!),
    { enabled: caseId != null, staleMs: STALE_CASE },
  );
}

export function useVerificationStopFactors(enabled = true): CachedLoad<StopFactorRow[]> {
  return useCachedLoad('verification:stop-factors', () => listStopFactors(), {
    enabled,
    staleMs: STALE_RULES,
  });
}

export function useVerificationStrategies(enabled = true): CachedLoad<DecisionStrategyRow[]> {
  return useCachedLoad('verification:strategies', () => listDecisionStrategies(), {
    enabled,
    staleMs: STALE_RULES,
  });
}

export function useVerificationInbox(): CachedLoad<InboxMessage[]> {
  return useCachedLoad(
    KEY_INBOX,
    async () => (await listInboxMessages({ tag: 'verification', limit: 50 })).messages,
    { staleMs: STALE_INBOX },
  );
}

/** Mutually exclusive activity windows. `all` is unfiltered. */
export type VerificationActivity = 'all' | '30' | '60' | '90';

/**
 * Default `creditworthy` matches the API: not a debtor AND has a real credit score, then other
 * non-debtors, then debtors. Other values are explicit operator overrides.
 */
export type VerificationSort = 'creditworthy' | 'name' | 'score' | 'recent';

const SORT_IDS: readonly VerificationSort[] = ['creditworthy', 'name', 'score', 'recent'];

export function isVerificationSort(value: string): value is VerificationSort {
  return (SORT_IDS as readonly string[]).includes(value);
}

export interface VerificationFilters {
  q: string;
  companyType: string | null;
  paymentTerms: 'all' | 'LOC' | 'Prepay' | 'none';
  debtor: 'all' | 'debtors' | 'clear';
  billingCycleTag: string | null;
  activity: VerificationActivity;
}

export const EMPTY_VERIFICATION_FILTERS: VerificationFilters = {
  q: '',
  companyType: null,
  paymentTerms: 'all',
  debtor: 'all',
  billingCycleTag: null,
  activity: 'all',
};

export const DEFAULT_VERIFICATION_SORT: VerificationSort = 'creditworthy';

export function filtersAreActive(f: VerificationFilters): boolean {
  return (
    f.q.trim() !== '' ||
    f.companyType != null ||
    f.paymentTerms !== 'all' ||
    f.debtor !== 'all' ||
    f.billingCycleTag != null ||
    f.activity !== 'all'
  );
}

/** Local calendar yyyy-mm-dd, `days` before `now`. String-compareable with roster dates. */
export function ymdDaysAgo(days: number, now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function isActiveWithin(
  lastTransactionAt: string | null,
  days: number,
  now: Date,
): boolean {
  if (!lastTransactionAt) return false;
  const ymd = lastTransactionAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  return ymd >= ymdDaysAgo(days, now);
}

export function filterVerificationClients(
  rows: readonly VerificationClientRow[],
  f: VerificationFilters,
  now: Date = new Date(),
): VerificationClientRow[] {
  const term = f.q.trim().toLowerCase();
  const activityDays = f.activity === 'all' ? null : Number(f.activity);
  return rows.filter((c) => {
    if (f.companyType && c.companyType !== f.companyType) return false;
    if (f.billingCycleTag && c.billingCycleTag !== f.billingCycleTag) return false;
    if (f.paymentTerms === 'none' ? c.paymentTerms !== '' : f.paymentTerms !== 'all' && c.paymentTerms !== f.paymentTerms) {
      return false;
    }
    if (f.debtor === 'debtors' && !c.isDebtor) return false;
    if (f.debtor === 'clear' && c.isDebtor) return false;
    if (activityDays != null && !isActiveWithin(c.lastTransactionAt, activityDays, now)) return false;
    if (!term) return true;
    return c.companyName.toLowerCase().includes(term) || c.carrierId.includes(term);
  });
}

function byName(a: VerificationClientRow, b: VerificationClientRow): number {
  return a.companyName.localeCompare(b.companyName) || a.carrierId.localeCompare(b.carrierId);
}

function creditworthyRank(c: VerificationClientRow): number {
  if (!c.isDebtor && hasCreditScore(c.creditScore)) return 0;
  if (!c.isDebtor) return 1;
  return 2;
}

export function sortVerificationClients(
  rows: readonly VerificationClientRow[],
  sort: VerificationSort,
): VerificationClientRow[] {
  const copy = rows.slice();
  copy.sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'score') {
      const aScore = hasCreditScore(a.creditScore) ? a.creditScore ?? -1 : -1;
      const bScore = hasCreditScore(b.creditScore) ? b.creditScore ?? -1 : -1;
      if (bScore !== aScore) return bScore - aScore;
      return byName(a, b);
    }
    if (sort === 'recent') {
      const at = a.lastTransactionAt ?? '';
      const bt = b.lastTransactionAt ?? '';
      if (at !== bt) return bt.localeCompare(at);
      return byName(a, b);
    }
    const ra = creditworthyRank(a);
    const rb = creditworthyRank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) {
      const scoreDiff = (b.creditScore ?? 0) - (a.creditScore ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
    }
    return byName(a, b);
  });
  return copy;
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
  sort: VerificationSort,
): VerificationClientRow[] {
  const { q, companyType, paymentTerms, debtor, billingCycleTag, activity } = filters;
  return useMemo(() => {
    const filtered = rows ? filterVerificationClients(rows, { q, companyType, paymentTerms, debtor, billingCycleTag, activity }) : [];
    return sortVerificationClients(filtered, sort);
  }, [rows, q, companyType, paymentTerms, debtor, billingCycleTag, activity, sort]);
}
