/**
 * CS Applications/Clients list — data adapter for the `cs.applications.list` touchpoint. Split out
 * of live.ts (which was over the 600-line cap) since this is what changes when sort/filter/search
 * moved server-side (2026-08-13) — see applicationsListQuery.ts (backend) for why: the "Agent
 * (Deal)" filter/sort/facet needs a join to the Deals module that only makes sense to compute over
 * the WHOLE dataset, not one loaded page.
 */
import { csTouchpoint } from '@/api/cs';
import type { CsApplicationRow, CsApplicationsFacets } from '@/api/touchpointTypes';
import { applicationsQueryKey, type ApplicationsQueryParams } from './applicationsFilters';
import type { Application } from './data';
import { bool01, lookupName, num, str } from './liveCoerce';

/** Alias-tolerant field read — the org's Applications rows carry inconsistent casings. */
function pick(r: CsApplicationRow, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

function fmtDate(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Deal owner from the backend's Deals join (`_dealOwner`) — never Application Owner. */
function dealAgentName(r: CsApplicationRow): string {
  const o = pick(r, '_dealOwner', '_dealAgent');
  if (o == null || o === '') return 'not assigned';
  if (typeof o === 'object') {
    const name = lookupName(o).trim();
    return name || 'not assigned';
  }
  const s = String(o).trim();
  return s || 'not assigned';
}

function mapAppRow(r: CsApplicationRow): Application {
  return {
    id: str(r.id),
    appId: str(pick(r, 'Application_ID', 'Application_IDD')),
    company: str(r.Name),
    first: str(r.First_Name),
    last: str(r.Last_Name),
    biz: str(r.Type_of_Business) as Application['biz'],
    stage: str(r.Stage),
    wex: str(r.WEX_Status),
    mc: str(r.emc),
    dot: str(r.DOT),
    phone: str(r.Phone),
    email: str(r.Email),
    street: str(r.Address),
    city: str(r.City),
    state: str(r.State),
    zip: str(r.Zip_Code),
    credit: num(r.Credit_Score),
    trucks: num(r.Number_of_Trucks) ?? 0,
    cards: num(pick(r, 'Cards_Requested', 'Cards_Ordered')) ?? 0,
    date: fmtDate(r.Date_Filled),
    /** Raw value for sort/filter — `date` above is display-formatted and must never be sorted on
     *  directly (lexicographic order on 'Aug 6, 2026' strings isn't chronological order). */
    dateFilledRaw: str(r.Date_Filled),
    agent: dealAgentName(r),
    notes: str(r.Customer_Service_Notes),
    cycle: str(r.Billing_Cycle),
    pay: str(r.Payment_Type_Billing) as Application['pay'],
    ta: bool01(r.Email_to_TA),
    efs: bool01(pick(r, 'TA_EFS_Added')),
    lmt: bool01(pick(r, 'Limits_Added', 'Limits_added')),
    mob: bool01(pick(r, 'Mobile_Driver_App', 'Mobile_driver_app')),
    chn: bool01(pick(r, 'Chain_Policy', 'Chain_policy')),
    verified: r.Verified === true || r.Verified === 'true',
    carrierId: str(r.Carrier_ID),
    lovesVerification: str(r.Loves_Verification),
  };
}

export interface AppsPage {
  rows: Application[];
  moreRecords: boolean;
  total: number;
  facets: CsApplicationsFacets;
  generatedAt: string;
  truncated: boolean;
}

const EMPTY_FACETS: CsApplicationsFacets = { stage: [], biz: [], agent: [], wex: [], loves: [] };

/** Short TTL cache — tab switches / revisits skip another round-trip. Matches the backend's own
 *  90s per-params read-cache TTL (touchpoints.routes.ts) rather than trying to outlive it. */
const APPS_CACHE_TTL_MS = 90_000;
const appsCache = new Map<string, { at: number; data: AppsPage }>();

/** Render-perf target, not a backend limitation — ApplicationsTable.tsx is sized for ~200 rows x
 *  28 columns (~5,600 cells) per page. */
export const APPLICATIONS_PAGE_SIZE = 200;

export function invalidateApplicationsCache(): void {
  appsCache.clear();
}

export async function loadApplications(
  tab: 'apps' | 'clients',
  search: string,
  page: number,
  queryParams: ApplicationsQueryParams,
  fresh = false,
): Promise<AppsPage> {
  const q = search.trim();
  const cacheKey = `${tab}|${q}|${page}|${applicationsQueryKey(queryParams)}`;
  if (fresh) appsCache.delete(cacheKey);
  else {
    const hit = appsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < APPS_CACHE_TTL_MS) return hit.data;
  }

  const res = await csTouchpoint(
    'cs.applications.list',
    {
      tab,
      ...(q ? { search: q } : {}),
      page,
      perPage: APPLICATIONS_PAGE_SIZE,
      sortKey: queryParams.sortKey,
      sortDir: queryParams.sortDir,
      company: queryParams.company,
      dateFrom: queryParams.dateFrom,
      dateTo: queryParams.dateTo,
      stage: queryParams.stage,
      biz: queryParams.biz,
      agent: queryParams.agent,
      wex: queryParams.wex,
      loves: queryParams.loves,
      fresh,
    },
    { force: fresh },
  );
  const data: AppsPage = {
    rows: (res.data ?? []).map(mapAppRow),
    moreRecords: res.more_records === true,
    total: res.total ?? 0,
    facets: res.facets ?? EMPTY_FACETS,
    generatedAt: res.generated_at ?? '',
    truncated: res.truncated === true,
  };
  appsCache.set(cacheKey, { at: Date.now(), data });
  return data;
}
