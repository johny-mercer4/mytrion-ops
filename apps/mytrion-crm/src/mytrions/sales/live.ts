/**
 * Live data layer for the Sales Mytrion — every fetcher calls the SAME touchpoint the
 * legacy self-service widget used, and maps the response into the panel row shapes.
 * Identity is server-injected from the session (or the admin's act-as target), so none
 * of these send a user id.
 */
import { useCallback, useEffect, useState } from 'react';

import { callTouchpoint } from '@/api/touchpoints';
import type {
  AgentActivityResult,
  ByAgentClientRow,
  CarrierSearchRow,
  CreateLeadResult,
  DatacenterLead,
  ZohoAnnouncement,
} from '@/api/touchpointTypes';
import type {
  ActivityRange,
  ActivityStats,
  Announcement,
  AnnouncementType,
  InboxType,
  SnapshotGroup,
} from './data';

// ---- tiny load hook (the app-wide loading/error/data triple, hookified) ----

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
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => !cancelled && setData(d))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // deps are the caller's fetch inputs; fn is intentionally not a dependency (stable per render site)
  }, [tick, ...deps]);
  return { data, loading, error, reload };
}

// ---- formatting ----

export function money(v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—';
}

export function num(v: unknown): string {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

/** Relative time like the widget ("2h ago", "3d ago"). */
export function relTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---- Home: snapshot (mytrionhomesnapshot) ----

export interface SnapshotData {
  groups: SnapshotGroup[];
  updatedAt: number;
}

type SnapTone = SnapshotGroup['cells'][number]['tone'];

/** Map an up/down trend string to a tile tone; `neutral` falls back to the given default. */
function trendTone(trend: unknown, fallback: SnapTone = 'good'): SnapTone {
  const t = String(trend ?? '').toLowerCase();
  if (t === 'up') return 'good';
  if (t === 'down') return 'bad';
  return fallback;
}

export async function loadSnapshot(): Promise<SnapshotData> {
  const raw = await callTouchpoint('dashboard.home_snapshot', {});
  const first = Array.isArray(raw) ? raw[0] : raw;
  const s = (first?.snapshot ?? {}) as Record<string, unknown>;
  const n = (k: string): number => (typeof s[k] === 'number' ? (s[k] as number) : Number(s[k] ?? 0) || 0);
  const gal = (k: string): string => `${n(k).toLocaleString('en-US', { maximumFractionDigits: 0 })} gal`;
  const groups: SnapshotGroup[] = [
    {
      title: 'Your Clients',
      cells: [
        { label: 'Active Customers', value: num(n('active_clients')), tone: 'accent' },
        { label: 'Need Attention', value: n('inactive_clients') === 0 ? '✓' : num(n('inactive_clients')), tone: n('inactive_clients') > 0 ? 'bad' : 'good' },
        { label: 'Stuck Applications', value: num(n('stuck_deals_count')), tone: n('stuck_deals_count') > 0 ? 'warn' : 'good' },
        // Widget tone: hard debtors → orange (warn), else any debt → red (bad), else good.
        { label: 'Money Owed', value: n('total_debt_amount') > 0 ? `-${money(n('total_debt_amount'))}` : '$0', tone: n('total_hard_debtors') > 0 ? 'warn' : n('total_debt_amount') > 0 ? 'bad' : 'good' },
      ],
    },
    {
      title: 'This Week',
      // Tone follows the widget's *_trend signal (up → good/green, down → bad/red).
      cells: [
        { label: 'Fuel Transactions', value: num(n('swipes_this_week')), tone: trendTone(s.swipes_trend) },
        { label: 'Gallons Pumped', value: gal('gallons_this_week'), tone: trendTone(s.gallons_trend, 'purple') },
        { label: 'New Cards', value: num(n('new_cards_this_week')), tone: trendTone(s.new_cards_trend, 'accent') },
      ],
    },
    {
      title: 'Today',
      cells: [
        { label: 'Fuel Transactions', value: num(n('swipes_today')), tone: 'accent' },
        { label: 'Gallons Pumped', value: gal('gallons_today'), tone: 'purple' },
        { label: 'New Cards', value: num(n('new_cards_today')), tone: 'good' },
      ],
    },
  ];
  return { groups, updatedAt: Date.now() };
}

// ---- Home: announcements (mytrionfetchannouncements) ----

const ANN_TYPES: readonly AnnouncementType[] = ['ai', 'policy', 'system', 'update', 'analytics', 'security'];

export async function loadAnnouncements(): Promise<Announcement[]> {
  const raw = await callTouchpoint('inbox.announcements', {});
  const list: ZohoAnnouncement[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((a, i) => {
    const type = String(a.Type ?? '').toLowerCase() as AnnouncementType;
    const priority = String(a.Priority ?? '').toLowerCase();
    return {
      id: `ann-${i}-${a.Created_Time ?? ''}`,
      type: ANN_TYPES.includes(type) ? type : 'update',
      title: a.Subject || a.Name || '(untitled)',
      time: relTime(a.Created_Time),
      content: a.Content ?? '',
      ...(priority ? { priority } : {}),
    };
  });
}

// ---- Home + Dashboard: agent activity (/api/agent/activity/:zohoUserId) ----

// null = the metric's upstream source errored (servercrm returns per-metric {error} in a
// 2xx) → the tile shows "—", NOT a real 0 (widget parity, home-panel.js).
function metric(res: AgentActivityResult, key: string, field: 'count' | 'completed' = 'count'): number | null {
  const m = res.metrics?.[key];
  if (!m) return 0;
  if (m.error) return null;
  const v = m[field];
  return typeof v === 'number' ? v : 0;
}

export async function loadActivity(range: ActivityRange): Promise<ActivityStats> {
  const res = await callTouchpoint('activity.agent', { range });
  return {
    calls: metric(res, 'calls', 'completed'),
    notes: metric(res, 'notes'),
    leadsCreated: metric(res, 'leads_created'),
    leadsReceived: metric(res, 'leads_received'),
    interested: metric(res, 'leads_interested'),
    applications: metric(res, 'applications_filled'),
    tasksDone: metric(res, 'tasks_completed'),
  };
}

// ---- Inbox (mytrionfetchinbox / mytriondeleteinboxmessage) ----

export interface LiveInboxItem {
  id: string;
  recordId: string;
  type: InboxType;
  priority: 'critical' | 'high' | 'medium' | 'low' | 'normal';
  title: string;
  desc: string;
  time: string;
  rawTime: number;
  tag: string;
  sourceUrl: string | null;
  unread: boolean;
}

const READ_KEY = 'octane.sales.inbox.read';

function readIds(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function persistRead(ids: Iterable<string>): void {
  const merged = readIds();
  for (const id of ids) merged.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...merged].slice(-500)));
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

function mapInboxType(type: string | undefined): LiveInboxItem['type'] {
  const t = (type ?? '').toLowerCase();
  if (t === 'task') return 'task';
  if (t === 'assignment') return 'reminder';
  if (t === 'warning') return 'warning';
  if (t === 'critical') return 'critical';
  return 'info';
}

export async function loadInbox(): Promise<LiveInboxItem[]> {
  const res = await callTouchpoint('inbox.list', {});
  const read = readIds();
  const items = (res.messages ?? []).map((m): LiveInboxItem => {
    const id = String(m.id ?? m.recordId ?? '');
    const raw = m.createdTime ? new Date(m.createdTime).getTime() : 0;
    const priority = (['critical', 'high', 'medium', 'low'].includes(String(m.priority ?? '').toLowerCase())
      ? String(m.priority).toLowerCase()
      : 'normal') as LiveInboxItem['priority'];
    return {
      id,
      recordId: String(m.recordId ?? m.id ?? ''),
      type: mapInboxType(m.type),
      priority,
      title: m.subject || m.name || '(no subject)',
      desc: stripHtml(m.content ?? ''),
      time: relTime(m.createdTime),
      rawTime: Number.isNaN(raw) ? 0 : raw,
      tag: m.tag ?? '',
      sourceUrl: m.sourceUrl ?? null,
      unread: !read.has(id),
    };
  });
  return items.sort((a, b) => b.rawTime - a.rawTime);
}

export function deleteInboxMessage(recordId: string): Promise<unknown> {
  return callTouchpoint('inbox.delete_message', { recordId });
}

export interface InboxFeed {
  items: LiveInboxItem[];
  loading: boolean;
  error: string | null;
  unread: number;
  reload: () => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  /** Optimistic delete (widget behavior): remove locally first, fire the touchpoint after. */
  remove: (item: LiveInboxItem, onError?: (message: string) => void) => void;
}

/** One shared CRM-inbox feed — Home's preview and the Inbox panel render the same items. */
export function useInboxFeed(): InboxFeed {
  const load = useLoad(loadInbox, []);
  const [items, setItems] = useState<LiveInboxItem[]>([]);
  useEffect(() => {
    if (load.data) setItems(load.data);
  }, [load.data]);

  const markRead = useCallback((id: string) => {
    persistRead([id]);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, unread: false } : i)));
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => {
      persistRead(prev.map((i) => i.id));
      return prev.map((i) => ({ ...i, unread: false }));
    });
  }, []);

  const remove = useCallback((item: LiveInboxItem, onError?: (message: string) => void) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    // Widget deletes by the message's own id (recordId === id there). Surface failures.
    void deleteInboxMessage(item.recordId || item.id).catch((err: unknown) => {
      onError?.(err instanceof Error ? err.message : 'Failed to delete the message.');
    });
  }, []);

  return {
    items,
    loading: load.loading,
    error: load.error,
    unread: items.filter((i) => i.unread).length,
    reload: load.reload,
    markRead,
    markAllRead,
    remove,
  };
}

