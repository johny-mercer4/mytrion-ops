/**
 * Zoho Desk — read access to tickets & departments (auth + base URL + orgId from the Zoho wrapper).
 *
 * List tickets: `GET /tickets` (params: status, departmentId, from [1-based], limit ≤100, sortBy,
 * include). Response `{ data: [...] }`; HTTP 204 = no tickets. The `orgId` header is mandatory and
 * is auto-attached by wrapper.authHeaders('zoho_desk').
 * See .claude/skills/zoho-desk-api/SKILL.md §3 (tickets) and §2 (departments).
 */
import { authHeaders, baseUrl } from './wrapper.js';

const DEFAULT_LIMIT = 20;
// Desk caps record lists (tickets/contacts/…) at 99, but allows 200 for departments/agents.
const MAX_TICKET_LIMIT = 99;
const MAX_DEPARTMENT_LIMIT = 200;

// Related entities to embed on ticket reads (nested contact.account, assignee, team, department name).
const TICKET_INCLUDE = 'contacts,assignee,team,departments';
// Standard + custom fields to surface. Listing `fields` makes Desk return the named custom fields
// inline in `cf` (incl. cf_crm_created_by_id) WITHOUT the Desk.search scope — this is what lets us
// creator-scope the list. Everything mapTicket renders must be listed here (fields restricts output).
const TICKET_FIELDS = [
  'id', 'ticketNumber', 'subject', 'status', 'statusType', 'priority', 'channel',
  'createdTime', 'dueDate', 'isOverDue',
  'cf_crm_created_by_id', 'cf_target_department', 'cf_carrier_id_application_id',
  'cf_ticket_type', 'cf_original_stream_manager',
].join(',');

/** sortBy values Desk accepts for /tickets; '-' prefix = descending. */
export type TicketSort = 'createdTime' | '-createdTime' | 'dueDate' | '-dueDate' | 'recentThread' | '-recentThread';

export interface ListTicketsInput {
  /** Filter by status, e.g. 'Open', 'Closed', 'On Hold'. */
  status?: string | undefined;
  /** Restrict to one department (Desk department id). */
  departmentId?: string | undefined;
  limit?: number | undefined;
  sortBy?: TicketSort | undefined;
}

export interface TicketSummary {
  id: string;
  ticketNumber?: string;
  subject?: string;
  status?: string;
  priority?: string;
  departmentId?: string;
  assigneeId?: string;
  createdTime?: string;
  dueDate?: string;
}

interface DeskListResponse<T> {
  data?: T[];
}

function clampLimit(limit: number | undefined, max: number): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), max);
}

function deskUrl(path: string): string {
  return `${baseUrl('zoho_desk').replace(/\/+$/, '')}${path}`;
}

async function deskGet<T>(url: URL): Promise<T[]> {
  const res = await fetch(url, { headers: await authHeaders('zoho_desk') });
  if (res.status === 204) return []; // no content
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[zoho-desk] GET ${url.pathname} HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = text ? (JSON.parse(text) as DeskListResponse<T>) : {};
  return Array.isArray(json.data) ? json.data : [];
}

function toSummary(t: Record<string, unknown>): TicketSummary {
  const pick = (k: string): string | undefined => (typeof t[k] === 'string' ? (t[k] as string) : undefined);
  const summary: TicketSummary = { id: String(t.id ?? '') };
  const ticketNumber = pick('ticketNumber');
  const subject = pick('subject');
  const status = pick('status');
  const priority = pick('priority');
  const departmentId = pick('departmentId');
  const assigneeId = pick('assigneeId');
  const createdTime = pick('createdTime');
  const dueDate = pick('dueDate');
  if (ticketNumber !== undefined) summary.ticketNumber = ticketNumber;
  if (subject !== undefined) summary.subject = subject;
  if (status !== undefined) summary.status = status;
  if (priority !== undefined) summary.priority = priority;
  if (departmentId !== undefined) summary.departmentId = departmentId;
  if (assigneeId !== undefined) summary.assigneeId = assigneeId;
  if (createdTime !== undefined) summary.createdTime = createdTime;
  if (dueDate !== undefined) summary.dueDate = dueDate;
  return summary;
}

