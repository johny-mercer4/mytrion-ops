import type {
  MytrionDepartmentConfig,
  MytrionThread,
  MytrionThreadMessage,
  MytrionTicket,
  MytrionTicketEvent,
  MytrionTicketType,
} from '../../db/schema/index.js';
import type { TicketWithThread } from '../../repos/commsTicketRepo.js';
import { actorZohoUserIdOf } from '../../repos/commsThreadRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

/**
 * The single serialization boundary for the comms surface.
 *
 * Everything the REST layer returns is built here, for two reasons:
 *   1. Row objects carry columns a reader must not see. `mytrion_ticket_types.
 *      default_assignee_zoho_user_id` and `mytrion_department_config.manager_zoho_user_id` are ROUTING
 *      CONFIG — an ordinary agent has no business learning who a reason falls to, and returning the
 *      row verbatim would publish the whole escalation ladder to anyone who can open the picker. The
 *      UI only needs to know whether a reason is routable at all, which is the `routed` boolean.
 *   2. `snake_case` DB columns and Drizzle `Date` objects are not a wire contract. Serializing in one
 *      place is what lets the column set change without touching the client.
 */

export interface TicketTypeDto {
  code: string;
  label: string;
  group: string | null;
  /** The queue this type lands in. Informational for the UI; the server re-derives it on create. */
  targetDepartment: string | null;
  defaultPriority: string | null;
  slaHours: number | null;
  requiresCarrier: boolean;
  requiresCard: boolean;
  /** Drives the "you can do this yourself" deflection to an existing automation. */
  automationKey: string | null;
  requestable: boolean;
  sortOrder: number;
}

export interface EscalationReasonDto {
  code: string;
  label: string;
  sortOrder: number;
  /**
   * True when the reason has a level-2 fall-to user configured. False means an escalation on it cannot
   * be raised yet — the picker should disable the option rather than let an agent submit into a void.
   * The user id itself is never serialized here.
   */
  routed: boolean;
}

export interface DepartmentOptionDto {
  /** The routing key the client sends back when opening a request against this department. */
  department: string;
  /** HR's display name ('Billing & Accounting'), falling back to the slug. What the picker shows. */
  label: string;
  acceptsTickets: boolean;
  acceptsEscalations: boolean;
}

export function toTicketTypeDto(row: MytrionTicketType): TicketTypeDto {
  return {
    code: row.code,
    label: row.label,
    group: row.group,
    targetDepartment: row.targetDepartment,
    defaultPriority: row.defaultPriority,
    slaHours: row.slaHours,
    requiresCarrier: row.requiresCarrier,
    requiresCard: row.requiresCard,
    automationKey: row.automationKey,
    requestable: row.requestable,
    sortOrder: row.sortOrder,
  };
}

export function toEscalationReasonDto(row: MytrionTicketType): EscalationReasonDto {
  return {
    code: row.code,
    label: row.label,
    sortOrder: row.sortOrder,
    routed: (row.defaultAssigneeZohoUserId ?? '').length > 0,
  };
}

export function toDepartmentOptionDto(row: MytrionDepartmentConfig): DepartmentOptionDto {
  return {
    department: row.department,
    // The snapshot from hr_departments.name, or the slug. Never null: a picker with a blank option is
    // worse than one showing 'customer-service'.
    label: row.label ?? row.department,
    acceptsTickets: row.acceptsTickets,
    acceptsEscalations: row.acceptsEscalations,
  };
}

// ---------------------------------------------------------------------------------------------
// Tickets, messages, events
// ---------------------------------------------------------------------------------------------

/**
 * Who is reading. Derived from the verified session, never from a parameter the client controls.
 *
 * `mine` is computed from this rather than guessed from a name, which is what the Desk-era UI had to do:
 * every Mytrion comment was posted by ONE shared Desk agent, so authorship had to be inferred by
 * matching display names (`isSalesSideMessage` / `personMatches`). Native messages carry the real author
 * id, so attribution becomes an equality check.
 */
export interface CommsReader {
  actorZohoUserId: string | null;
  isCustomer: boolean;
}

export function readerOf(ctx: TenantContext): CommsReader {
  return { actorZohoUserId: actorZohoUserIdOf(ctx), isCustomer: ctx.audience === 'customer' };
}