// ---- Data Center: clients (/api/clients/by-agent) + leads (mytriondatacenterleads) ----

export interface ClientRow {
  carrierId: string;
  company: string;
  dealStage: string;
  terms: string;
  status: 'active' | 'inactive' | 'suspended';
  limitText: string;
  debt: number;
  debtDays: number;
  isDebtor: boolean;
  dot: string;
}

const truthy = (v: unknown): boolean =>
  v === true || v === 1 || ['1', 'true', 't', 'yes', 'y'].includes(String(v ?? '').toLowerCase());

export async function loadClients(): Promise<ClientRow[]> {
  const res = await callTouchpoint('clients.by_agent', {});
  const rows = (res.data ?? []).map((c: ByAgentClientRow): ClientRow => {
    const debt = Number(c.computed_debt ?? 0) || 0;
    const debtDays = Number(c.computed_debt_days ?? 0) || 0;
    const overdue = Number(c.overdue_invoices_count ?? 0) || 0;
    const terms = String(c.payment_terms ?? '');
    const creditLimit = Number(c.credit_limit ?? 0);
    // Widget: prepay tolerates hyphen/space; a real credit line needs credit_limit > 0.
    const limitText = /pre.?pay/i.test(terms)
      ? money(c.prepay_balance ?? c.balance)
      : Number.isFinite(creditLimit) && creditLimit > 0
        ? `${money(c.balance)} / ${money(creditLimit)}`
        : money(c.balance);
    return {
      carrierId: String(c.carrier_id ?? ''),
      company: c.company_name ?? '(unnamed)',
      dealStage: String(c.deal_stage ?? ''),
      terms,
      status: truthy(c.is_loc_suspended) ? 'suspended' : truthy(c.computed_is_active) ? 'active' : 'inactive',
      limitText,
      debt,
      debtDays,
      isDebtor: (debt >= 1 && debtDays >= 2) || overdue > 0,
      dot: c.dot != null ? String(c.dot) : '',
    };
  });
  // widget sort: has-terms first, then active-first, then alpha
  return rows.sort(
    (a, b) =>
      Number(Boolean(b.terms)) - Number(Boolean(a.terms)) ||
      Number(b.status === 'active') - Number(a.status === 'active') ||
      a.company.localeCompare(b.company),
  );
}

