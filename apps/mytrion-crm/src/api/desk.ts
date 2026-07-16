/**
 * Zoho Desk tickets client (/v1/desk) — the Sales ticket dashboard. List is creator-scoped
 * server-side (the session's CRM user id; admins may target an agent). `scoped:false` means the
 * Desk token lacked the search scope and the server fell back to recent tickets.
 */
import { request, requestBlob, requestMultipart } from './transport';

// LEGACY assertion — the server now derives department access from the verified session (Zoho
// profile/role), so this header is IGNORED for signed-in users. Kept only so the
// FF_SESSION_DEPT_AUTHORITATIVE=0 rollback (and unverified API-key dev calls) stay functional;
// remove together with the flag.
const DESK_HEADERS = { 'x-department-access': 'sales' } as const;

export interface CreateTicketInput {
  department: 'cs' | 'billing' | 'verification' | 'maintenance';
  ticketType: string;
  dealId: string;
  subject: string;
  description: string;
  carrierId?: string | undefined;
  applicationId?: string | undefined;
  cardNumber?: string | undefined;
  contactName?: string | undefined;
  accountName?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  submitterName?: string | undefined;
}

/** Append only the defined string fields, then an optional file, to a FormData. */
function toForm(fields: Record<string, string | undefined>, file?: File | null): FormData {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== null && v !== '') form.append(k, v);
  }
  if (file) form.append('file', file, file.name);
  return form;
}

/** Create a support ticket (+ optional attachment). `attached` = the file was uploaded + linked. */
export async function createDeskTicket(
  input: CreateTicketInput,
  file?: File | null,
): Promise<{ ticketId: string; attached: boolean }> {
  const res = (await requestMultipart('/desk/tickets', toForm({ ...input }, file), {
    headers: DESK_HEADERS,
  })) as { ticketId: string; attached?: boolean };
  return { ticketId: res.ticketId, attached: res.attached ?? false };
}

/** Create an escalation request (+ optional attachment). Returns the ticket + escalation ids. */
export async function createEscalation(
  input: { subject: string; description: string; reason: string },
  file?: File | null,
): Promise<{ ticketId: string; escalationId: string; attached: boolean }> {
  const res = (await requestMultipart('/desk/escalations', toForm({ ...input }, file), {
    headers: DESK_HEADERS,
  })) as { ticketId: string; escalationId: string; attached?: boolean };
  return { ticketId: res.ticketId, escalationId: res.escalationId, attached: res.attached ?? false };
}

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

/** A Desk attachment on a comment/thread (id + name + byte size). */
export interface DeskAttachment {
  id?: string | number;
  name?: string;
  size?: string | number;
  href?: string;
}

export interface DeskComment {
  id?: string | number;
  content?: string;
  commenterId?: string;
  isPublic?: boolean;
  commentedTime?: string;
  attachments?: DeskAttachment[];
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
  attachments?: DeskAttachment[];
  /** 'in' = requester, 'out' = agent reply. */
  direction?: string;
  author?: { name?: string; email?: string; firstName?: string | null; lastName?: string | null; type?: string } | null;
  createdTime?: string;
  isDescriptionThread?: boolean;
  attachmentCount?: number;
  [k: string]: unknown;
}

export async function listDeskTickets(
  opts: { from?: number; limit?: number; zohoUserId?: string } = {},
): Promise<{
  tickets: DeskTicket[];
  scoped: boolean;
  /** True when the server fell back to the recency-window scan — that response is already the
   *  full (bounded) set, so callers must not request further pages. */
  windowed?: boolean;
}> {
  return (await request('GET', '/desk/tickets', {
    query: { from: opts.from, limit: opts.limit ?? 50, zoho_user_id: opts.zohoUserId },
    headers: DESK_HEADERS,
  })) as { tickets: DeskTicket[]; scoped: boolean; windowed?: boolean };
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

/** Post an agent reply, optionally with a file attachment (sent multipart when a file is present). */
export async function replyDeskTicket(
  ticketId: string,
  content: string,
  file?: File | null,
  isPublic = true,
): Promise<unknown> {
  const path = `/desk/tickets/${encodeURIComponent(ticketId)}/reply`;
  if (file) {
    const form = new FormData();
    form.append('content', content);
    form.append('is_public', String(isPublic));
    form.append('file', file, file.name);
    return requestMultipart(path, form, { headers: DESK_HEADERS });
  }
  return request('POST', path, { body: { content, is_public: isPublic }, headers: DESK_HEADERS });
}

/** Download a ticket attachment (auth'd blob → browser save). */
export async function downloadDeskAttachment(ticketId: string, attachmentId: string, fileName: string): Promise<void> {
  const blob = await requestBlob(
    `/desk/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(attachmentId)}/content`,
    { headers: DESK_HEADERS },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
