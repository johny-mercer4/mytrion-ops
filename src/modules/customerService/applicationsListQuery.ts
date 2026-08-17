/**
 * Pure sort/filter/search/facet/paginate logic for the CS Applications list — no I/O, so it's
 * cheap and precise to unit-test directly (see tests/unit/cs-applications-list.test.ts). Operates
 * on the joined `RawApplicationRow` (csApplicationsQuery.ts) rather than the frontend's
 * display-formatted `Application` view-model.
 *
 * This is a server-side port of the client-side `applicationsFilters.ts` (removed once this
 * shipped — the server now owns sort/filter so the two can't drift), preserving its three pinned
 * behaviors: missing values always sink to the bottom regardless of sort direction; appId/carrierId
 * compare numerically when both parse; the `'not assigned'` sentinel for agent.
 */
import type { RawApplicationRow } from '../../integrations/csApplicationsQuery.js';

export type SortKey = 'date' | 'appId' | 'carrierId';
export type SortDir = 'asc' | 'desc';

export interface ApplicationsQueryParams {
  tab: 'apps' | 'clients';
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  company: string;
  dateFrom: string;
  dateTo: string;
  stage: string;
  biz: string;
  agent: string;
  wex: string[];
  loves: string;
  page: number;
  perPage: number;
}

export const NOT_ASSIGNED = 'not assigned';

/** Same sentinel the frontend's `dealAgentName()` used — a null/empty deal owner reads as this. */
export function agentNameOf(row: RawApplicationRow): string {
  const name = row._dealOwner?.name?.trim();
  return name || NOT_ASSIGNED;
}

/**
 * `Loves_Verification` is only ever written as 'Approved'/'Declined' (the picklist has no third
 * option) — blank means nobody has decided yet. QA feedback (Dina Carter, 2026-08-07): new
 * Applications graduate to a Carrier_ID (the Clients tab) the moment WEX produces cards, with
 * nothing here gating that on Love's clearance — so this sentinel is what turns "Clients" into a
 * worklist: filter to Pending to find everyone still owed a Love's decision.
 */
export const LOVES_PENDING = 'Pending';

export function lovesStatusOf(row: RawApplicationRow): string {
  return row.Loves_Verification?.trim() || LOVES_PENDING;
}

function digitsOf(v: string | null): string {
  return v ? v.replace(/\D/g, '') : '';
}

/** Tab split: Apps-in-process = no Carrier_ID yet, Clients = has one. */
export function matchesTab(row: RawApplicationRow, tab: 'apps' | 'clients'): boolean {
  const hasCarrier = Boolean(row.Carrier_ID);
  return tab === 'clients' ? hasCarrier : !hasCarrier;
}

/**
 * Field set matches the search box's own placeholder ("App ID, Carrier ID, Name or Phone").
 * Phone matches on digits both sides so '9167674321' matches '(916) 767-4321' — the old Deluge
 * brute-forced three literal formattings hoping one matched storage; comparing digit strings
 * makes the formatting irrelevant.
 */
export function matchesSearch(row: RawApplicationRow, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  if (row.Name && row.Name.toLowerCase().includes(q)) return true;
  if (row.Carrier_ID && row.Carrier_ID.toLowerCase().includes(q)) return true;
  const qDigits = digitsOf(q);
  if (qDigits && row.Application_ID !== null && String(row.Application_ID).includes(qDigits)) return true;
  if (qDigits && digitsOf(row.Phone).includes(qDigits)) return true;
  return false;
}

export interface ApplicationsFacets {
  stage: string[];
  biz: string[];
  agent: string[];
  wex: string[];
  loves: string[];
}

function distinct(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));
}

/** Computed from the search-filtered set, BEFORE field filters — matches the current UI's actual
 *  behavior (picking a Stage must not make other Stage options vanish from that same dropdown). */
export function computeFacets(rows: RawApplicationRow[]): ApplicationsFacets {
  return {
    stage: distinct(rows.map((r) => r.Stage)),
    biz: distinct(rows.map((r) => r.Type_of_Business)),
    agent: distinct(rows.map(agentNameOf)),
    wex: distinct(rows.map((r) => r.WEX_Status)),
    loves: distinct(rows.map(lovesStatusOf)),
  };
}

