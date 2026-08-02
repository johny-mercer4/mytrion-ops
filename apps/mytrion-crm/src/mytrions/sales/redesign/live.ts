/**
 * Sales Mytrion redesign — live-data adapters. Maps touchpoints onto the shapes
 * the redesign tabs render. Every array comes from a real backend call (no seed fixtures).
 */
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { callTouchpoint } from '@/api/touchpoints';
import {
  deleteInboxMessage as apiDeleteInboxMessage,
  getInboxCounts,
  listInboxMessages,
  markAllInboxRead,
  setInboxMessageRead,
  type InboxCounts,
  type InboxFilter,
} from '@/api/inbox';
import { getClients, type AgentClient } from '@/api/dataCenter';
import { dedupedFetch, invalidateDeduped } from './fetchDedupe';
import { loadDebtorsHomeSummary } from './dashDebtorsData';
import { ICO } from './salesData';
import type { IconName } from './icons';

// ---- tiny load hook (extracted to _shared/useLoad; re-exported for existing importers) ----

export { useLoad, type Loaded } from '../../_shared/useLoad';

/** Canonical "is this ticket closed" test — Closed / Cancelled / Resolved all count as not-open. */
export function isTicketClosed(status: string | undefined): boolean {
  const x = (status ?? '').toLowerCase();
  return x.includes('close') || x.includes('cancel') || x === 'resolved';
}

