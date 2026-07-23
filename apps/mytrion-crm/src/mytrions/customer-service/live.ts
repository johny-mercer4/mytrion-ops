/**
 * Customer Service Mytrion — live-data adapters. Maps the cs.* touchpoints + /cs/* routes
 * onto the exact view-model shapes the panels render (the same objects data.ts used to
 * seed), so each panel swaps its fixture import for a useLoad() with loading/error/empty.
 */
import {
  csTouchpoint,
  getCallsAnalytics,
  getCitifuelStats,
  getCsContext,
  getDeskRoster,
  getTeamOpenTickets,
  type CsOpenTicket,
  getTicketsAnalytics,
  type AnalyticsWindow,
  type CsContext,
} from '@/api/cs';
import { listCitifuel } from '@/api/cs';
import type { CsApplicationRow, CsDataCenterDeal } from '@/api/touchpointTypes';
import type {
  ActivityRow,
  AnalyticsBlock,
  Application,
  BreakdownItem,
  CitiClient,
  LeaderboardRow,
  PriorityRow,
  VolumeDay,
} from './data';

export { useLoad, type Loaded } from '../_shared/useLoad';
export { getCsContext, type CsContext };

// ---- shared coercions ----

const str = (v: unknown): string => (v == null ? '' : typeof v === 'object' ? lookupName(v) : String(v));
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const bool01 = (v: unknown): 0 | 1 => (v === true || v === 'true' || v === 1 || v === '1' ? 1 : 0);

function lookupName(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as { name?: unknown; full_name?: unknown };
    return str(o.name ?? o.full_name ?? '');
  }
  return v == null ? '' : String(v);
}