export function matchesFilters(
  row: RawApplicationRow,
  f: Pick<ApplicationsQueryParams, 'company' | 'dateFrom' | 'dateTo' | 'stage' | 'biz' | 'agent' | 'wex' | 'loves'>,
): boolean {
  const company = f.company.trim().toLowerCase();
  if (company && !(row.Name ?? '').toLowerCase().includes(company)) return false;
  if (f.stage && row.Stage !== f.stage) return false;
  if (f.biz && row.Type_of_Business !== f.biz) return false;
  if (f.agent && agentNameOf(row) !== f.agent) return false;
  if (f.wex.length > 0 && !(row.WEX_Status && f.wex.includes(row.WEX_Status))) return false;
  if (f.loves && lovesStatusOf(row) !== f.loves) return false;
  if (f.dateFrom || f.dateTo) {
    // Date_Filled is a Zoho DATE field ('YYYY-MM-DD'), same shape as the filter bounds — a plain
    // string compare is exact and inclusive on both ends, no timezone parsing involved.
    const d = row.Date_Filled;
    if (!d) return false;
    if (f.dateFrom && d < f.dateFrom) return false;
    if (f.dateTo && d > f.dateTo) return false;
  }
  return true;
}

function numericOrLocaleCompare(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a.localeCompare(b);
}

/** `id` is the tiebreaker on every comparator — without it, two rows with an equal sort key can
 *  land on either side of a page boundary on different requests (unstable `Array.prototype.sort`
 *  is not the risk here since each request re-sorts the whole set; the real risk is a UI that
 *  expects the SAME row order across an unrelated re-render/re-fetch of the identical query). */
export function compareRows(a: RawApplicationRow, b: RawApplicationRow, key: SortKey, dir: SortDir): number {
  const sign = dir === 'desc' ? -1 : 1;
  let primary: number;
  if (key === 'date') {
    const da = a.Date_Filled;
    const db = b.Date_Filled;
    if (da === null && db === null) primary = 0;
    else if (da === null) primary = 1;
    else if (db === null) primary = -1;
    else primary = (da < db ? -1 : da > db ? 1 : 0) * sign;
  } else if (key === 'appId') {
    const va = a.Application_ID;
    const vb = b.Application_ID;
    if (va === null && vb === null) primary = 0;
    else if (va === null) primary = 1;
    else if (vb === null) primary = -1;
    else primary = (va - vb) * sign;
  } else {
    const va = a.Carrier_ID;
    const vb = b.Carrier_ID;
    if (!va && !vb) primary = 0;
    else if (!va) primary = 1;
    else if (!vb) primary = -1;
    else primary = numericOrLocaleCompare(va, vb) * sign;
  }
  return primary !== 0 ? primary : a.id.localeCompare(b.id);
}

export interface PagedResult {
  rows: RawApplicationRow[];
  total: number;
  moreRecords: boolean;
}

export function paginate(rows: RawApplicationRow[], page: number, perPage: number): PagedResult {
  const start = (page - 1) * perPage;
  return {
    rows: rows.slice(start, start + perPage),
    total: rows.length,
    moreRecords: start + perPage < rows.length,
  };
}

/** search -> tab -> facets (pre-filter) -> filters -> sort -> paginate. */
export function queryApplications(
  allRows: RawApplicationRow[],
  params: ApplicationsQueryParams,
): PagedResult & { facets: ApplicationsFacets } {
  const inTab = allRows.filter((r) => matchesTab(r, params.tab));
  const searched = inTab.filter((r) => matchesSearch(r, params.search));
  const facets = computeFacets(searched);
  const filtered = searched.filter((r) => matchesFilters(r, params));
  const sorted = [...filtered].sort((a, b) => compareRows(a, b, params.sortKey, params.sortDir));
  return { ...paginate(sorted, params.page, params.perPage), facets };
}