/** List recent tickets (newest first by default), optionally filtered by status / department. */
export async function listTickets(input: ListTicketsInput = {}): Promise<TicketSummary[]> {
  const url = new URL(deskUrl('/tickets'));
  url.searchParams.set('from', '1');
  url.searchParams.set('limit', String(clampLimit(input.limit, MAX_TICKET_LIMIT)));
  url.searchParams.set('sortBy', input.sortBy ?? '-createdTime');
  if (input.status) url.searchParams.set('status', input.status);
  if (input.departmentId) url.searchParams.set('departmentId', input.departmentId);
  const rows = await deskGet<Record<string, unknown>>(url);
  return rows.map(toSummary);
}

/**
 * List recent tickets as RAW objects with the related entities the dashboard renders — the same
 * shape `searchTicketsByCreator` returns, so the route can fall back to this when the search scope
 * is missing without losing the account/contact/assignee/department the UI needs. `include` pulls
 * the nested `contact.account.accountName`, `assignee`, `team` and `department` (name) in one call.
 */
export async function listTicketsDetailed(input: ListTicketsInput = {}): Promise<Record<string, unknown>[]> {
  const url = new URL(deskUrl('/tickets'));
  url.searchParams.set('from', '1');
  url.searchParams.set('limit', String(clampLimit(input.limit, MAX_TICKET_LIMIT)));
  url.searchParams.set('sortBy', input.sortBy ?? '-createdTime');
  url.searchParams.set('include', TICKET_INCLUDE);
  if (input.status) url.searchParams.set('status', input.status);
  if (input.departmentId) url.searchParams.set('departmentId', input.departmentId);
  return deskGet<Record<string, unknown>>(url);
}

/** One page of recent tickets carrying the display fields + `cf` (incl. cf_crm_created_by_id). */
async function ticketsPage(from: number, limit: number): Promise<Record<string, unknown>[]> {
  const url = new URL(deskUrl('/tickets'));
  url.searchParams.set('from', String(Math.max(1, Math.trunc(from))));
  url.searchParams.set('limit', String(clampLimit(limit, MAX_TICKET_LIMIT)));
  url.searchParams.set('sortBy', '-createdTime');
  url.searchParams.set('include', TICKET_INCLUDE);
  url.searchParams.set('fields', TICKET_FIELDS);
  return deskGet<Record<string, unknown>>(url);
}

/**
 * Tickets created by a given CRM user, WITHOUT the Desk.search scope. Desk's `fields` param returns
 * the `cf_crm_created_by_id` custom field inline in the list, so we page over the most-recent tickets
 * (in parallel) and keep the ones whose creator matches — the same filter the reference dashboard runs
 * server-side via /tickets/search. Bounded to `maxPages` × 99 recent tickets (a recency window; the
 * search scope removes the bound). De-duped by id. Returns RAW ticket objects for the UI to map.
 */
export async function listTicketsByCreator(
  crmUserId: string,
  opts: { maxPages?: number } = {},
): Promise<Record<string, unknown>[]> {
  if (!crmUserId) return [];
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 6, 12));
  const froms = Array.from({ length: maxPages }, (_, i) => 1 + i * MAX_TICKET_LIMIT);
  const pages = await Promise.all(
    froms.map((from) => ticketsPage(from, MAX_TICKET_LIMIT).catch(() => [] as Record<string, unknown>[])),
  );
  const target = String(crmUserId);
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  for (const row of pages.flat()) {
    const cf = (row.cf ?? {}) as Record<string, unknown>;
    if (String(cf.cf_crm_created_by_id ?? '') !== target) continue;
    const id = String(row.id ?? '');
    if (id && seen.has(id)) continue;
    if (id) seen.add(id);
    out.push(row);
  }
  return out;
}

/**
 * A ticket's threads — the actual customer↔agent messages (email/web/escalation content), oldest
 * first. `direction: 'in'` is the requester, `'out'` an agent reply. Auto-created tickets (e.g.
 * Rejection Reports) carry their body here as the description thread, NOT as a comment — the
 * conversation view merges these with agent comments.
 */
