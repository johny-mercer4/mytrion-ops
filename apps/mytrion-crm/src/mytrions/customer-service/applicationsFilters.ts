/**
 * Client-side sort + filter over the currently loaded Applications/Clients page.
 *
 * There is no server-side sort/filter for this list: the query itself is a Zoho Deluge function
 * (`mytrionGetApplications`) that lives inside Zoho, not in this repo — see `loadApplications` in
 * live.ts. This operates on whatever page is already loaded (up to APPLICATIONS_PAGE_SIZE rows).
 */
import type { Application } from './data';
import { parseYmd } from './live';

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

/** Local-midnight day timestamp, or null. Never `new Date(rawString).getTime()` directly — a bare
 *  'YYYY-MM-DD' parses as UTC and lands a day early in every timezone west of it (see live.ts). */
function dayTime(raw: string): number | null {
  const d = parseYmd(raw.slice(0, 10));
  return d ? d.getTime() : null;
}

function numericOrLocaleCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  // Application/Carrier IDs are numeric-looking but not fixed-width, so plain string comparison
  // ranks '90000123' above '500000005' — numeric compare when both sides parse cleanly.
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

export function sortApplications(rows: Application[], key: SortKey, dir: SortDir): Application[] {
  // Flipping direction by reversing the whole sorted array would also flip which end the
  // "missing value" rows sink to — the sign only applies to the real comparison, never to the
  // fixed "missing sinks to the bottom" branches below.
  const sign = dir === 'desc' ? -1 : 1;
  const cmp = (a: Application, b: Application): number => {
    if (key === 'date') {
      const ta = dayTime(a.dateFilledRaw);
      const tb = dayTime(b.dateFilledRaw);
      if (ta === null && tb === null) return 0;
      if (ta === null) return 1;
      if (tb === null) return -1;
      return (ta - tb) * sign;
    }
    const va = key === 'appId' ? a.appId : a.carrierId;
    const vb = key === 'appId' ? b.appId : b.carrierId;
    if (!va && !vb) return 0;
    if (!va) return 1;
    if (!vb) return -1;
    return numericOrLocaleCompare(va, vb) * sign;
  };
  return [...rows].sort(cmp);
}

export function filterApplications(rows: Application[], f: AppFilters): Application[] {
  const company = f.company.trim().toLowerCase();
  const from = f.dateFrom ? dayTime(f.dateFrom) : null;
  const to = f.dateTo ? dayTime(f.dateTo) : null;
  return rows.filter((a) => {
    if (company && !a.company.toLowerCase().includes(company)) return false;
    if (f.stage && a.stage !== f.stage) return false;
    if (f.biz && a.biz !== f.biz) return false;
    if (f.agent && a.agent !== f.agent) return false;
    if (f.wex.size > 0 && !f.wex.has(a.wex)) return false;
    if (from !== null || to !== null) {
      const t = dayTime(a.dateFilledRaw);
      if (t === null) return false;
      if (from !== null && t < from) return false;
      if (to !== null && t > to) return false;
    }
    return true;
  });
}

/** Distinct, sorted, non-empty values for a filter dropdown — derived from the loaded rows rather
 *  than a hardcoded list, since live picklists drift (see ApplicationModal's Stage options). */
export function distinctValues(rows: Application[], get: (a: Application) => string): string[] {
  return [...new Set(rows.map(get).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
