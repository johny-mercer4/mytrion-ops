/**
 * Sales Mytrion redesign — live-data adapters. Maps the app's touchpoints + Desk routes onto the
 * exact shapes the redesign tabs render (the same objects that mock.ts used to provide), so each
 * tab swaps `import … from '../mock'` for a `useLoad(loadX)` with loading/error/empty. NO mock/
 * fake data — every array here comes from a real backend call.
 */
import { getDeskTicket, listDeskComments, listDeskTickets, type DeskTicket } from '@/api/desk';
import { getImpersonation } from '@/api/impersonation';
import { callTouchpoint } from '@/api/touchpoints';
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
  return x < 0 ? `-$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}` : `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
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
function hoursSince(iso: string | undefined): number {
  if (!iso) return 0;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 0 : Math.max(0, (Date.now() - d.getTime()) / 3_600_000);
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

/** Week-over-week % change → a display string ("+6%" / "-47%" / "—") + a direction. */
export function pctChange(cur: number, prev: number): { text: string; dir: 'up' | 'down' | 'flat' } {
  if (!prev) return cur > 0 ? { text: 'New', dir: 'up' } : { text: '—', dir: 'flat' };
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
  /** Week-over-week gallons change, e.g. "+6%" / "-47%" / "—". */
  volume_trend: string;
  volume_trend_dir: 'up' | 'down' | 'flat';
  /** Fuel-transactions week-over-week caption, e.g. "↑ 6% vs last week". */
  fuel_tx_caption: string;
}

export async function loadSnapshot(): Promise<SnapshotFields> {
  const raw = await callTouchpoint('dashboard.home_snapshot', {});
  const first = Array.isArray(raw) ? raw[0] : raw;
  const s = ((first as { snapshot?: Record<string, unknown> })?.snapshot ?? {}) as Record<string, unknown>;
  const g = (k: string): number => n(s[k]);
  const gallonsW = g('gallons_this_week');
  const gallonsLW = g('gallons_last_week');
  const swipesW = g('swipes_this_week');
  const swipesLW = g('swipes_last_week');
  const vol = pctChange(gallonsW, gallonsLW);
  const tx = pctChange(swipesW, swipesLW);
  const arrow = tx.dir === 'up' ? '↑' : tx.dir === 'down' ? '↓' : '→';
  // The arrow carries the direction, so strip the sign from the % (no "↓ -29%").
  const fuel_tx_caption =
    tx.dir === 'flat' || tx.text === '—' ? 'Same as last week' : `${arrow} ${tx.text.replace(/[+-]/, '')} vs last week`;
  return {
    active_clients: g('active_clients'),
    inactive_clients: g('inactive_clients'),
    stuck_deals_count: g('stuck_deals_count'),
    total_debt_amount: g('total_debt_amount'),
    total_debtors: g('total_debtors'),
    total_hard_debtors: g('total_hard_debtors'),
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
    fuel_tx_caption,
  };
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
export async function loadAnnouncements(): Promise<AnnVM[]> {
  const raw = await callTouchpoint('inbox.announcements', {});
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

// ---- Inbox (inbox.list) → INBOX shape ----

export interface InboxVM {
  id: string;
  type: 'critical' | 'task' | 'warning' | 'reminder' | 'info';
  prio: 'high' | 'medium' | 'small';
  title: string;
  desc: string;
  time: string;
  tag: string;
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
export async function loadInbox(): Promise<InboxVM[]> {
  const res = await callTouchpoint('inbox.list', {});
  return (res.messages ?? []).map((m) => {
    const p = String(m.priority ?? '').toLowerCase();
    return {
      id: String(m.id ?? m.recordId ?? ''),
      type: mapInboxType(m.type),
      prio: p === 'high' || p === 'critical' ? 'high' : p === 'low' || p === 'small' ? 'small' : 'medium',
      title: m.subject || m.name || '(no subject)',
      desc: stripHtml(m.content ?? ''),
      time: relTime(m.createdTime),
      tag: m.tag ?? '',
    };
  });
}
export function deleteInboxMessage(recordId: string): Promise<unknown> {
  return callTouchpoint('inbox.delete_message', { recordId });
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
export async function loadActivity(range: 'today' | 'week' | 'month'): Promise<ActivityCounts> {
  const map = { today: 'daily', week: 'weekly', month: 'monthly' } as const;
  const res = await callTouchpoint('activity.agent', { range: map[range] });
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

// ---- Data Center / Carriers / Dashboard: clients (clients.by_agent) → RECORDS shape ----

export interface RecordVM {
  id: string;
  name: string;
  carrier: string;
  contact: string;
  phone: string;
  cards: number;
  active: number;
  /** This billing-cycle gallons (from dashboard.agent_sales transactions.volume). */
  gallons: string;
  status: 'active' | 'attention' | 'debtor';
  mc: string;
  dot: string;
}
const truthy = (v: unknown): boolean =>
  v === true || v === 1 || ['1', 'true', 't', 'yes'].includes(String(v ?? '').toLowerCase());

function mapRecord(c: Record<string, unknown>, cycleGallonsByCarrier: Map<string, number>): RecordVM {
  const debt = n(c.computed_debt);
  const days = n(c.computed_debt_days);
  const suspended = truthy(c.is_loc_suspended);
  const active = truthy(c.computed_is_active);
  const status: RecordVM['status'] = (debt >= 1 && days >= 2) || suspended ? 'debtor' : active ? 'active' : 'attention';
  const carrierId = String(c.carrier_id ?? '');
  return {
    id: carrierId,
    name: String(c.company_name ?? '(unnamed)'),
    carrier: `CR-${c.carrier_id ?? ''}`,
    contact: String(c.deal_full_name ?? c.contact_name ?? c.agent ?? '—'),
    phone: String(c.deal_phone ?? c.contact_phone ?? '—'),
    cards: n(c.total_produced_cards ?? c.total_active_cards),
    active: n(c.total_active_cards),
    // Cycle gallons from dashboard.agent_sales `transactions` (full-cycle per-carrier volume).
    gallons: galFmt(cycleGallonsByCarrier.get(carrierId) ?? 0),
    status,
    mc: String(c.deal_money_code ?? c.comdata_id ?? '—'),
    dot: String(c.dot ?? '—'),
  };
}

/**
 * carrier_id → this-cycle gallons. `dashboard.agent_sales`'s `transactions` rows are full-cycle
 * per-carrier totals by default (same source as the Sales Dashboard TX table). Best-effort: a
 * failed fetch just means Clients cards show 0 gallons, not a broken tab.
 */
async function loadCycleGallonsByCarrier(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  try {
    const res = await callTouchpoint('dashboard.agent_sales', {});
    if (res.success === false) return map;
    for (const row of res.data?.transactions ?? []) {
      const id = row.carrier_id != null ? String(row.carrier_id) : '';
      if (!id) continue;
      // Prefer `volume`; fall back to alternate keys some dashboard payloads use.
      const vol = n(row.volume ?? row.gallons ?? row.total_volume);
      map.set(id, vol);
    }
  } catch {
    /* best-effort */
  }
  return map;
}
export async function loadRecords(): Promise<RecordVM[]> {
  const [res, cycleGallonsByCarrier] = await Promise.all([
    callTouchpoint('clients.by_agent', {}),
    loadCycleGallonsByCarrier(),
  ]);
  return (res.data ?? []).map((c) => mapRecord(c as Record<string, unknown>, cycleGallonsByCarrier));
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
export async function searchCarriers(query: string, limit = 200): Promise<CarrierSearchVM[]> {
  const res = await callTouchpoint('sales.carriers_search', { query, limit });
  return (res.carriers ?? []).map((c) => {
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
  });
}

// ---- Tickets (Zoho Desk) → TICKETS / TICKET_MSGS shape ----

export interface TicketVM {
  id: string;
  num: string;
  subject: string;
  company: string;
  channel: string;
  dept: string;
  targetDept: string;
  contact: string;
  agent: string;
  priority: string;
  status: string;
  ticketType: string;
  carrierId: string;
  description: string;
  ageHrs: number;
  unread: number;
  escalated: boolean;
  overdue: boolean;
}
/** A person's display name from firstName/lastName, tolerating nulls. */
function fullName(o: { firstName?: string | null; lastName?: string | null } | null | undefined): string {
  if (!o) return '';
  return `${o.firstName ?? ''} ${o.lastName ?? ''}`.trim();
}

function mapTicket(t: DeskTicket): TicketVM {
  const cf = (t.cf ?? {}) as Record<string, unknown>;
  const channel = String(t.channel ?? 'Customer Service');
  const escalated = channel === 'Escalation' || t.channel === 'Escalation';
  // Company = the contact's account (with ?include=contacts it's nested), then legacy/cf fallbacks.
  const company =
    t.contact?.account?.accountName ??
    (typeof t.accountName === 'string' ? t.accountName : '') ??
    '';
  // Contact = the requester (firstName+lastName, or the flat contactName).
  const contactName = fullName(t.contact) || t.contactName || '';
  // Department name (object with ?include=departments, else a plain string on older payloads).
  const deptName = typeof t.department === 'string' ? t.department : (t.department?.name ?? '');
  // Owner: escalations belong to a team; normal tickets to the assignee (null = unassigned).
  const owner = escalated
    ? t.team?.name ?? (typeof cf.cf_original_stream_manager === 'string' ? cf.cf_original_stream_manager : '')
    : fullName(t.assignee) || t.assignee?.name || '';
  return {
    id: String(t.id ?? ''),
    num: String(t.ticketNumber ?? t.number ?? t.id ?? ''),
    subject: String(t.subject ?? '(no subject)'),
    company: company || String(cf.cf_carrier_id_application_id ?? '—'),
    channel,
    dept: deptName || String(cf.cf_target_department ?? '—'),
    targetDept: String(cf.cf_target_department ?? ''),
    contact: contactName || '—',
    agent: owner || 'N/A',
    priority: String(t.priority ?? 'Normal'),
    status: String(t.status ?? 'Open'),
    ticketType: String(cf.cf_ticket_type ?? 'N/A'),
    carrierId: String(cf.cf_carrier_id_application_id ?? '—'),
    description: stripHtml(String((t as { description?: string }).description ?? '—')),
    ageHrs: hoursSince(t.createdTime),
    unread: 0,
    escalated,
    overdue: Boolean(t.isOverDue),
  };
}
/** One page of creator-scoped Desk tickets (search `from` is 0-based offset; max `limit` 99). */
export interface TicketsPageResult {
  tickets: TicketVM[];
  scoped: boolean;
  /** True when Desk.search is unavailable — server still pages via /tickets creator scan. */
  windowed: boolean;
  hasMore: boolean;
  /** Next `from` for infinite-scroll load-more (ticketdashboard.html: from += limit). */
  nextFrom: number;
}

const TICKET_PAGE = 20;
/** Desk search is capped around ~2,000 rows; 99×20 covers that window. */
const MAX_TICKET_PAGES = 20;

function ticketScope(): { zohoUserId?: string } {
  // When an admin is "viewing as" an agent, pass that agent's id so ?zoho_user_id scopes to them.
  const actAsId = getImpersonation()?.zohoUserId;
  return actAsId ? { zohoUserId: actAsId } : {};
}

/** Fetch one owned ticket (WS promote for tickets outside the loaded pages). */
export async function loadTicketById(ticketId: string): Promise<TicketVM> {
  return mapTicket(await getDeskTicket(ticketId));
}

/** One page — matches zoho-octane ticketdashboard.html (`from=0`, `limit=20`, from += limit). */
export async function loadTicketsPage(opts: {
  from?: number;
  limit?: number;
} = {}): Promise<TicketsPageResult> {
  const limit = Math.min(99, Math.max(1, opts.limit ?? TICKET_PAGE));
  const from = Math.max(0, opts.from ?? 0);
  const res = await listDeskTickets({ from, limit, ...ticketScope() });
  const raw = res.tickets;
  const hasMore = typeof res.hasMore === 'boolean' ? res.hasMore : raw.length >= limit;
  const nextFrom = typeof res.nextFrom === 'number' ? res.nextFrom : from + limit;
  return {
    tickets: raw.map(mapTicket),
    scoped: res.scoped,
    windowed: Boolean(res.windowed),
    hasMore,
    nextFrom,
  };
}

/**
 * Full creator-scoped set (for sidebar WS subscribe + badge). Pages until exhausted or the Desk
 * search window (~2k). Prefer `loadTicketsPage` in the Tickets tab for progressive loading.
 */
export async function loadTickets(): Promise<{ tickets: TicketVM[]; scoped: boolean }> {
  const seen = new Set<string>();
  const rows: TicketVM[] = [];
  let scoped = true;
  let from = 0;
  for (let page = 0; page < MAX_TICKET_PAGES; page++) {
    const res = await loadTicketsPage({ from, limit: 99 });
    scoped = res.scoped;
    for (const t of res.tickets) {
      if (t.id && seen.has(t.id)) continue;
      if (t.id) seen.add(t.id);
      rows.push(t);
    }
    if (!res.hasMore) break;
    from = res.nextFrom;
  }
  return { tickets: rows, scoped };
}

export interface TicketMsgVM {
  from: string;
  type: 'comment' | 'attachment';
  text: string;
  time: string;
  /** Attachment payload (type='attachment') — `attId`/`ticketId` drive the download. */
  file?: { name: string; size: string; attId: string; ticketId: string };
}

/** Human-readable byte size for a Desk attachment (`size` is a byte count string). */
function fmtBytes(raw: string | number | undefined): string {
  const b = typeof raw === 'number' ? raw : Number(String(raw ?? '').replace(/\D/g, '')) || 0;
  if (b <= 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

interface TicketMsgRow extends TicketMsgVM {
  _ts: number;
}

export async function loadTicketMessages(ticketId: string): Promise<TicketMsgVM[]> {
  // Reference ticketdashboard loads comments with limit 100; Desk caps lists at 99.
  const { threads, comments, attachments } = await listDeskComments(ticketId, 99);
  const ms = (v: string | undefined): number => {
    const t = v ? new Date(v).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };

  // Placement (matches the reference dashboard): the caller's OWN posts go right ("me"), everyone
  // else left. The app posts REPLIES as COMMENTS via its shared Desk agent, which the server flags
  // as `mine`. THREADS are the requester's inbound message + any other-agent email replies — never
  // the caller's, so they render left, labelled by author.
  const rows: TicketMsgRow[] = [];
  for (const t of threads ?? []) {
    const text = stripHtml(String(t.content ?? t.summary ?? ''));
    const who = fullName(t.author) || t.author?.name || (t.direction === 'out' ? 'Agent' : 'Customer');
    if (text) rows.push({ from: who, type: 'comment', text, time: relTime(t.createdTime), _ts: ms(t.createdTime) });
  }
  for (const c of comments ?? []) {
    const text = stripHtml(String(c.content ?? ''));
    const cm = c.commenter;
    const who = c.mine ? 'me' : fullName(cm) || cm?.name || 'Support';
    // Older tickets carry a "📎 name" placeholder comment from before attachments got their own
    // Attachments-tab bubble — drop that placeholder text now that the real file renders separately.
    const isCaption = /^📎\s/.test(text) && (c.attachments?.length ?? 0) > 0;
    if (text && !isCaption) rows.push({ from: who, type: 'comment', text, time: relTime(c.commentedTime), _ts: ms(c.commentedTime) });
  }
  // Attachments are ticket-level (Desk's Attachments tab), not tied to one comment/thread — this is
  // also where a file Mytrion sends, or one a Desk agent uploads directly, shows up for BOTH sides.
  for (const a of attachments ?? []) {
    if (!a?.id) continue;
    const who = a.mine ? 'me' : 'Support';
    rows.push({
      from: who,
      type: 'attachment',
      text: '',
      time: relTime(a.createdTime),
      file: { name: String(a.name ?? 'attachment'), size: fmtBytes(a.size), attId: String(a.id), ticketId },
      _ts: ms(a.createdTime),
    });
  }
  return rows.sort((a, b) => a._ts - b._ts).map(({ _ts, ...m }) => m);
}

export {
  loadClientCards, loadClientActivity, CLIENT_ACTIVITY_PAGE,
  type ClientCardVM, type ClientActivityVM, type ClientActivityPage,
} from './clientDrilldown';