export async function getTicketThreads(ticketId: string, limit = 30): Promise<Record<string, unknown>[]> {
  const url = new URL(deskUrl(`/tickets/${encodeURIComponent(ticketId)}/threads`));
  url.searchParams.set('from', '1');
  url.searchParams.set('limit', String(clampLimit(limit, MAX_TICKET_LIMIT)));
  return deskGet<Record<string, unknown>>(url);
}

/**
 * One thread's FULL object — the list endpoint returns only a truncated `summary` preview; the full
 * `content` (the whole message body) is only on this per-thread GET. Used to expand the conversation
 * so long customer emails aren't cut off. Returns the raw thread object.
 */
export async function getTicketThread(ticketId: string, threadId: string): Promise<Record<string, unknown>> {
  const url = deskUrl(`/tickets/${encodeURIComponent(ticketId)}/threads/${encodeURIComponent(threadId)}`);
  const res = await fetch(url, { headers: await authHeaders('zoho_desk') });
  if (res.status === 204) return {};
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[zoho-desk] GET /tickets/${ticketId}/threads/${threadId} HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

export interface DeskDepartment {
  id: string;
  name?: string;
  isEnabled?: boolean;
}

/**
 * Search the tickets a given CRM user created — the Sales ticket dashboard's list. Filters on
 * the custom field `cf_crm_created_by_id` (set when a ticket is created from the widget), newest
 * first. Returns the RAW Desk ticket objects (the dashboard needs custom fields + names), so the
 * route/UI maps them. `from` is 1-based; Desk caps `limit` at 99.
 */
export async function searchTicketsByCreator(
  crmUserId: string,
  opts: { from?: number; limit?: number } = {},
): Promise<Record<string, unknown>[]> {
  const url = new URL(deskUrl('/tickets/search'));
  url.searchParams.set('customField1', `cf_crm_created_by_id:${crmUserId}`);
  url.searchParams.set('from', String(Math.max(1, Math.trunc(opts.from ?? 1))));
  url.searchParams.set('limit', String(clampLimit(opts.limit, MAX_TICKET_LIMIT)));
  // /tickets/search wraps rows in `{ data: [...] }` on 200 and 204s when empty (deskGet handles both).
  return deskGet<Record<string, unknown>>(url);
}

/** A ticket's conversation (comments + agent replies), oldest→newest as the UI renders them. */
export async function getTicketComments(ticketId: string, limit = 50): Promise<Record<string, unknown>[]> {
  const url = new URL(deskUrl(`/tickets/${encodeURIComponent(ticketId)}/comments`));
  url.searchParams.set('from', '1');
  url.searchParams.set('limit', String(clampLimit(limit, MAX_TICKET_LIMIT)));
  url.searchParams.set('sortBy', 'commentedTime');
  // NOTE: Desk embeds the `commenter` (name/email/type) by default here — do NOT add
  // include=commenter (it's not an allowed value and 422s the whole request).
  return deskGet<Record<string, unknown>>(url);
}

/** Post an agent reply/comment on a ticket. `isPublic` true = customer-visible reply. */
export async function postTicketComment(
  ticketId: string,
  content: string,
  isPublic = true,
): Promise<Record<string, unknown>> {
  const url = deskUrl(`/tickets/${encodeURIComponent(ticketId)}/comments`);
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...(await authHeaders('zoho_desk')), 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, contentType: 'plainText', isPublic }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[zoho-desk] POST /tickets/${ticketId}/comments HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

/** List departments — useful both for connectivity checks and mapping a name → departmentId. */
export async function listDepartments(limit = 50): Promise<DeskDepartment[]> {
  const url = new URL(deskUrl('/departments'));
  url.searchParams.set('from', '1');
  url.searchParams.set('limit', String(clampLimit(limit, MAX_DEPARTMENT_LIMIT)));
  const rows = await deskGet<Record<string, unknown>>(url);
  return rows.map((d) => {
    const dept: DeskDepartment = { id: String(d.id ?? '') };
    if (typeof d.name === 'string') dept.name = d.name;
    if (typeof d.isEnabled === 'boolean') dept.isEnabled = d.isEnabled;
    return dept;
  });
}