export interface TicketDto {
  id: string;
  threadId: string;
  number: string;
  kind: string;
  subject: string;
  status: string;
  substatus: string | null;
  priority: string;
  /** Free-form triage labels. Empty array, never null. */
  tags: string[];
  typeCode: string | null;
  typeLabel: string | null;
  targetDepartment: string | null;
  sourceDepartment: string | null;
  sourceMytrion: string | null;
  requester: { zohoUserId: string | null; carrierId: string | null; name: string };
  assignee: { zohoUserId: string; name: string | null } | null;
  /** Null on an escalation, which is personal and carries no client by CHECK constraint. */
  client: {
    carrierId: string | null;
    companyName: string | null;
    applicationId: string | null;
    crmDealId: string | null;
    /** Last four only. The stored full card number is never serialized. */
    cardLast4: string | null;
  } | null;
  sla: {
    hours: number | null;
    dueAt: string | null;
    firstResponseDueAt: string | null;
    firstResponseAt: string | null;
    breachedAt: string | null;
    /** Server-computed so two clients on different clocks agree. */
    overdue: boolean;
  };
  escalation: { id: string; level: number | null; levelLabel: string | null } | null;
  channel: string;
  messageCount: number;
  lastMessageAt: string;
  lastMessageSeq: number;
  /** Omitted entirely for a customer-audience reader — see the note in the builder. */
  lastMessagePreview?: string | null;
  unread: number;
  /** Pass back on a transition so a stale decision 409s instead of overwriting a newer one. */
  version: number;
  resolvedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * Serialize a ticket for one reader.
 *
 * TWO leaks are closed here, both of them things a plain row spread would have shipped:
 *   * `card_number` — the full value is stored for the operational types that need it and must never
 *     leave the server. Only `cardLast4` is exposed.
 *   * `last_message_preview` — the newest message may be an INTERNAL NOTE, so the preview is dropped
 *     for a customer-audience reader. The schema states this requirement; this is where it is enforced.
 */
export function toTicketDto(row: TicketWithThread, reader: CommsReader): TicketDto {
  const { ticket, thread } = row;
  const now = Date.now();
  const openStatuses = ticket.status !== 'resolved' && ticket.status !== 'closed' && ticket.status !== 'cancelled';

  const dto: TicketDto = {
    id: ticket.id,
    threadId: ticket.threadId,
    number: ticket.number,
    kind: ticket.kind,
    subject: thread.subject,
    status: ticket.status,
    substatus: ticket.substatus,
    priority: ticket.priority,
    tags: ticket.tags ?? [],
    typeCode: ticket.ticketTypeCode,
    typeLabel: ticket.ticketTypeLabel,
    targetDepartment: ticket.targetDepartment,
    sourceDepartment: ticket.sourceDepartment,
    sourceMytrion: ticket.sourceMytrion,
    requester: {
      zohoUserId: ticket.requesterZohoUserId,
      carrierId: ticket.requesterCarrierId,
      name: ticket.requesterName,
    },
    assignee: ticket.assigneeZohoUserId
      ? { zohoUserId: ticket.assigneeZohoUserId, name: ticket.assigneeName }
      : null,
    client:
      ticket.kind === 'escalation'
        ? null
        : {
            carrierId: ticket.carrierId,
            companyName: ticket.companyName,
            applicationId: ticket.applicationId,
            crmDealId: ticket.crmDealId,
            cardLast4: ticket.cardLast4,
          },
    sla: {
      hours: ticket.slaHours,
      dueAt: iso(ticket.dueAt),
      firstResponseDueAt: iso(ticket.firstResponseDueAt),
      firstResponseAt: iso(ticket.firstResponseAt),
      breachedAt: iso(ticket.breachedAt),
      overdue:
        openStatuses && ticket.dueAt !== null && ticket.dueAt.getTime() < now,
    },
    escalation: ticket.escalationId
      ? {
          id: ticket.escalationId,
          level: ticket.escalationLevel,
          levelLabel: ticket.escalationLevelLabel,
        }
      : null,
    channel: ticket.channel,
    messageCount: thread.messageCount,
    lastMessageAt: thread.lastMessageAt.toISOString(),
    lastMessageSeq: thread.lastMessageSeq,
    // A missing member row means "never opened", which is every message unread — not zero. Clamped at 0
    // so a watermark ahead of the counter (a replayed mark-read) cannot render a negative badge.
    unread: Math.max(0, thread.messageCount - (row.readSeq ?? 0)),
    version: ticket.version,
    resolvedAt: iso(ticket.resolvedAt),
    closedAt: iso(ticket.closedAt),
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };

  if (!reader.isCustomer) dto.lastMessagePreview = thread.lastMessagePreview;
  return dto;
}

export interface MessageDto {
  id: string;
  seq: number;
  kind: string;
  body: string;
  bodyFormat: string;
  author: {
    kind: string;
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
  /** True when the reader wrote it — drives right-alignment without a name heuristic. */
  mine: boolean;
}

export function toMessageDto(row: MytrionThreadMessage, reader: CommsReader): MessageDto {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    // A redacted message keeps its row for sequence integrity but must not serve its text.
    body: row.redactedAt ? '' : row.body,
    bodyFormat: row.bodyFormat,
    author: {
      kind: row.authorKind,
      zohoUserId: row.authorZohoUserId,
      carrierId: row.authorCarrierId,
      name: row.authorName,
    },
    isInternal: row.isInternal,
    systemEvent: row.systemEvent,
    mentions: Array.isArray(row.mentions) ? (row.mentions as string[]) : [],
    editedAt: iso(row.editedAt),
    redactedAt: iso(row.redactedAt),
    createdAt: row.createdAt.toISOString(),
    mine:
      reader.actorZohoUserId !== null &&
      row.authorZohoUserId !== null &&
      row.authorZohoUserId === reader.actorZohoUserId,
  };
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

export function toTicketEventDto(row: MytrionTicketEvent): TicketEventDto {
  let detail: Record<string, unknown> | null = null;
  if (row.detail) {
    // The column is text, and a hand-written journal row is not guaranteed to be JSON. A parse failure
    // must not fail the whole activity read, so it degrades to a note rather than throwing.
    try {
      const parsed: unknown = JSON.parse(row.detail);
      detail =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { note: row.detail };
    } catch {
      detail = { note: row.detail };
    }
  }
  return {
    id: row.id,
    eventType: row.eventType,
    actor: { zohoUserId: row.actorZohoUserId, name: row.actorName },
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    detail,
    occurredAt: row.occurredAt.toISOString(),
  };
}

/** Thread header for the chat pane — the subset a message list needs alongside its messages. */
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

export function toThreadDto(row: MytrionThread): ThreadDto {
  return {
    id: row.id,
    kind: row.kind,
    visibility: row.visibility,
    department: row.department,
    subject: row.subject,
    state: row.state,
    messageCount: row.messageCount,
    lastMessageSeq: row.lastMessageSeq,
  };
}

/** Re-exported for callers that build a DTO from a bare ticket row plus its thread. */
export type { MytrionTicket };
