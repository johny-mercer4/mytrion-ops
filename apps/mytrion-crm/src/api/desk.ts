/**
 * Zoho Desk tickets client (/v1/desk) — the Sales ticket dashboard. List is creator-scoped
 * server-side (the session's CRM user id; admins may target an agent). `scoped:false` means the
 * Desk token lacked the search scope and the server fell back to recent tickets.
 */
import { request } from './transport';

export interface DeskTicket {
  id: string | number;
  ticketNumber?: string;
  number?: string;
  subject?: string;
  status?: string;
  priority?: string;
  channel?: string;
  departmentId?: string;
  department?: string;
  assignee?: { name?: string } | null;
  contactName?: string;
  contact?: { firstName?: string; lastName?: string } | null;
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
  author?: { name?: string; type?: string } | null;
  direction?: string;
  [k: string]: unknown;
}

export async function listDeskTickets(opts: { limit?: number; zohoUserId?: string } = {}): Promise<{
  tickets: DeskTicket[];
  scoped: boolean;
}> {
  return (await request('GET', '/desk/tickets', {
    query: { limit: opts.limit ?? 50, zoho_user_id: opts.zohoUserId },
  })) as { tickets: DeskTicket[]; scoped: boolean };
}

export async function listDeskComments(ticketId: string, limit = 50): Promise<{ comments: DeskComment[] }> {
  return (await request('GET', `/desk/tickets/${encodeURIComponent(ticketId)}/comments`, {
    query: { limit },
  })) as { comments: DeskComment[] };
}

export async function replyDeskTicket(ticketId: string, content: string, isPublic = true): Promise<unknown> {
  return request('POST', `/desk/tickets/${encodeURIComponent(ticketId)}/reply`, {
    body: { content, is_public: isPublic },
  });
}
