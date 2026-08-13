/**
 * Sort + filter STATE for the CS Applications/Clients list. The actual sort/filter/facet
 * computation moved server-side 2026-08-13 (see applicationsListQuery.ts, backend) so it's
 * correct across the WHOLE dataset, not just one loaded page — this file now only owns the UI
 * state shape and translating it into touchpoint params + a stable cache key.
 */
export type SortKey = 'date' | 'appId' | 'carrierId';
export type SortDir = 'asc' | 'desc';

export const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: 'date', label: 'Date Filled' },
  { id: 'appId', label: 'Application ID' },
  { id: 'carrierId', label: 'Carrier ID' },
];

export interface AppFilters {
  company: string;
  /** Both YYYY-MM-DD (from <input type="date">), inclusive range. */
  dateFrom: string;
  dateTo: string;
  stage: string;
  biz: string;
  agent: string;
  /** Empty set = no WEX Status filter. Multi-select — QA asked for "wex statuses", plural. */
  wex: Set<string>;
}

export function emptyFilters(): AppFilters {
  return { company: '', dateFrom: '', dateTo: '', stage: '', biz: '', agent: '', wex: new Set() };
}

export function activeFilterCount(f: AppFilters): number {
  return (
    [f.company, f.dateFrom || f.dateTo, f.stage, f.biz, f.agent].filter(Boolean).length +
    (f.wex.size > 0 ? 1 : 0)
  );
}

export interface ApplicationsQueryParams {
  sortKey: SortKey;
  sortDir: SortDir;
  company: string;
  dateFrom: string;
  dateTo: string;
  stage: string;
  biz: string;
  agent: string;
  wex: string[];
}

/**
 * Touchpoint params for the current sort+filter state. `wex` is SORTED — the backend's read-cache
 * key preserves array order (it sorts object keys, not array elements), so an unsorted Set→array
 * conversion would fragment the cache across insertion-order variations of the identical selection.
 */
export function filtersToParams(f: AppFilters, sortKey: SortKey, sortDir: SortDir): ApplicationsQueryParams {
  return {
    sortKey,
    sortDir,
    company: f.company,
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    stage: f.stage,
    biz: f.biz,
    agent: f.agent,
    wex: [...f.wex].sort(),
  };
}

/**
 * A stable string for these params. `useLoad`'s effect keys off `JSON.stringify(deps)`
 * (apps/mytrion-crm/src/mytrions/_shared/useLoad.ts), and a `Set` stringifies to `{}` — passing
 * `AppFilters` directly as a dep would silently never refetch when a WEX chip is toggled. Pass
 * this string instead.
 */
export function applicationsQueryKey(params: ApplicationsQueryParams): string {
  return JSON.stringify(params);
}