/** Alias-tolerant field read — the org's Applications rows carry inconsistent casings. */
function pick(r: CsApplicationRow, ...keys: string[]): unknown {
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

export function fmtDate(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function relTime(v: unknown): string {
  const s = str(v);
  if (!s) return '';
  const t = new Date(s).getTime();
  if (Number.isNaN(t)) return s;
  const mins = Math.floor((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ---- Applications ----

export interface AppsPage {
  rows: Application[];
  moreRecords: boolean;
}

/** Deal owner from Deluge enrichment (`_dealOwner`) — never Application Owner. */
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
    city: str(r.City),
    state: str(r.State),
    credit: num(r.Credit_Score),
    trucks: num(r.Number_of_Trucks) ?? 0,
    cards: num(pick(r, 'Cards_Requested', 'Cards_Ordered')) ?? 0,
    date: fmtDate(r.Date_Filled),
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
  };
}

/** Short TTL cache — tab switches / revisits skip another Deluge + COQL round-trip. */
const APPS_CACHE_TTL_MS = 90_000;
const appsCache = new Map<string, { at: number; data: AppsPage }>();

/** One COQL page can return up to 2000 rows (Zoho v8) — avoid 200-row loop chatter. */
export const APPLICATIONS_PAGE_SIZE = 2000;

export function invalidateApplicationsCache(): void {
  appsCache.clear();
}

export async function loadApplications(
  tab: 'apps' | 'clients',
  search: string,
  page: number,
  fresh = false,
): Promise<AppsPage> {
  const q = search.trim();
  const cacheKey = `${tab}|${q}|${page}|${APPLICATIONS_PAGE_SIZE}`;
  if (fresh) appsCache.delete(cacheKey);
  else {
    const hit = appsCache.get(cacheKey);
    if (hit && Date.now() - hit.at < APPS_CACHE_TTL_MS) return hit.data;
  }

  const res = await csTouchpoint('cs.applications.list', {
    tab,
    ...(q ? { search: q } : {}),
    page,
    perPage: APPLICATIONS_PAGE_SIZE,
  });
  const data: AppsPage = {
    rows: (res.data ?? []).map(mapAppRow),
    moreRecords: res.more_records === true,
  };
  appsCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

// ---- Home ----

export interface HomeData {
  team: { openTickets: string; pendingApps: string; activeClients: string; maintenance: string };
  my: { pendingApps: string; activeClients: string; ticketsMonth: string; ticketsLastMonth: string };
  activity: ActivityRow[];
  byPriority: PriorityRow[];
  /** Live per-ticket open list (number / status / owner) for the team panel. */
  openTicketRows: CsOpenTicket[];
}

const stat = (v: unknown): string => (v === undefined || v === null || v === '' ? '—' : String(v));

function monthWindow(offset: number): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const to = offset === 0 ? now : new Date(now.getFullYear(), now.getMonth() + offset + 1, 0, 23, 59, 59);
  return { from: from.toISOString(), to: to.toISOString() };
}

const PRIORITY_TONES: Record<string, PriorityRow['tone']> = {
  urgent: 'bad',
  high: 'warn',
  medium: 'info',
  low: 'neutral',
};

const STAGE_DOTS: Record<string, ActivityRow['dot']> = {
  'Closed Won': 'good',
  'Closed Lost': 'bad',
  'EFS Processing': 'orange',
  'CS Validation': 'orange',
};

export async function loadHome(): Promise<HomeData> {
  const thisMonth = monthWindow(0);
  const lastMonth = monthWindow(-1);
  // Independent sources fail independently (widget parity: CRM metrics may load while DWH is down).
  const [metricsR, teamOpenR, myTicketsR] = await Promise.allSettled([
    csTouchpoint('cs.home.metrics', {}),
    getTeamOpenTickets(thisMonth.from, thisMonth.to),
    getTicketsAnalytics({
      from: thisMonth.from,
      to: thisMonth.to,
      prevFrom: lastMonth.from,
      prevTo: lastMonth.to,
    }),
  ]);
  const metrics = metricsR.status === 'fulfilled' ? metricsR.value : {};
  const teamOpen = teamOpenR.status === 'fulfilled' ? teamOpenR.value : null;
  const myTickets = myTicketsR.status === 'fulfilled' ? myTicketsR.value : null;
  const myTotals = myTickets && !myTickets.unmatched ? myTickets.data?.totals : undefined;

  const activity: ActivityRow[] = (metrics.recentApps ?? []).slice(0, 6).map((a, i) => ({
    id: str(a.id) || `act${i}`,
    text: str(a.Name ?? a.Application_IDD) || 'Application',
    sub: str(a.Stage ?? a.Status),
    time: relTime(a.Modified_Time ?? a.Last_Modified_Date),
    dot: STAGE_DOTS[str(a.Stage)] ?? 'sky',
  }));

  const byPriority: PriorityRow[] = (teamOpen?.byPriority ?? [])
    .map((p) => ({
      label: str(p.priority) || 'Other',
      count: Number(p.count) || 0,
      tone: PRIORITY_TONES[str(p.priority).toLowerCase()] ?? 'neutral',
    }))
    .filter((p) => p.count > 0);

  return {
    team: {
      openTickets: teamOpen ? String(teamOpen.openTickets) : '—',
      pendingApps: stat(metrics.pendingApps),
      activeClients: stat(metrics.activeClients),
      maintenance: stat(metrics.maintenanceCases),
    },
    my: {
      pendingApps: stat(metrics.myPendingApps),
      activeClients: stat(metrics.myClients),
      ticketsMonth: myTotals ? String(myTotals.current ?? 0) : '—',
      ticketsLastMonth: myTotals ? String(myTotals.previous ?? 0) : '—',
    },
    activity,
    byPriority,
    openTicketRows: teamOpen?.tickets ?? [],
  };
}

// ---- Citifuel ----

/** A rendered row + the raw CRM record (the edit modal round-trips real fields). */
export interface CitiRow extends CitiClient {
  raw: Record<string, unknown>;
}

function mapCitiRow(r: Record<string, unknown>): CitiRow {
  return {
    id: str(r.id),
    name: str(r.Name),
    appId: str(r.App_ID),
    status: str(r.Status_of_App) as CitiClient['status'],
    request: str(r.Request) as CitiClient['request'],
    decision: str(r.Final_Decision) as CitiClient['decision'],
    date: fmtDate(r.Date_of_Request ?? r.Created_Time),
    phone: str(r.Phone_Number),
    email: str(r.Email),
    agent: lookupName(r.Agent_Name ?? r.Owner),
    notes: str(r.Notes_1),
    raw: r,
  };
}

export async function loadCiti(
  status: string,
  search: string,
  page: number,
): Promise<{ rows: CitiRow[]; moreRecords: boolean }> {
  const res = await listCitifuel({
    ...(status !== 'all' ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
    perPage: 50,
  });
  return { rows: res.rows.map(mapCitiRow), moreRecords: res.moreRecords };
}

export async function loadCitiStats(): Promise<{ total: number; byStatus: Record<string, number> }> {
  return getCitifuelStats();
}

// ---- Analytics ----

export type RangeId = 'this_month' | 'last_month' | 'last_30' | 'this_quarter';

export const RANGE_LABELS: Record<RangeId, string> = {
  this_month: 'This Month',
  last_month: 'Last Month',
  last_30: 'Last 30 Days',
  this_quarter: 'This Quarter',
};

/** The widget's _computeWindow, verbatim semantics. */
export function computeWindow(range: RangeId): AnalyticsWindow {
  const now = new Date();
  let from: Date;
  let to: Date;
  if (range === 'this_month') {
    from = new Date(now.getFullYear(), now.getMonth(), 1);
    to = now;
  } else if (range === 'last_month') {
    from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (range === 'last_30') {
    to = now;
    from = new Date(now.getTime() - 30 * 86_400_000);
  } else {
    from = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    to = now;
  }
  const len = to.getTime() - from.getTime();
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    prevFrom: new Date(from.getTime() - len).toISOString(),
    prevTo: new Date(from.getTime()).toISOString(),
  };
}

function fmtDuration(secs: number): string {
  if (!Number.isFinite(secs) || secs <= 0) return '—';
  const h = secs / 3600;
  if (h >= 1) return `${h.toFixed(1)}h`;
  return `${Math.round(secs / 60)}m`;
}

const BREAKDOWN_TONES: BreakdownItem['tone'][] = ['sky', 'good', 'purple', 'warn', 'amber', 'bad', 'teal', 'info', 'neutral'];

function toVolume(daily: Array<{ day?: string; count?: number }> | undefined): VolumeDay[] {
  return (daily ?? []).map((d) => ({
    label: fmtDate(d.day).replace(/, \d{4}$/, ''),
    value: Number(d.count) || 0,
  }));
}

function toBreakdown(
  slices: Array<{ status?: string; priority?: string; count?: number }> | undefined,
): BreakdownItem[] {
  return (slices ?? [])
    .map((s, i) => ({
      label: str(s.priority ?? s.status) || 'Other',
      value: Number(s.count) || 0,
      tone: BREAKDOWN_TONES[i % BREAKDOWN_TONES.length] as BreakdownItem['tone'],
    }))
    .filter((b) => b.value > 0);
}

export interface AnalyticsData {
  unmatched: boolean;
  tickets: AnalyticsBlock;
  calls: AnalyticsBlock;
  maintenance: AnalyticsBlock;
}

export async function loadAnalytics(range: RangeId, ctx: CsContext | null): Promise<AnalyticsData> {
  const w = computeWindow(range);
  const ymd = (iso: string): string => iso.slice(0, 10);
  const isManager = ctx?.isManager === true;

  const [ticketsR, callsR, maintR, rosterR] = await Promise.allSettled([
    getTicketsAnalytics(w),
    getCallsAnalytics(w),
    csTouchpoint('cs.analytics.maintenance', {
      fromDate: ymd(w.from),
      toDate: ymd(w.to),
      prevFromDate: ymd(w.prevFrom),
      prevToDate: ymd(w.prevTo),
    }),
    isManager ? getDeskRoster() : Promise.resolve({ agents: [] }),
  ]);
  const tickets = ticketsR.status === 'fulfilled' ? ticketsR.value : {};
  const calls = callsR.status === 'fulfilled' ? callsR.value : {};
  const maint = maintR.status === 'fulfilled' ? maintR.value : {};
  const roster = rosterR.status === 'fulfilled' ? rosterR.value.agents : [];

  const tAgents = tickets.data?.agents ?? [];
  let open = 0;
  let closed = 0;
  let resSum = 0;
  let resN = 0;
  for (const a of tAgents) {
    open += a.open_count ?? 0;
    closed += a.closed_count ?? 0;
    if (a.avg_resolution_secs != null) {
      resSum += a.avg_resolution_secs * (a.closed_count || 1);
      resN += a.closed_count || 1;
    }
  }
  const tTotals = tickets.data?.totals ?? {};
  const cTotals = calls.data?.totals ?? {};
  const mTotals = maint.data?.totals ?? {};

  // Manager leaderboard: tickets keyed by Desk id, calls by CRM email — join on email (widget parity).
  const rosterById = new Map(roster.map((r) => [r.id, r]));
  const callsByEmail = new Map(
    (calls.data?.agents ?? [])
      .filter((c) => c.email)
      .map((c) => [String(c.email).toLowerCase(), c] as const),
  );
  const ticketBoard: LeaderboardRow[] = tAgents
    .filter((a) => a.assignee_id != null)
    .map((a) => {
      const entry = rosterById.get(String(a.assignee_id));
      return {
        agent: entry?.name ?? `Agent ${String(a.assignee_id).slice(-4)}`,
        col1: a.total ?? 0,
        col2: a.closed_count ?? 0,
        col3: a.avg_resolution_secs != null ? Number((a.avg_resolution_secs / 3600).toFixed(1)) : 0,
      };
    })
    .sort((a, b) => b.col1 - a.col1)
    .slice(0, 15);
  const callBoard: LeaderboardRow[] = (calls.data?.agents ?? [])
    .map((c) => ({
      agent: c.name ?? (c.email ? String(c.email).split('@')[0] ?? '' : `Agent ${String(c.owner_id ?? '').slice(-4)}`),
      col1: c.total ?? 0,
      col2: c.prev_total ?? 0,
      col3: 0,
    }))
    .sort((a, b) => b.col1 - a.col1)
    .slice(0, 15);
  const maintBoard: LeaderboardRow[] = (maint.data?.byOwner ?? [])
    .map((o) => ({ agent: str(o.name) || str(o.id), col1: Number(o.count) || 0, col2: '—', col3: 0 }))
    .sort((a, b) => b.col1 - a.col1)
    .slice(0, 15);
  void callsByEmail; // reserved for future merged-board parity

  return {
    unmatched: tickets.unmatched === true || calls.unmatched === true,
    tickets: {
      kpis: [
        {
          label: 'Total Tickets',
          value: String(tTotals.current ?? 0),
          hint: 'This range',
          delta: { prev: tTotals.previous ?? 0, current: tTotals.current ?? 0, higherIsBetter: true },
        },
        { label: 'Open', value: String(open), hint: 'Active support cases' },
        { label: 'Resolved', value: String(closed), hint: 'Closed this range' },
        { label: 'Avg Resolution', value: resN ? fmtDuration(resSum / resN) : '—', hint: 'Per ticket' },
      ],
      volume: toVolume(tickets.data?.daily),
      breakdown: toBreakdown(tickets.data?.byPriority ?? tickets.data?.byStatus),
      leaderboardCols: ['Handled', 'Resolved', 'Avg Hrs'],
      leaderboard: ticketBoard,
    },
    calls: {
      kpis: [
        {
          label: 'Total Calls',
          value: String(cTotals.current ?? 0),
          hint: 'This range',
          delta: { prev: cTotals.previous ?? 0, current: cTotals.current ?? 0, higherIsBetter: true },
        },
        { label: 'Previous Range', value: String(cTotals.previous ?? 0), hint: 'Same-length window' },
      ],
      volume: toVolume(calls.data?.daily),
      breakdown: toBreakdown(calls.data?.byStatus),
      leaderboardCols: ['Calls', 'Prev Range', ''],
      leaderboard: callBoard,
    },
    maintenance: {
      kpis: [
        {
          label: 'Total Cases',
          value: String(mTotals.current ?? 0),
          hint: 'This range',
          delta: { prev: mTotals.previous ?? 0, current: mTotals.current ?? 0, higherIsBetter: false },
        },
        { label: 'Open', value: String(mTotals.open ?? 0), hint: 'Open cases' },
        { label: 'Resolved', value: String(mTotals.closed ?? 0), hint: 'Closed this range' },
        { label: 'Fully Complete', value: String(mTotals.fullComplete ?? 0), hint: 'Both sign-offs' },
      ],
      volume: toVolume(maint.data?.daily),
      breakdown: toBreakdown(maint.data?.byStatus),
      leaderboardCols: ['Cases', '', ''],
      leaderboard: maintBoard,
    },
  };
}

// ---- Data Center ----

const DC_CACHE_KEY = 'cs_dc_deals_v1';

interface DcCache {
  deals: CsDataCenterDeal[];
  cachedAt: string;
}

function readDcCache(): DcCache | null {
  try {
    const raw = sessionStorage.getItem(DC_CACHE_KEY);
    return raw ? (JSON.parse(raw) as DcCache) : null;
  } catch {
    return null;
  }
}

function writeDcCache(deals: CsDataCenterDeal[]): void {
  try {
    sessionStorage.setItem(DC_CACHE_KEY, JSON.stringify({ deals, cachedAt: new Date().toISOString() }));
  } catch {
    /* quota — cache is best-effort */
  }
}

const toCoqlTs = (iso: string): string => new Date(iso).toISOString().replace(/\.\d{3}Z$/, '+00:00');

/** Full load or cache + delta sync (widget parity: sessionStorage, COQL-timestamp delta). */
export async function loadDeals(force = false): Promise<CsDataCenterDeal[]> {
  const cache = readDcCache();
  if (cache && !force) {
    const res = await csTouchpoint('cs.datacenter.deals', { lastSyncTime: toCoqlTs(cache.cachedAt) }).catch(
      () => null,
    );
    const delta = res?.deals ?? [];
    if (delta.length === 0) {
      writeDcCache(cache.deals);
      return cache.deals;
    }
    const byId = new Map(cache.deals.map((d) => [str(d.id), d]));
    for (const d of delta) byId.set(str(d.id), d);
    const merged = [...byId.values()];
    writeDcCache(merged);
    return merged;
  }
  const res = await csTouchpoint('cs.datacenter.deals', { lastSyncTime: '' });
  const deals = res.deals ?? [];
  writeDcCache(deals);
  return deals;
}

export function invalidateDealsCache(): void {
  try {
    sessionStorage.removeItem(DC_CACHE_KEY);
  } catch {
    /* noop */
  }
}