export interface LeadRow {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  source: string;
  utm: string;
  status: string;
  created: string;
  company: string;
  converted: boolean;
}

function mapLead(r: DatacenterLead, converted: boolean): LeadRow {
  const fullName = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown';
  return {
    id: String(r.id ?? ''),
    fullName,
    email: r.email ?? '',
    phone: r.phone ?? '',
    source: r.lead_source ?? '',
    utm: r.utm_source ?? '',
    status: r.lead_status || 'Unknown',
    created: relTime(r.created_time),
    company: r.company === '-' ? '' : (r.company ?? ''),
    converted,
  };
}

export async function loadLeads(): Promise<{ converted: LeadRow[]; unconverted: LeadRow[] }> {
  const res = await callTouchpoint('leads.datacenter', {});
  return {
    converted: (res.converted ?? []).map((r) => mapLead(r, true)),
    unconverted: (res.unconverted ?? []).map((r) => mapLead(r, false)),
  };
}

// ---- Carriers: prospect search + create lead ----

export async function searchCarriers(query: string, limit = 200) {
  return callTouchpoint('sales.carriers_search', { query, limit });
}

export type LeadOutcome =
  | { status: 'created'; leadId: string }
  | { status: 'duplicate'; leadId: string | null }
  | { status: 'failed'; message: string };