// ---- formatting ----

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
export const numFmt = (v: unknown): string => n(v).toLocaleString('en-US');
/** Gallons — keep up to 2 decimals (matches Sales Dashboard volume cells). */
export const galFmt = (v: unknown): string =>
  n(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
export const money = (v: unknown): string => {
  const x = n(v);
  // Avoid "$-0" / "-$0" from signed zero or sub-dollar amounts that round to 0.
  if (x === 0 || Object.is(x, -0) || Math.abs(x) < 0.5) return '$0';
  return x < 0
    ? `-$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};
export function relTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>(\n)?/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

// ---- Home: snapshot (dashboard.home_snapshot) ----

/** Week-over-week % change → a display string ("+6%" / "-47%" / "0%") + a direction. */
export function pctChange(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (!prev) return cur > 0 ? { text: 'New', dir: 'up' } : { text: '0%', dir: 'flat' };
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return { text: '0%', dir: 'flat' };
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, dir: pct > 0 ? 'up' : 'down' };
}

export interface SnapshotFields {
  active_clients: number;
  inactive_clients: number;
  stuck_deals_count: number;
  total_debt_amount: number;
  total_debtors: number;
  total_hard_debtors: number;
  swipes_this_week: number;
  gallons_this_week: number;
  new_cards_this_week: number;
  swipes_last_week: number;
  gallons_last_week: number;
  swipes_today: number;
  gallons_today: number;
  new_cards_today: number;
  /** Week-over-week gallons change, e.g. "+6%" / "-47%" / "0%". */
  volume_trend: string;
  volume_trend_dir: 'up' | 'down' | 'flat';
  /** Fuel-transactions week-over-week caption, e.g. "↑ 6% vs last week". */
  fuel_tx_caption: string;
}

export function mapHomeSnapshot(
  raw: unknown,
  debtSummary: { totalRemaining: number; debtorCount: number; hardCount: number } | null = null,
): SnapshotFields {
  const first = Array.isArray(raw) ? raw[0] : raw;
  const snapshot = ((first as { snapshot?: Record<string, unknown> } | null)?.snapshot ?? {}) as Record<
    string,
    unknown
  >;
  const g = (key: string): number => n(snapshot[key]);
  const gallonsW = g('gallons_this_week');
  const gallonsLW = g('gallons_last_week');
  const swipesW = g('swipes_this_week');
  const swipesLW = g('swipes_last_week');
  const vol = pctChange(gallonsW, gallonsLW);
  const tx = pctChange(swipesW, swipesLW);
  const arrow = tx.dir === 'up' ? '↑' : tx.dir === 'down' ? '↓' : '→';
  const fuelTxCaption =
    tx.dir === 'flat' || tx.text === '0%'
      ? 'Same as last week'
      : `${arrow} ${tx.text.replace(/[+-]/, '')} vs last week`;
  return {
    active_clients: g('active_clients'),
    inactive_clients: g('inactive_clients'),
    stuck_deals_count: g('stuck_deals_count'),
    total_debt_amount: debtSummary?.totalRemaining ?? g('total_debt_amount'),
    total_debtors: debtSummary?.debtorCount ?? g('total_debtors'),
    total_hard_debtors: debtSummary?.hardCount ?? g('total_hard_debtors'),
    swipes_this_week: swipesW,
    gallons_this_week: gallonsW,
    new_cards_this_week: g('new_cards_this_week'),
    swipes_last_week: swipesLW,
    gallons_last_week: gallonsLW,
    swipes_today: g('swipes_today'),
    gallons_today: g('gallons_today'),
    new_cards_today: g('new_cards_today'),
    volume_trend: vol.text,
    volume_trend_dir: vol.dir,
    fuel_tx_caption: fuelTxCaption,
  };
}

export async function loadSnapshot(fresh = false): Promise<SnapshotFields> {
  // Parallel: home DWH snapshot + Billing-aligned debtors summary (5-min cache; Refresh forces).
  const [raw, debtSummary] = await Promise.all([
    callTouchpoint('dashboard.home_snapshot', {}),
    loadDebtorsHomeSummary({ force: fresh }).catch(() => null),
  ]);
  return mapHomeSnapshot(raw, debtSummary);
}

// ---- Home: announcements (inbox.announcements) → ANN shape ----

export interface AnnVM {
  type: string;
  color: string;
  title: string;
  body: string;
  time: string;
  icon: IconName;
  prio: string;
}
const ANN_DEFAULT = { color: 'var(--accent)', icon: 'sparkles' } satisfies { color: string; icon: IconName };
const ANN_META: Record<string, { color: string; icon: IconName }> = {
  ai: ANN_DEFAULT,
  system: { color: 'var(--warn)', icon: 'gear' },
  policy: { color: 'var(--violet)', icon: ICO.doc },
  analytics: { color: 'var(--accent)', icon: ICO.trend },
  security: { color: 'var(--danger)', icon: ICO.warn },
};
export function mapAnnouncements(raw: unknown): AnnVM[] {
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((a) => {
    const type = String((a as { Type?: string }).Type ?? '').toLowerCase();
    const meta = ANN_META[type] ?? ANN_DEFAULT;
    const prioRaw = String((a as { Priority?: string }).Priority ?? '').trim();
    return {
      type: type || 'update',
      color: meta.color,
      icon: meta.icon,
      title: (a as { Subject?: string; Name?: string }).Subject || (a as { Name?: string }).Name || '(untitled)',
      body: (a as { Content?: string }).Content ?? '',
      time: relTime((a as { Created_Time?: string }).Created_Time),
      prio: prioRaw || 'Normal',
    };
  });
}

export async function loadAnnouncements(): Promise<AnnVM[]> {
  return mapAnnouncements(await callTouchpoint('inbox.announcements', {}));
}

// ---- Inbox (inbox.list) → INBOX shape ----

export interface InboxVM {
  id: string;
  type: 'critical' | 'task' | 'warning' | 'reminder' | 'info';
  prio: 'high' | 'medium' | 'small';
  title: string;
  desc: string;
  time: string;
  tag: string;
  read: boolean;
}
// Matches the reference self-service InboxPanel._mapType exactly: only 'assignment' becomes a
// (yellow, record-linked) reminder; task/warning/critical map through; everything else → info.
function mapInboxType(t: string | undefined): InboxVM['type'] {
  const x = (t ?? '').toLowerCase();
  if (x === 'task') return 'task';
  if (x === 'assignment') return 'reminder';
  if (x === 'warning') return 'warning';
  if (x === 'critical') return 'critical';
  return 'info';
}
/** Effective CRM identity for dedupe keys — matches what the transport's x-act-as headers scope to. */
function effUserId(): string {
  return getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? 'anon';
}

const INBOX_TTL_MS = 30_000;

function mapInboxMessages(messages: Awaited<ReturnType<typeof listInboxMessages>>['messages']): InboxVM[] {
  return messages.map((message) => {
    const priority = message.priority.toLowerCase();
    return {
      id: message.id,
      type: mapInboxType(message.type),
      prio:
        priority === 'high' || priority === 'critical'
          ? 'high'
          : priority === 'low' || priority === 'small'
            ? 'small'
            : 'medium',
      title: message.subject || message.name || '(no subject)',
      desc: stripHtml(message.content ?? ''),
      time: relTime(message.createdTime),
      tag: message.tag ?? '',
      read: message.readAt != null,
    };
  });
}

/** One shared inbox fetch for its three consumers (sidebar badge, Home preview, Inbox tab). Now
 *  reads our own mytrion_inbox_messages table via /v1/inbox/messages (was the Zoho `inbox.list`
 *  touchpoint). Under admin View-as, the impersonated agent's id scopes the query. */
export async function loadInbox(fresh = false): Promise<InboxVM[]> {
  return dedupedFetch(
    `inbox:${effUserId()}`,
    async () => {
      const actAsId = getImpersonation()?.zohoUserId;
      const res = await listInboxMessages({ ...(actAsId ? { actAsId } : {}), limit: 6 });
      return mapInboxMessages(res.messages);
    },
    { ttlMs: INBOX_TTL_MS, fresh },
  );
}

/** Force the next loadInbox (any consumer) to hit the network — WS events, refresh, deletes. */
export function invalidateInboxCache(): void {
  invalidateDeduped('inbox:');
}
export function deleteInboxMessage(recordId: string): Promise<unknown> {
  return apiDeleteInboxMessage(recordId, getImpersonation()?.zohoUserId);
}

export async function loadInboxPage(input: {
  page: number;
  pageSize: number;
  filter: InboxFilter;
  query: string;
  cursor?: string;
}): Promise<{
  items: InboxVM[];
  counts: InboxCounts;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}> {
  const actAsId = getImpersonation()?.zohoUserId;
  const result = await listInboxMessages({
    ...(actAsId ? { actAsId } : {}),
    limit: input.pageSize,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    filter: input.filter,
    query: input.query,
  });
  return {
    items: mapInboxMessages(result.messages),
    counts: result.counts,
    total: result.pagination.total,
    hasMore: result.pagination.hasMore,
    nextCursor: result.pagination.nextCursor,
  };
}

export function loadInboxCounts(): Promise<InboxCounts> {
  return getInboxCounts(getImpersonation()?.zohoUserId);
}

export function setInboxRead(recordId: string, read: boolean): Promise<void> {
  return setInboxMessageRead(recordId, read, getImpersonation()?.zohoUserId);
}

export function setAllInboxRead(): Promise<void> {
  return markAllInboxRead(getImpersonation()?.zohoUserId);
}

// ---- Home/Dashboard: activity (activity.agent) ----

export interface ActivityCounts {
  calls: number;
  notes: number;
  leads: number;
  received: number;
  interested: number;
  apps: number;
  tasks: number;
}
export async function loadActivity(range: 'today' | 'week' | 'month', fresh = false): Promise<ActivityCounts> {
  void fresh; // in-flight share only (no TTL): concurrent equal calls collapse; sequential calls refetch
  return dedupedFetch(`activity:${effUserId()}:${range}`, async () => {
    return fetchActivity(range);
  });
}

async function fetchActivity(range: 'today' | 'week' | 'month'): Promise<ActivityCounts> {
  const map = { today: 'daily', week: 'weekly', month: 'monthly' } as const;
  const res = await callTouchpoint('activity.agent', { range: map[range] });
  return mapActivity(res);
}

export function mapActivity(raw: unknown): ActivityCounts {
  const res = (raw ?? {}) as { metrics?: Record<string, Record<string, unknown>> };
  const m = res.metrics ?? {};
  const mv = (k: string, f: 'count' | 'completed' = 'count'): number => {
    const e = m[k];
    if (!e || e.error) return 0;
    const v = (e as Record<string, unknown>)[f];
    return typeof v === 'number' ? v : 0;
  };
  return {
    calls: mv('calls', 'completed'),
    notes: mv('notes'),
    leads: mv('leads_created'),
    received: mv('leads_received'),
    interested: mv('leads_interested'),
    apps: mv('applications_filled'),
    tasks: mv('tasks_completed'),
  };
}

// ---- Data Center → Clients: the DWH roster (GET /data-center/clients) → RECORDS shape ----

export interface RecordVM {
  id: string;
  name: string;
  carrier: string;
  contact: string;
  phone: string;
  cards: number;
  active: number;
  /** Declared trucks — account context only. */
  trucks: number | null;
  /** This billing-cycle gallons (DWH roster query — mart_transaction_line_items, 26th→25th cycle). */
  gallons: string;
  /** Raw billing-cycle gallons (numeric) — drives the loyalty tier level. */
  cycleGallons: number;
  status: 'active' | 'attention' | 'debtor';
  /** Live open-invoice debt ($) from cmp_invoice (computed server-side). 0 when not a debtor. */
  computedDebt: number;
  mc: string;
  dot: string;
  /** Real per-calendar-month loyalty inputs (DWH via /data-center/clients). Zero when the client had
   *  no transactions that month. Drive the tier from THESE — never the formatted `gallons` string
   *  (cycle) or `active`/`cards` (all-time). */
  gallonsThisMonth: number;
  inNetworkGallonsThisMonth: number;
  activeCardsThisMonth: number;
  transactionsThisMonth: number;
  gallonsPrevMonth: number;
  inNetworkGallonsPrevMonth: number;
  activeCardsPrevMonth: number;
  lastTierName: string;
  loyaltyOverride?: AgentClient['loyaltyOverride'];
  managerControlled?: boolean;
}

/** DWH roster row → the card/list view-model. Debt/active/gallons are already computed + typed
 *  server-side (dim_company + mart + cmp_invoice), so this is a straight field map. */
function mapRecord(c: AgentClient): RecordVM {
  const status: RecordVM['status'] =
    (c.computedDebt >= 1 && c.computedDebtDays >= 2) || c.isLocSuspended
      ? 'debtor'
      : c.computedIsActive
        ? 'active'
        : 'attention';
  return {
    id: c.carrierId,
    name: c.companyName,
    carrier: `CR-${c.carrierId}`,
    contact: c.contact,
    phone: c.phone,
    cards: c.producedCards,
    active: c.activeCards,
    trucks: c.trucks,
    gallons: galFmt(c.cycleGallons),
    cycleGallons: c.cycleGallons,
    status,
    computedDebt: c.computedDebt,
    mc: c.moneyCode,
    dot: c.dot,
    gallonsThisMonth: c.gallonsThisMonth,
    inNetworkGallonsThisMonth: c.inNetworkGallonsThisMonth,
    activeCardsThisMonth: c.activeCardsThisMonth,
    transactionsThisMonth: c.transactionsThisMonth,
    gallonsPrevMonth: c.gallonsPrevMonth,
    inNetworkGallonsPrevMonth: c.inNetworkGallonsPrevMonth,
    activeCardsPrevMonth: c.activeCardsPrevMonth,
    lastTierName: c.lastTierName,
    loyaltyOverride: c.loyaltyOverride ?? null,
    managerControlled: Boolean(c.loyaltyOverride),
  };
}

export async function loadRecords(): Promise<RecordVM[]> {
  // ONE DWH query (dim_company + mart_transaction_line_items + cmp_invoice) returns the whole roster:
  // metadata + computed debt/activity overlays + cycle/this-month/prev-month gallons. Replaces the
  // servercrm by-agent roster (dropped its live-CMP HTTP overlay) AND the separate loyalty/dashboard
  // round-trips — one call now backs the Clients tab.
  // Forward the acted-as agent id under admin View-as: the /data-center/clients route targets by
  // ?zoho_user_id (it does NOT read the x-act-as header, unlike touchpoints), so without this an
  // admin viewing an agent resolves to their OWN empty roster. Matches loadLeads/loadDeals/loadTickets.
  const actAsId = getImpersonation()?.zohoUserId;
  return (await getClients(actAsId)).map(mapRecord);
}

// ---- Dashboard (dashboard.agent_sales) ----

export interface DashboardVM {
  kpi: Record<string, number>;
  bars: { name: string; active: number; status: string }[];
  activity: { m: string; tx: number }[];
  txTable: { name: string; newCards: number; tx: number; gallons: string; total: string }[];
  cycle: { start?: string; end?: string };
}
export async function loadDashboard(): Promise<DashboardVM> {
  const res = await callTouchpoint('dashboard.agent_sales', {});
  if (res.success === false) throw new Error(res.error || 'Sales dashboard failed to load');
  const d = res.data ?? {};
  const kpiRaw = (d.kpi ?? {}) as Record<string, unknown>;
  const kpi: Record<string, number> = {};
  for (const [k, v] of Object.entries(kpiRaw)) kpi[k] = n(v);
  const bars = (d.cardsByCompany ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      name: String(row.carrier_name ?? row.carrier_id ?? '—'),
      active: n(row.active_cards),
      status: String(row.company_status ?? 'active').toLowerCase(),
    };
  });
  const activity = ((d.cardActivity ?? d.dailyActivity ?? []) as Record<string, unknown>[]).map((b) => ({
    m: String(b.month_label ?? b.activity_month ?? '').slice(0, 6),
    tx: n(b.transactions),
  }));
  const txTable = (d.transactions ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      name: String(row.carrier_name ?? '—'),
      newCards: n(row.new_cards),
      tx: n(row.transactions),
      gallons: numFmt(n(row.volume)),
      total: money(n(row.total)),
    };
  });
  return { kpi, bars, activity, txTable, cycle: (d.cycle ?? {}) as { start?: string; end?: string } };
}

// ---- Carriers (sales.carriers_search) ----

export interface CarrierSearchVM {
  /** Stable row key for lead-create state (snapshot id, else DOT). */
  id: string;
  dot: string;
  owner: string;
  phone: string;
  email: string;
  status: string;
  units: string;
  unitsNum: number;
  address: string;
  truckSize: string;
  addDate: string;
  changeDate: string;
}
export interface CarrierSearchPage {
  rows: CarrierSearchVM[];
  /** Full match count from servercrm (may exceed rows.length). */
  total: number;
  /** True when the backend has more rows than this fetch window returned. */
  moreRecords: boolean;
}

function mapCarrierSearchRow(c: {
  id?: string | number;
  dot_number?: string | number;
  owner_full_name?: string;
  phone_number?: string;
  email?: string;
  operating_status?: string;
  power_units?: number | string;
  physical_address?: string;
  truck_size?: string | number;
  add_date?: string;
  change_date?: string;
}): CarrierSearchVM {
  const dot = c.dot_number != null && String(c.dot_number) !== '' ? String(c.dot_number) : '—';
  const id = c.id != null && String(c.id) !== '' ? String(c.id) : `dot:${dot}`;
  return {
    id,
    dot,
    owner: String(c.owner_full_name ?? '—'),
    phone: String(c.phone_number ?? '—'),
    email: String(c.email ?? '—'),
    status: String(c.operating_status ?? 'unknown'),
    units: String(c.power_units ?? '—'),
    unitsNum: typeof c.power_units === 'number' ? c.power_units : Number(c.power_units) || 0,
    address: String(c.physical_address ?? ''),
    truckSize: c.truck_size != null ? String(c.truck_size) : '',
    addDate: c.add_date ? String(c.add_date).slice(0, 10) : '',
    changeDate: c.change_date ? String(c.change_date).slice(0, 10) : '',
  };
}

export async function searchCarriers(
  query: string,
  limit = 50,
  signal?: AbortSignal,
): Promise<CarrierSearchPage> {
  const res = await callTouchpoint(
    'sales.carriers_search',
    { query, limit },
    signal ? { signal } : {},
  );
  const rows = (res.carriers ?? []).map(mapCarrierSearchRow);
  const total = Number(res.total);
  return {
    rows,
    total: Number.isFinite(total) && total > 0 ? total : rows.length,
    moreRecords: !!res.more_records,
  };
}

export {
  loadClientCards, loadClientActivity, CLIENT_ACTIVITY_PAGE,
  type ClientCardVM, type ClientActivityVM, type ClientActivityPage,
} from './clientDrilldown';
