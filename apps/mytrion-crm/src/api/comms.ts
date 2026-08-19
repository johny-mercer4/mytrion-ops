/**
 * Native comms client (/v1/comms) — tickets, escalations and the conversation they share.
 *
 * Replaces api/desk.ts. The shapes here are the server's DTOs verbatim, so there is no `cf_*` custom-field
 * bag, no `scoped`/`windowed` Desk-search fallback, and authorship is a real user id rather than something
 * inferred from a display name.
 *
 * ONE conversation API for everything: a ticket and an escalation both hang off a THREAD, so messages,
 * attachments and read state are `/comms/threads/:id/...` in both cases. That is what lets one chat
 * component serve tickets today and escalations and DMs without a second implementation.
 */
import { request, requestMultipart } from './transport';

export type TicketKind = 'ticket' | 'request' | 'escalation';
export type TicketStatus =
  | 'open'
  | 'in_progress'
  | 'pending_requester'
  | 'on_hold'
  | 'escalated'
  | 'resolved'
  | 'closed'
  | 'cancelled';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export interface TicketDto {
  id: string;
  threadId: string;
  number: string;
  kind: TicketKind;
  subject: string;
  status: TicketStatus;
  substatus: string | null;
  priority: TicketPriority;
  /** Free-form triage labels. Empty array, never null. */
  tags: string[];
  typeCode: string | null;
  typeLabel: string | null;
  targetDepartment: string | null;
  sourceDepartment: string | null;
  sourceMytrion: string | null;
  requester: { zohoUserId: string | null; carrierId: string | null; name: string };
  assignee: { zohoUserId: string; name: string | null } | null;
  /** Null on an escalation — those are personal and carry no client by DB constraint. */
  client: {
    carrierId: string | null;
    companyName: string | null;
    applicationId: string | null;
    crmDealId: string | null;
    /** Last four only; the full card never leaves the server. */
    cardLast4: string | null;
  } | null;
  sla: {
    hours: number | null;
    dueAt: string | null;
    firstResponseDueAt: string | null;
    firstResponseAt: string | null;
    breachedAt: string | null;
    /** Server-computed, so two clients on different clocks agree about lateness. */
    overdue: boolean;
  };
  escalation: { id: string; level: number | null; levelLabel: string | null } | null;
  channel: string;
  messageCount: number;
  lastMessageAt: string;
  lastMessageSeq: number;
  lastMessagePreview?: string | null;
  unread: number;
  version: number;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageDto {
  id: string;
  seq: number;
  kind: 'message' | 'note' | 'system';
  body: string;
  bodyFormat: 'text' | 'markdown';
  author: {
    kind: 'worker' | 'carrier' | 'system';
    zohoUserId: string | null;
    carrierId: string | null;
    name: string | null;
  };
  isInternal: boolean;
  systemEvent: string | null;
  mentions: string[];
  editedAt: string | null;
  redactedAt: string | null;
  createdAt: string;
  /** Server-computed from the session — an id match, never a name heuristic. */
  mine: boolean;
}

export interface ThreadDto {
  id: string;
  kind: string;
  visibility: string;
  department: string | null;
  subject: string;
  state: string;
  messageCount: number;
  lastMessageSeq: number;
}

export interface ParticipantDto {
  kind: 'worker' | 'carrier';
  key: string;
  name: string | null;
  role: 'requester' | 'assignee' | 'watcher' | 'approver' | 'participant';
  state: 'active' | 'left' | 'muted';
}

export interface AttachmentDto {
  id: string;
  messageId: string | null;
  name: string;
  mime: string | null;
  sizeBytes: number | null;
  storage: 's3' | 'dropbox';
  isInternal: boolean;
  uploadedBy: string | null;
  createdAt: string;
}

export interface TicketTypeDto {
  code: string;
  label: string;
  group: string | null;
  targetDepartment: string | null;
  defaultPriority: string | null;
  slaHours: number | null;
  requiresCarrier: boolean;
  requiresCard: boolean;
  automationKey: string | null;
  requestable: boolean;
  sortOrder: number;
}

export interface EscalationReasonDto {
  code: string;
  label: string;
  sortOrder: number;
  /** False = nobody is configured, so raising on it is refused. The picker disables it. */
  routed: boolean;
}

export interface DepartmentOptionDto {
  /** The routing key sent back when opening a request against this department. */
  department: string;
  /** HR's display name. */
  label: string;
  acceptsTickets: boolean;
  acceptsEscalations: boolean;
}

export interface CommsCatalog {
  ticketTypes: TicketTypeDto[];
  escalationReasons: EscalationReasonDto[];
  departments: DepartmentOptionDto[];
  sla: {
    resolutionHoursByPriority: Record<string, number>;
    firstResponseHoursByPriority: Record<string, number>;
  };
}

export async function getCommsCatalog(): Promise<CommsCatalog> {
  return (await request('GET', '/comms/catalog')) as CommsCatalog;
}

export interface ListTicketsParams {
  kind?: TicketKind;
  /** Comma-joined statuses. Absent = every status, which is what a history view wants. */
  status?: string;
  department?: string;
  assignee?: string;
  requester?: string;
  carrierId?: string;
  /** Narrow to tickets carrying this exact tag. */
  tag?: string;
  q?: string;
  cursor?: string;
  limit?: number;
  /** 'mine' narrows to tickets the caller raised. Narrowing only — never widening. */
  scope?: 'mine' | 'all';
}

export interface TicketPage {
  tickets: TicketDto[];
  hasMore: boolean;
  nextCursor: string | null;
}

export async function listTickets(
  params: ListTicketsParams = {},
  options: { signal?: AbortSignal } = {},
): Promise<TicketPage> {
  return (await request('GET', '/comms/tickets', {
    query: {
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.department ? { department: params.department } : {}),
      ...(params.assignee ? { assignee: params.assignee } : {}),
      ...(params.requester ? { requester: params.requester } : {}),
      ...(params.carrierId ? { carrier_id: params.carrierId } : {}),
      ...(params.tag ? { tag: params.tag } : {}),
      ...(params.q ? { q: params.q } : {}),
      ...(params.cursor ? { cursor: params.cursor } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
      ...(params.scope ? { scope: params.scope } : {}),
    },
    signal: options.signal,
  })) as TicketPage;
}

export async function getTicket(id: string): Promise<TicketDto> {
  const res = (await request('GET', `/comms/tickets/${encodeURIComponent(id)}`)) as {
    ticket: TicketDto;
  };
  return res.ticket;
}

export interface TicketEventDto {
  id: string;
  eventType: string;
  actor: { zohoUserId: string | null; name: string | null };
  fromStatus: string | null;
  toStatus: string | null;
  detail: Record<string, unknown> | null;
  occurredAt: string;
}

export async function listTicketEvents(id: string): Promise<TicketEventDto[]> {
  const res = (await request('GET', `/comms/tickets/${encodeURIComponent(id)}/events`)) as {
    events: TicketEventDto[];
  };
  return res.events;
}

/**
 * Move a ticket's status (agent action — resolve / close / reopen / put in progress). `expectedVersion`
 * is mandatory: the server 409s a stale decision rather than overwriting another agent's.
 */
export async function setTicketStatus(
  id: string,
  toStatus: TicketStatus,
  expectedVersion: number,
  comment?: string,
): Promise<{ ticket: TicketDto }> {
  return (await request('POST', `/comms/tickets/${encodeURIComponent(id)}/status`, {
    body: { toStatus, expectedVersion, ...(comment ? { comment } : {}) },
  })) as { ticket: TicketDto };
}

export type AgentAvailability = 'available' | 'away' | 'do_not_assign';

/** The signed-in agent's declared availability — governs whether the round-robin routes to them. */
export interface AvailabilityDto {
  zohoUserId: string;
  availability: AgentAvailability;
  availabilityNote: string | null;
  /** True when the SERVER parked them (dropped socket), not a choice they made. */
  autoAway: boolean;
  autoAwayReason: string | null;
  changedAt: string;
}

export async function getMyAvailability(): Promise<AvailabilityDto> {
  const res = (await request('GET', '/comms/me/availability')) as { availability: AvailabilityDto };
  return res.availability;
}

export async function setMyAvailability(
  availability: AgentAvailability,
  note?: string,
): Promise<AvailabilityDto> {
  const res = (await request('POST', '/comms/me/availability', {
    body: { availability, ...(note ? { note } : {}) },
  })) as { availability: AvailabilityDto };
  return res.availability;
}

/** Read-only aggregates behind the Desk Analytics & SLA tab — see commsAnalyticsRepo. */
export interface CommsAnalyticsDto {
  window: { sinceDays: number; since: string };
  totals: {
    all: number;
    open: number;
    resolved: number;
    closed: number;
    overdue: number;
    breached: number;
  };
  sla: {
    firstResponseMet: number;
    firstResponseMissed: number;
    firstResponsePending: number;
    avgResolutionHours: number | null;
    avgFirstResponseHours: number | null;
  };
  byStatus: { key: string; count: number }[];
  byPriority: { key: string; count: number }[];
  byDepartment: { key: string | null; count: number }[];
  /** Dense daily series over the window — every day present, zeros included. */
  volume: { date: string; created: number; resolved: number }[];
  topAssignees: { zohoUserId: string; name: string | null; open: number }[];
}

export async function getCommsAnalytics(
  params: { kind?: TicketKind; department?: string; sinceDays?: number } = {},
  options: { signal?: AbortSignal } = {},
): Promise<CommsAnalyticsDto> {
  return (await request('GET', '/comms/analytics', {
    query: {
      ...(params.kind ? { kind: params.kind } : {}),
      ...(params.department ? { department: params.department } : {}),
      ...(params.sinceDays ? { sinceDays: params.sinceDays } : {}),
    },
    signal: options.signal,
  })) as CommsAnalyticsDto;
}

/**
 * Change a ticket's priority. `expectedVersion` is mandatory: the server 409s a stale decision rather
 * than overwriting another agent's re-prioritisation.
 */
export async function setTicketPriority(
  id: string,
  toPriority: TicketPriority,
  expectedVersion: number,
): Promise<{ ticket: TicketDto }> {
  return (await request('POST', `/comms/tickets/${encodeURIComponent(id)}/priority`, {
    body: { toPriority, expectedVersion },
  })) as { ticket: TicketDto };
}

/** One seat on a department's assignment roster, with the rotation cursor in plain sight. */
export interface RosterMemberDto {
  zohoUserId: string;
  name: string | null;
  roleTitle: string | null;
  active: boolean;
  acceptsNew: boolean;
  maxOpen: number | null;
  sortOrder: number;
  /** Least-recently-assigned goes next under round-robin. */
  lastAssignedAt: string | null;
  assignedCount: number;
}

export interface QueueRoster {
  department: string;
  strategy: string;
  requireOnline: boolean;
  roster: RosterMemberDto[];
}

/** The roster a queue draws from — the candidate pool a reassign picks out of. */
export async function getQueueRoster(department: string): Promise<QueueRoster> {
  return (await request(
    'GET',
    `/comms/queue/${encodeURIComponent(department)}/roster`,
  )) as QueueRoster;
}

/** Replace a ticket's triage tags. The server normalises (trim / dedupe / cap) the set. */
export async function setTicketTags(id: string, tags: string[]): Promise<{ ticket: TicketDto }> {
  return (await request('POST', `/comms/tickets/${encodeURIComponent(id)}/tags`, {
    body: { tags },
  })) as { ticket: TicketDto };
}

/**
 * Claim a ticket for yourself (omit `toZohoUserId`) or assign it to a colleague. The target must hold a
 * seat on the ticket's department roster — the same list the round-robin draws from.
 */
export async function assignTicket(
  id: string,
  toZohoUserId?: string,
): Promise<{ ticket: TicketDto }> {
  return (await request('POST', `/comms/queue/${encodeURIComponent(id)}/assign`, {
    body: toZohoUserId ? { toZohoUserId } : {},
  })) as { ticket: TicketDto };
}

/** Hand a ticket back to the queue. Only the current holder (or an admin) may do it. */
export async function releaseTicket(id: string): Promise<{ ticket: TicketDto }> {
  return (await request('POST', `/comms/queue/${encodeURIComponent(id)}/release`, {
    body: {},
  })) as { ticket: TicketDto };
}

export interface CreateTicketInput {
  /** Catalog code. Chooses the queue — there is deliberately no `department` field. */
  typeCode: string;
  subject: string;
  description: string;
  dealId: string;
  cardNumber?: string;
  priority?: TicketPriority;
  sourceMytrion?: string;
  idempotencyKey?: string;
}

export async function createTicket(input: CreateTicketInput): Promise<{ ticket: TicketDto }> {
  return (await request('POST', '/comms/tickets', { body: input })) as { ticket: TicketDto };
}

// ---------------------------------------------------------------------------------------------
// Conversation — shared by tickets and escalations
// ---------------------------------------------------------------------------------------------

export interface ThreadMessages {
  thread: ThreadDto;
  messages: MessageDto[];
  participants: ParticipantDto[];
}

export async function listThreadMessages(
  threadId: string,
  opts: { afterSeq?: number; beforeSeq?: number; limit?: number } = {},
): Promise<ThreadMessages> {
  return (await request('GET', `/comms/threads/${encodeURIComponent(threadId)}/messages`, {
    query: {
      ...(opts.afterSeq !== undefined ? { after_seq: opts.afterSeq } : {}),
      ...(opts.beforeSeq !== undefined ? { before_seq: opts.beforeSeq } : {}),
      ...(opts.limit !== undefined ? { limit: opts.limit } : {}),
    },
  })) as ThreadMessages;
}

export async function postThreadMessage(
  threadId: string,
  input: { body: string; isInternal?: boolean; clientMsgId?: string; mentions?: string[] },
): Promise<{ message: MessageDto }> {
  return (await request('POST', `/comms/threads/${encodeURIComponent(threadId)}/messages`, {
    body: input,
  })) as { message: MessageDto };
}

/** Monotonic on the server — a lower seq is ignored, so racing tabs cannot un-read a thread. */
export async function markThreadRead(threadId: string, seq: number): Promise<{ seq: number }> {
  return (await request('POST', `/comms/threads/${encodeURIComponent(threadId)}/read`, {
    body: { seq },
  })) as { seq: number };
}

export async function getUnreadTotals(): Promise<{
  total: number;
  threads: { threadId: string; unread: number }[];
}> {
  return (await request('GET', '/comms/unread')) as {
    total: number;
    threads: { threadId: string; unread: number }[];
  };
}

export async function listThreadAttachments(threadId: string): Promise<AttachmentDto[]> {
  const res = (await request(
    'GET',
    `/comms/threads/${encodeURIComponent(threadId)}/attachments`,
  )) as { attachments: AttachmentDto[] };
  return res.attachments;
}

/**
 * Upload a file into the conversation.
 *
 * Arrives as ONE bubble: the server appends a message and links the file to it, so a caption and its
 * attachment are never two separate entries the way the Desk path forced.
 */
export async function uploadThreadAttachment(
  threadId: string,
  file: File,
  opts: { body?: string; isInternal?: boolean; clientMsgId?: string } = {},
): Promise<{ message: MessageDto; attachment: AttachmentDto }> {
  const form = new FormData();
  // Fields BEFORE the file: the server iterates parts, but keeping this order means a future switch to
  // `request.file()` would not silently drop them.
  if (opts.body) form.append('body', opts.body);
  if (opts.isInternal !== undefined) form.append('isInternal', String(opts.isInternal));
  if (opts.clientMsgId) form.append('clientMsgId', opts.clientMsgId);
  form.append('file', file, file.name);
  return (await requestMultipart(
    `/comms/threads/${encodeURIComponent(threadId)}/attachments`,
    form,
  )) as { message: MessageDto; attachment: AttachmentDto };
}

/**
 * A time-limited download URL.
 *
 * Fetched on click rather than embedded in a list: a Dropbox link is a network round trip and expires in
 * ~4 hours, so pre-generating one per row would be slow and would hand out links that die in an open tab.
 */
export async function getAttachmentLink(
  threadId: string,
  attachmentId: string,
): Promise<{ url: string; expiresAt: string; name: string; mime: string | null; sizeBytes: number | null }> {
  return (await request(
    'GET',
    `/comms/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachmentId)}/link`,
  )) as {
    url: string;
    expiresAt: string;
    name: string;
    mime: string | null;
    sizeBytes: number | null;
  };
}

// ---------------------------------------------------------------------------------------------
// Escalations
// ---------------------------------------------------------------------------------------------

export interface EscalationDto {
  id: string;
  threadId: string;
  ticketId: string;
  reasonCode: string | null;
  reasonLabel: string | null;
  requester: { zohoUserId: string; name: string; department: string | null };
  status: 'pending' | 'resolved' | 'rejected' | 'withdrawn' | 'expired';
  level: number;
  hopIndex: number;
  department: string | null;
  assignee: { zohoUserId: string; name: string | null } | null;
  hopDueAt: string | null;
  resolution: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  /** Echo back on the next transition so a stale decision 409s. */
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface EscalationHopDto {
  hopIndex: number;
  level: number;
  levelLabel: string;
  department: string | null;
  assignee: { zohoUserId: string; name: string | null } | null;
  routingSource: string;
  /** Why a level could not route — a gap in the ladder must stay visible. */
  skipReason: string | null;
  handoffNote: string | null;
  decidedBy: string | null;
  decision: string | null;
  status: string;
  decisionComment: string | null;
  dueAt: string | null;
  openedAt: string;
  decidedAt: string | null;
}

export async function listEscalations(
  params: { status?: string; scope?: 'mine' | 'inbox' | 'all'; department?: string; limit?: number } = {},
): Promise<EscalationDto[]> {
  const res = (await request('GET', '/comms/escalations', {
    query: {
      ...(params.status ? { status: params.status } : {}),
      ...(params.scope ? { scope: params.scope } : {}),
      ...(params.department ? { department: params.department } : {}),
      ...(params.limit ? { limit: params.limit } : {}),
    },
  })) as { escalations: EscalationDto[] };
  return res.escalations;
}

export async function getEscalation(
  id: string,
): Promise<{ escalation: EscalationDto; hops: EscalationHopDto[]; thread: ThreadDto | null }> {
  return (await request('GET', `/comms/escalations/${encodeURIComponent(id)}`)) as {
    escalation: EscalationDto;
    hops: EscalationHopDto[];
    thread: ThreadDto | null;
  };
}

export async function createEscalation(input: {
  reasonCode: string;
  /** The department this request is aimed at. Level 2 is that department's own agent. */
  targetDepartment?: string;
  subject: string;
  description: string;
  sourceMytrion?: string;
  idempotencyKey?: string;
}): Promise<{ escalation: EscalationDto; number: string; threadId: string }> {
  return (await request('POST', '/comms/escalations', { body: input })) as {
    escalation: EscalationDto;
    number: string;
    threadId: string;
  };
}

type EscalationAction = 'escalate' | 'handoff' | 'resolve' | 'reject' | 'withdraw';

/**
 * Move an escalation. `expectedVersion` is mandatory for every transition — the server 409s a stale one
 * rather than letting two managers silently overwrite each other's decision.
 */
export async function actOnEscalation(
  id: string,
  action: EscalationAction,
  body: {
    expectedVersion: number;
    comment?: string;
    toZohoUserId?: string;
    toDepartment?: string;
  },
): Promise<{ escalation: EscalationDto }> {
  return (await request('POST', `/comms/escalations/${encodeURIComponent(id)}/${action}`, {
    body,
  })) as { escalation: EscalationDto };
}
