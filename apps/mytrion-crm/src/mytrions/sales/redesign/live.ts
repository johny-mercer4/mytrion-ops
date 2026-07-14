/**
 * Sales Mytrion redesign — live-data adapters. Maps the app's touchpoints + Desk routes onto the
 * exact shapes the redesign tabs render (the same objects that mock.ts used to provide), so each
 * tab swaps `import … from '../mock'` for a `useLoad(loadX)` with loading/error/empty. NO mock/
 * fake data — every array here comes from a real backend call.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { listDeskComments, listDeskTickets, type DeskTicket } from '@/api/desk';
import { getImpersonation } from '@/api/impersonation';
import { callTouchpoint } from '@/api/touchpoints';
import { ICO } from './salesData';

// ---- tiny load hook (loading/error/data + reload) ----

export interface Loaded<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const depsKey = JSON.stringify(deps);
  const prevKey = useRef(depsKey);
  useEffect(() => {
    let off = false;
    // Drop stale data when the INPUTS change (e.g. a View-as switch) so the previous subject's
    // result can't outlive the switch or survive an error. A plain reload() keeps the old value.
    if (prevKey.current !== depsKey) {
      prevKey.current = depsKey;
      setData(null);
    }
    setLoading(true);
    setError(null);
    fn()
      .then((d) => !off && setData(d))
      .catch((e: unknown) => !off && setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => !off && setLoading(false));
    return () => {
      off = true;
    };
    // eslint-disable-next-line
  }, [tick, depsKey]);
  return { data, loading, error, reload };
}

/** Canonical "is this ticket closed" test — Closed / Cancelled / Resolved all count as not-open. */
export function isTicketClosed(status: string | undefined): boolean {
  const x = (status ?? '').toLowerCase();
  return x.includes('close') || x.includes('cancel') || x === 'resolved';
}