export function leadUrl(id: string): string {
  return `https://crm.zoho.com/crm/octanefuel/tab/Leads/${id}`;
}

function leadOutcomeOf(res: CreateLeadResult): LeadOutcome {
  if (res.success && res.leadId) return { status: 'created', leadId: String(res.leadId) };
  // `response` may be a JSON string OR an already-parsed object (widget handles both).
  const raw = res.response;
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw ?? res);
  if (/DUPLICATE_DATA/i.test(text)) {
    const idMatch = /"id"\s*:\s*"?(\d{6,})"?/.exec(text);
    return { status: 'duplicate', leadId: idMatch?.[1] ?? null };
  }
  return { status: 'failed', message: res.message || 'Lead creation failed' };
}

/** Widget payload building: name split, digits-only 10-char phone, optional extras. */
export async function createLeadFromCarrier(row: CarrierSearchRow): Promise<LeadOutcome> {
  // Widget: only split off a last name when there are 2+ tokens; a single-word owner name
  // stays in BOTH first and last (never an empty firstName).
  const parts = (row.owner_full_name ?? '').trim().split(/\s+/).filter(Boolean);
  const lastName = parts.length > 1 ? String(parts.pop()) : (parts[0] ?? 'Unknown');
  const firstName = parts.length > 1 ? parts.join(' ') : (parts[0] ?? '');
  const phone = (row.phone_number ?? '').replace(/\D/g, '').slice(0, 10);
  const payload: Record<string, string> = {
    firstName,
    lastName,
    companyName: row.owner_full_name || 'Unknown',
    phone,
    ...(row.email ? { email: row.email } : {}),
    ...(row.dot_number != null ? { dot: String(row.dot_number) } : {}),
    ...(row.physical_address ? { fullAddress: row.physical_address } : {}),
    ...(row.truck_size ? { truckSize: String(row.truck_size) } : {}),
    ...(row.power_units != null ? { powerUnits: String(row.power_units) } : {}),
    ...(row.add_date ? { addDate: String(row.add_date).slice(0, 10) } : {}),
    ...(row.change_date ? { changeDate: String(row.change_date).slice(0, 10) } : {}),
    ...(row.operating_status ? { operatingStatus: row.operating_status } : {}),
  };
  return leadOutcomeOf(await callTouchpoint('leads.create', { createPayload: payload }));
}

// ---- Create panel: lead form + escalation ----

export async function createLead(form: {
  salutation: string;
  firstName: string;
  lastName: string;
  companyName: string;
  phone: string;
}): Promise<LeadOutcome> {
  return leadOutcomeOf(
    await callTouchpoint('leads.create', {
      createPayload: {
        salutation: form.salutation,
        firstName: form.firstName,
        lastName: form.lastName,
        companyName: form.companyName,
        phone: form.phone,
      },
    }),
  );
}

export const ESCALATION_REASONS = [
  'Problem with the client',
  'Question',
  'Personal Request',
  'CITI Fuel Duplicate',
  'CRM Question',
  'Lead / Deal Transfer',
  'Mobile App Issue',
  'RingCentral Number Issue',
  'Additional Discounts',
  'Other',
] as const;

export async function createEscalation(form: {
  reason: string;
  subject: string;
  description: string;
}): Promise<{ ticketId: string; escalationId: string }> {
  const res = await callTouchpoint('tickets.create_escalation', {
    escalationReason: form.reason,
    questionSubject: form.subject,
    description: form.description,
    attachmentUrl: '',
  });
  if (!res.ticketId || !res.escalationId) {
    throw new Error(res.message || 'Escalation was not created — no ticket id returned.');
  }
  return { ticketId: String(res.ticketId), escalationId: String(res.escalationId) };
}
