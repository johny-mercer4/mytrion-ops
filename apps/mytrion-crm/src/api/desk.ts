/**
 * Zoho Desk write client (/v1/desk) — the Sales Create tab's ticket + escalation submits.
 *
 * Restored 2026-08-03. Sales briefly filed through the native /v1/comms path; that console is parked
 * as coming-soon in every Mytrion, so Create files into Zoho Desk again — which is where Customer
 * Service, Billing and Verification actually work the queue.
 *
 * CREATE ONLY. The original file also carried the ticket-dashboard READS (listDeskTickets,
 * getDeskTicket, listDeskComments, replyDeskTicket, downloadDeskAttachment). Those are deliberately
 * not back: no UI reads Desk tickets while the Tickets tab is parked, and restoring them would mean
 * restoring TicketsTab and its whole cache/feed/optimistic cluster as dead code. The backend GET
 * /v1/desk/* routes still exist, so re-adding a reader later is a client-side change only.
 *
 * Both submits are multipart so a file rides along with the fields in ONE request — the server puts it
 * on the Desk ticket's Attachments tab, falling back to the linked CRM record if the Desk token lacks
 * attachment scope. `attached` tells the UI which happened.
 */
import { request, requestMultipart } from './transport';

// LEGACY assertion — the server now derives department access from the verified session (Zoho
// profile/role), so this header is IGNORED for signed-in users. Kept only so the
// FF_SESSION_DEPT_AUTHORITATIVE=0 rollback (and unverified API-key dev calls) stay functional;
// remove together with the flag.
const DESK_HEADERS = { 'x-department-access': 'sales' } as const;

/** Desk's own `priority` picklist — case-sensitive, and this org has no 'Urgent'. */
export type TicketPriority = 'Low' | 'Medium' | 'High';
/** Desk's "no priority" member. Desk stores it and reads it back as null. */
export const NO_PRIORITY = '-None-';
/** What a priority CHANGE may set: the picklist plus "no priority". */
export type PriorityValue = TicketPriority | typeof NO_PRIORITY;

export interface CreateTicketInput {
  department: 'cs' | 'billing' | 'verification' | 'maintenance';
  ticketType: string;
  dealId: string;
  subject: string;
  description: string;
  priority?: TicketPriority | undefined;
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

export interface MyDeskTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  status: string;
  /** '-None-' when Desk has no priority on the ticket (it reads back as null). */
  priority: PriorityValue;
  createdTime: string;
}

const PRIORITIES: readonly string[] = ['Low', 'Medium', 'High'];

/**
 * The caller's own recent Desk tickets (server scopes by cf_crm_created_by_id).
 *
 * `scan_pages` caps the server's fallback scan. The Desk token has no `Desk.search.READ` scope, so
 * the server pages over recent org tickets and filters by creator — the full 100-page sweep takes
 * ~28s and trips the 20s transport timeout. 10 pages ≈ the ~1k most recent org tickets, which is
 * where an agent's own recent filings are.
 */
export async function listMyDeskTickets(limit = 5): Promise<MyDeskTicket[]> {
  const res = (await request('GET', '/desk/tickets', {
    query: { limit, scan_pages: 10 },
    headers: DESK_HEADERS,
  })) as { tickets?: Record<string, unknown>[] };
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  return (res.tickets ?? []).map((t) => ({
    id: str(t.id),
    ticketNumber: str(t.ticketNumber),
    subject: str(t.subject),
    status: str(t.status),
    priority: (PRIORITIES.includes(str(t.priority)) ? str(t.priority) : NO_PRIORITY) as PriorityValue,
    createdTime: str(t.createdTime),
  }));
}

/** Re-prioritise a ticket after it was filed (owner-scoped server-side). */
export async function updateDeskTicketPriority(
  ticketId: string,
  priority: PriorityValue,
): Promise<PriorityValue> {
  const res = (await request('PATCH', `/desk/tickets/${encodeURIComponent(ticketId)}/priority`, {
    body: { priority },
    headers: DESK_HEADERS,
  })) as { priority?: PriorityValue };
  return res.priority ?? priority;
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
