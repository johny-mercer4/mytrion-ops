/**
 * Zoho Desk tickets client (/v1/desk) — the Sales ticket dashboard. List is creator-scoped
 * server-side (the session's CRM user id; admins may target an agent). `scoped:false` means the
 * Desk token lacked the search scope and the server fell back to recent tickets.
 */
import { request } from './transport';

// The Desk ticket endpoints are Sales-Mytrion-scoped; assert the department so a signed-in Sales
// agent (whose session carries no department by default) clears the route's sales-access gate.
const DESK_HEADERS = { 'x-department-access': 'sales' } as const;

export interface DeskTicket {
  id: string | number;
  ticketNumber?: string;
  number?: string;
  subject?: string;
  status?: string;
  priority?: string;
  channel?: string;
  departmentId?: string;
  /** With ?include=departments this is an object; older/stripped payloads may be a string. */
  department?: { id?: string; name?: string } | string | null;
  team?: { id?: string; name?: string } | null;
  assignee?: { name?: string; firstName?: string | null; lastName?: string | null } | null;
  contactName?: string;
  /** With ?include=contacts the account name is nested under contact.account. */
  contact?: {
    firstName?: string | null;
    lastName?: string | null;
    account?: { accountName?: string } | null;
  } | null;
  accountName?: string;
  createdTime?: string;
  dueDate?: string;
  isOverDue?: boolean;
  cf?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface DeskComment {
  id?: string | number;
  content?: string;
  commenterId?: string;
  isPublic?: boolean;
  commentedTime?: string;
  /** Zoho Desk exposes the writer as `commenter` (a Desk agent), NOT `author` (that's a thread field). */
  commenter?: {
    name?: string;
    email?: string;
    type?: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
  /** Server-set: this comment was posted via the app's Desk agent → it's the caller's own ("me"). */
  mine?: boolean;
  [k: string]: unknown;
}

/** A ticket thread — the requester/agent message body (email/web/escalation), not an agent comment. */
export interface DeskThread {
  id?: string | number;
  summary?: string;
  content?: string;
  /** 'in' = requester, 'out' = agent reply. */
  direction?: string;
  author?: { name?: string; email?: string; firstName?: string | null; lastName?: string | null; type?: string } | null;
  createdTime?: string;
  isDescriptionThread?: boolean;
  attachmentCount?: number;
  [k: string]: unknown;
}

export async function listDeskTickets(opts: { limit?: number; zohoUserId?: string } = {}): Promise<{
  tickets: DeskTicket[];
  scoped: boolean;
}> {
  return (await request('GET', '/desk/tickets', {
    query: { limit: opts.limit ?? 50, zoho_user_id: opts.zohoUserId },
    headers: DESK_HEADERS,
  })) as { tickets: DeskTicket[]; scoped: boolean };
}

export async function listDeskComments(
  ticketId: string,
  limit = 50,
): Promise<{ comments: DeskComment[]; threads: DeskThread[] }> {
  const res = (await request('GET', `/desk/tickets/${encodeURIComponent(ticketId)}/comments`, {
    query: { limit },
    headers: DESK_HEADERS,
  })) as { comments?: DeskComment[]; threads?: DeskThread[] };
  return { comments: res.comments ?? [], threads: res.threads ?? [] };
}

export async function replyDeskTicket(ticketId: string, content: string, isPublic = true): Promise<unknown> {
  return request('POST', `/desk/tickets/${encodeURIComponent(ticketId)}/reply`, {
    body: { content, is_public: isPublic },
    headers: DESK_HEADERS,
  });
}

/** Resolve ('Closed') or reopen ('Open') a ticket. */
export async function setDeskTicketStatus(ticketId: string, status: 'Open' | 'Closed'): Promise<unknown> {
  return request('POST', `/desk/tickets/${encodeURIComponent(ticketId)}/status`, {
    body: { status },
    headers: DESK_HEADERS,
  });
}
