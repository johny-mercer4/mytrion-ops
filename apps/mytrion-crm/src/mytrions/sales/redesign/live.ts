/**
 * Sales Mytrion redesign — live-data adapters. Maps the app's touchpoints + Desk routes onto the
 * exact shapes the redesign tabs render (the same objects that mock.ts used to provide), so each
 * tab swaps `import … from '../mock'` for a `useLoad(loadX)` with loading/error/empty. NO mock/
 * fake data — every array here comes from a real backend call.
 */
import { useCallback, useEffect, useState } from 'react';

import { getSession } from '@/api/session';
import { listDeskComments, listDeskTickets, type DeskComment, type DeskTicket } from '@/api/desk';
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
  useEffect(() => {
    let off = false;
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
  }, [tick, ...deps]);
  return { data, loading, error, reload };
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
  swipes_today: number;
  gallons_today: number;
  new_cards_today: number;
  volume_trend?: string;
}

export async function loadSnapshot(): Promise<SnapshotFields> {
  const raw = await callTouchpoint('dashboard.home_snapshot', {});
  const first = Array.isArray(raw) ? raw[0] : raw;
  const s = ((first as { snapshot?: Record<string, unknown> })?.snapshot ?? {}) as Record<string, unknown>;
  const g = (k: string): number => n(s[k]);
  return {
    active_clients: g('active_clients'),
    inactive_clients: g('inactive_clients'),
    stuck_deals_count: g('stuck_deals_count'),
    total_debt_amount: g('total_debt_amount'),
    total_debtors: g('total_debtors'),
    total_hard_debtors: g('total_hard_debtors'),
    swipes_this_week: g('swipes_this_week'),
    gallons_this_week: g('gallons_this_week'),
    new_cards_this_week: g('new_cards_this_week'),
    swipes_today: g('swipes_today'),
    gallons_today: g('gallons_today'),
    new_cards_today: g('new_cards_today'),
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
function mapInboxType(t: string | undefined): InboxVM['type'] {
  const x = (t ?? '').toLowerCase();
  if (x === 'task') return 'task';
  if (x === 'assignment' || x === 'reminder') return 'reminder';
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
  address: string;
}
export async function searchCarriers(query: string): Promise<CarrierSearchVM[]> {
  const res = await callTouchpoint('sales.carriers_search', { query, limit: 200 });
  return (res.carriers ?? []).map((c) => ({
    dot: String(c.dot_number ?? '—'),
    owner: String(c.owner_full_name ?? '—'),
    phone: String(c.phone_number ?? '—'),
    email: String(c.email ?? '—'),
    status: String(c.operating_status ?? 'unknown'),
    units: String(c.power_units ?? '—'),
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
function mapTicket(t: DeskTicket): TicketVM {
  const cf = (t.cf ?? {}) as Record<string, unknown>;
  const channel = String(t.channel ?? 'Customer Service');
  const contactName =
    t.contactName ??
    (t.contact ? `${t.contact.firstName ?? ''} ${t.contact.lastName ?? ''}`.trim() : '') ??
    '';
  return {
    id: String(t.id ?? ''),
    num: String(t.ticketNumber ?? t.number ?? t.id ?? ''),
    subject: String(t.subject ?? '(no subject)'),
    company: String(t.accountName ?? cf.cf_carrier_id_application_id ?? '—'),
    channel,
    dept: String(t.department ?? cf.cf_target_department ?? '—'),
    targetDept: String(cf.cf_target_department ?? ''),
    contact: contactName || '—',
    agent: String(t.assignee?.name ?? 'N/A'),
    priority: String(t.priority ?? 'Normal'),
    status: String(t.status ?? 'Open'),
    ticketType: String(cf.cf_ticket_type ?? 'N/A'),
    carrierId: String(cf.cf_carrier_id_application_id ?? '—'),
    description: stripHtml(String((t as { description?: string }).description ?? '—')),
    ageHrs: hoursSince(t.createdTime),
    unread: 0,
    escalated: channel === 'Escalation',
    overdue: Boolean(t.isOverDue),
  };
}
export async function loadTickets(): Promise<{ tickets: TicketVM[]; scoped: boolean }> {
  const res = await listDeskTickets({ limit: 50 });
  return { tickets: res.tickets.map(mapTicket), scoped: res.scoped };
}

export interface TicketMsgVM {
  from: string;
  type: 'comment' | 'attachment';
  text: string;
  time: string;
  file?: { name: string; size: string };
}
export async function loadTicketMessages(ticketId: string): Promise<TicketMsgVM[]> {
  const myId = getSession()?.worker.zohoUserId ?? '';
  const res = await listDeskComments(ticketId, 50);
  return (res.comments ?? []).map((c: DeskComment) => {
    const outbound = c.direction === 'out' || String(c.commenterId ?? '') === String(myId);
    return {
      from: outbound ? 'me' : (c.author?.name ?? 'Support'),
      type: 'comment' as const,
      text: stripHtml(String(c.content ?? '')),
      time: relTime(c.commentedTime),
    };
  });
}