// ---- formatting ----

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
export const numFmt = (v: unknown): string => n(v).toLocaleString('en-US');
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
  icon: string;
  prio: string;
}
const ANN_DEFAULT = { color: 'var(--accent)', icon: 'M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z' };
const ANN_META: Record<string, { color: string; icon: string }> = {
  ai: ANN_DEFAULT,
  system: { color: 'var(--warn)', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z' },
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
  gallons: string;
  balance: string;
  status: 'active' | 'attention' | 'debtor';
  mc: string;
  dot: string;
}
const truthy = (v: unknown): boolean =>
  v === true || v === 1 || ['1', 'true', 't', 'yes'].includes(String(v ?? '').toLowerCase());

function mapRecord(c: Record<string, unknown>): RecordVM {
  const debt = n(c.computed_debt);
  const days = n(c.computed_debt_days);
  const suspended = truthy(c.is_loc_suspended);
  const active = truthy(c.computed_is_active);
  const status: RecordVM['status'] = (debt >= 1 && days >= 2) || suspended ? 'debtor' : active ? 'active' : 'attention';
  const bal = n(c.balance ?? c.efs_balance ?? c.prepay_balance ?? 0);
  return {
    id: String(c.carrier_id ?? ''),
    name: String(c.company_name ?? '(unnamed)'),
    carrier: `CR-${c.carrier_id ?? ''}`,
    contact: String(c.deal_full_name ?? c.contact_name ?? c.agent ?? '—'),
    phone: String(c.deal_phone ?? c.contact_phone ?? '—'),
    cards: n(c.total_produced_cards ?? c.total_active_cards),
    active: n(c.total_active_cards),
    gallons: numFmt(n(c.total_volume ?? c.gallons_90d ?? 0)),
    balance: money(bal),
    status,
    mc: String(c.deal_money_code ?? c.comdata_id ?? '—'),
    dot: String(c.dot ?? '—'),
  };
}
export async function loadRecords(): Promise<RecordVM[]> {
  const res = await callTouchpoint('clients.by_agent', {});
  return (res.data ?? []).map((c) => mapRecord(c as Record<string, unknown>));
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
  const bars = (d.cardsByCompany ?? []).slice(0, 8).map((r) => {
    const row = r as Record<string, unknown>;
    return { name: String(row.carrier_name ?? row.carrier_id ?? '—'), active: n(row.active_cards), status: String(row.company_status ?? 'active').toLowerCase() };
  });
  const activity = ((d.cardActivity ?? d.dailyActivity ?? []) as Record<string, unknown>[]).map((b) => ({
    m: String(b.month_label ?? b.activity_month ?? '').slice(0, 6),
    tx: n(b.transactions),
  }));
  const txTable = (d.transactions ?? []).slice(0, 8).map((r) => {
    const row = r as Record<string, unknown>;
    return { name: String(row.carrier_name ?? '—'), newCards: n(row.new_cards), tx: n(row.transactions), gallons: numFmt(n(row.volume)), total: money(n(row.total)) };
  });
  return { kpi, bars, activity, txTable, cycle: (d.cycle ?? {}) as { start?: string; end?: string } };
}

// ---- Carriers (sales.carriers_search) ----

export interface CarrierSearchVM {
  dot: string;
  owner: string;
  phone: string;
  email: string;
  status: string;
  units: string;
  unitsNum: number;
  address: string;
}
export async function searchCarriers(query: string, limit = 200): Promise<CarrierSearchVM[]> {
  const res = await callTouchpoint('sales.carriers_search', { query, limit });
  return (res.carriers ?? []).map((c) => ({
    dot: String(c.dot_number ?? '—'),
    owner: String(c.owner_full_name ?? '—'),
    phone: String(c.phone_number ?? '—'),
    email: String(c.email ?? '—'),
    status: String(c.operating_status ?? 'unknown'),
    units: String(c.power_units ?? '—'),
    unitsNum: typeof c.power_units === 'number' ? c.power_units : Number(c.power_units) || 0,
    address: String(c.physical_address ?? ''),
  }));
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
export async function loadTickets(): Promise<{ tickets: TicketVM[]; scoped: boolean }> {
  // A real agent's own session scopes the list server-side. When an admin is "viewing as" an agent
  // (act-as), pass that agent's id so the (admin-honored) ?zoho_user_id override scopes to THEM —
  // the desk route resolves identity from the session, not the act-as headers.
  const actAsId = getImpersonation()?.zohoUserId;
  const res = await listDeskTickets({ limit: 50, ...(actAsId ? { zohoUserId: actAsId } : {}) });
  return { tickets: res.tickets.map(mapTicket), scoped: res.scoped };
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
  const { threads, comments } = await listDeskComments(ticketId, 50);
  const ms = (v: string | undefined): number => {
    const t = v ? new Date(v).getTime() : 0;
    return Number.isNaN(t) ? 0 : t;
  };
  const attRows = (
    atts: { id?: string | number; name?: string; size?: string | number }[] | undefined,
    from: string,
    time: string,
    ts: number,
  ): TicketMsgRow[] =>
    (atts ?? [])
      .filter((a) => a && a.id)
      .map((a) => ({
        from,
        type: 'attachment' as const,
        text: '',
        time,
        file: { name: String(a.name ?? 'attachment'), size: fmtBytes(a.size), attId: String(a.id), ticketId },
        _ts: ts,
      }));

  // Placement (matches the reference dashboard): the caller's OWN posts go right ("me"), everyone
  // else left. The app posts REPLIES as COMMENTS via its shared Desk agent, which the server flags
  // as `mine`. THREADS are the requester's inbound message + any other-agent email replies — never
  // the caller's, so they render left, labelled by author. Attachments become their own bubbles.
  const rows: TicketMsgRow[] = [];
  for (const t of threads ?? []) {
    const text = stripHtml(String(t.content ?? t.summary ?? ''));
    const who = fullName(t.author) || t.author?.name || (t.direction === 'out' ? 'Agent' : 'Customer');
    const ts = ms(t.createdTime);
    const time = relTime(t.createdTime);
    if (text) rows.push({ from: who, type: 'comment', text, time, _ts: ts });
    rows.push(...attRows(t.attachments, who, time, ts));
  }
  for (const c of comments ?? []) {
    const text = stripHtml(String(c.content ?? ''));
    const cm = c.commenter;
    const who = c.mine ? 'me' : fullName(cm) || cm?.name || 'Support';
    const ts = ms(c.commentedTime);
    const time = relTime(c.commentedTime);
    // The app captions a file-only reply "📎 name"; drop that placeholder text when an attachment rides along.
    const isCaption = /^📎\s/.test(text) && (c.attachments?.length ?? 0) > 0;
    if (text && !isCaption) rows.push({ from: who, type: 'comment', text, time, _ts: ts });
    rows.push(...attRows(c.attachments, who, time, ts));
  }
  return rows.sort((a, b) => a._ts - b._ts).map(({ _ts, ...m }) => m);
}

// ---- Client drilldown modal: cards (dwh.cards) + activity (dwh.transactions) ----

function maskCard(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : '—';
}

export interface ClientCardVM {
  num: string;
  status: string;
  tone: string;
}
/** A carrier's cards from the DWH (card_number + Active/Inactive/Unknown status only). */
export async function loadClientCards(carrierId: string): Promise<ClientCardVM[]> {
  if (!carrierId) return [];
  const res = await callTouchpoint('dwh.cards', { carrierId });
  return (res.data ?? []).map((c) => {
    const up = String(c.status ?? '').trim().toUpperCase();
    const tone = up === 'ACTIVE' ? 'var(--ok)' : up === 'INACTIVE' ? 'var(--muted)' : 'var(--warn)';
    return { num: maskCard(c.card_number), status: up || 'UNKNOWN', tone };
  });
}

export interface ClientActivityVM {
  title: string;
  sub: string;
  tone: string;
}
/** A carrier's recent fuel-card transactions (DWH line items) as an activity feed. */
export async function loadClientActivity(carrierId: string): Promise<ClientActivityVM[]> {
  if (!carrierId) return [];
  const res = await callTouchpoint('dwh.transactions', { carrierId, limit: 15 });
  const rows = (res.data ?? []).slice(0, 15);
  return rows.map((r) => {
    const gal = n(r.line_item_fuel_quantity ?? r.fuel_quantity);
    const amt = r.line_item_amount ?? r.amount;
    const card = maskCard(r.card_number);
    const loc = String(r.location_name ?? r.merchant_name ?? r.location ?? '').trim();
    const date = r.transaction_date ? relTime(String(r.transaction_date)) : '';
    const title = gal > 0 ? `${gal.toLocaleString('en-US', { maximumFractionDigits: 1 })} gal fueled` : 'Fuel transaction';
    const sub = [date, amt != null ? money(amt) : '', card !== '—' ? `Card ${card}` : '', loc]
      .filter(Boolean)
      .join(' · ');
    return { title, sub, tone: 'var(--violet)' };
  });
}
