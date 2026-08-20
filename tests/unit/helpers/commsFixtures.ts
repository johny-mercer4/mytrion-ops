/**
 * Shared comms row fixtures for the unit suites.
 *
 * Extracted rather than duplicated per file for one reason that matters: these are FULL rows, not
 * partials widened with a cast, because the leaks these suites guard (`card_number`,
 * `last_message_preview`, `default_assignee_zoho_user_id`) live in columns nobody remembers to think
 * about — a partial fixture would omit exactly the field under test and pass. Keeping one copy means a
 * schema column added later has one place to appear.
 */
import type {
  MytrionDepartmentConfig,
  MytrionThread,
  MytrionThreadMessage,
  MytrionTicket,
  MytrionTicketEvent,
  MytrionTicketType,
} from '../../../src/db/schema/index.js';
import type { CreateTicketInput, CreatedTicket } from '../../../src/repos/commsTicketRepo.js';
import type { DealSnapshot } from '../../../src/integrations/salesDataCenter.js';

/** Fixed clock. Every fixture timestamp derives from this so assertions can be exact. */
export const T0 = new Date('2026-07-30T10:00:00.000Z');

/** A realistic full card. Must never appear in a DTO, an audit row or a journal detail. */
export const FULL_CARD = '4111111111111234';
/** The leading digits — a "masked" value that keeps the BIN is still a card leak. */
export const CARD_PREFIX = '411111111111';

/** The queue the catalog row points at: the only correct `target_department` in these suites. */
export const CATALOG_DEPARTMENT = 'customer-service';

export function ticketRow(over: Partial<MytrionTicket> = {}): MytrionTicket {
  return {
    id: 'mtk_1',
    tenantId: 'octane',
    threadId: 'mth_1',
    number: 'T-000123',
    kind: 'ticket',
    ticketTypeId: 'mtty_1',
    ticketTypeCode: 'C-7',
    ticketTypeLabel: 'Card replacement',
    targetDepartment: CATALOG_DEPARTMENT,
    sourceDepartment: 'sales',
    sourceMytrion: 'sales',
    priority: 'medium',
    status: 'open',
    substatus: null,
    tags: [],
    requesterKind: 'worker',
    requesterZohoUserId: '42',
    requesterCarrierId: null,
    requesterName: 'Agent Smith',
    assigneeZohoUserId: null,
    assigneeName: null,
    assignedAt: null,
    assignmentReason: null,
    carrierId: '5832379',
    companyName: 'Acme Trucking LLC',
    applicationId: 'APP-1',
    crmDealId: 'deal_1',
    cardNumber: FULL_CARD,
    cardLast4: '1234',
    channel: 'web',
    source: 'worker',
    slaHours: 24,
    dueAt: new Date(T0.getTime() + 24 * 3_600_000),
    firstResponseDueAt: new Date(T0.getTime() + 8 * 3_600_000),
    firstResponseAt: null,
    breachedAt: null,
    escalationId: null,
    escalationLevel: null,
    escalationLevelLabel: null,
    resolvedAt: null,
    resolvedByZohoUserId: null,
    closedAt: null,
    reopenedAt: null,
    cancelledAt: null,
    closeReason: null,
    version: 3,
    idempotencyKey: null,
    createdByZohoUserId: '42',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/** The preview deliberately reads as an INTERNAL note — that is why it must not reach a carrier. */
export function threadRow(over: Partial<MytrionThread> = {}): MytrionThread {
  return {
    id: 'mth_1',
    tenantId: 'octane',
    kind: 'ticket',
    visibility: 'department',
    department: CATALOG_DEPARTMENT,
    subject: 'Card is not working',
    state: 'open',
    dmKey: null,
    messageCount: 5,
    lastMessageAt: T0,
    lastMessageId: 'mtm_5',
    lastMessageSeq: 5,
    lastMessagePreview: 'INTERNAL: called the bank, they said the BIN is blocked',
    lastMessageAuthorZohoUserId: '77',
    createdByZohoUserId: '42',
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function messageRow(over: Partial<MytrionThreadMessage> = {}): MytrionThreadMessage {
  return {
    id: 'mtm_1',
    tenantId: 'octane',
    threadId: 'mth_1',
    threadKind: 'ticket',
    seq: 1,
    kind: 'message',
    body: 'The card was declined at the pump.',
    bodyFormat: 'text',
    authorKind: 'worker',
    authorZohoUserId: '42',
    authorCarrierId: null,
    authorName: 'Agent Smith',
    isInternal: false,
    mentions: [],
    systemEvent: null,
    detail: null,
    editedAt: null,
    redactedAt: null,
    redactedByZohoUserId: null,
    createdAt: T0,
    ...over,
  };
}

export function eventRow(over: Partial<MytrionTicketEvent> = {}): MytrionTicketEvent {
  return {
    id: 'mtke_1',
    tenantId: 'octane',
    ticketId: 'mtk_1',
    threadId: 'mth_1',
    eventType: 'created',
    actorZohoUserId: '42',
    actorName: 'Agent Smith',
    fromStatus: null,
    toStatus: 'open',
    detail: null,
    occurredAt: T0,
    ...over,
  };
}

/** Catalog row. `slaHours` is NULL by default because it is NULL on all 60 seeded rows. */
export function typeRow(over: Partial<MytrionTicketType> = {}): MytrionTicketType {
  return {
    id: 'mtty_1',
    tenantId: 'octane',
    code: 'C-7',
    label: 'Card replacement',
    kind: 'ticket',
    targetDepartment: CATALOG_DEPARTMENT,
    group: 'Cards',
    defaultPriority: 'medium',
    slaHours: null,
    defaultAssigneeZohoUserId: null,
    requestable: false,
    requiresCarrier: false,
    requiresCard: false,
    automationKey: null,
    active: true,
    sortOrder: 7,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function deptConfig(over: Partial<MytrionDepartmentConfig> = {}): MytrionDepartmentConfig {
  return {
    id: 'mdcf_1',
    tenantId: 'octane',
    department: CATALOG_DEPARTMENT,
    hrDepartmentId: null,
    label: null,
    ticketAssignmentStrategy: 'round_robin',
    requireOnline: true,
    defaultAssigneeZohoUserId: null,
    managerZohoUserId: null,
    managerName: null,
    acceptsTickets: true,
    acceptsEscalations: true,
    slaHoursOverride: null,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

/** The Deal record. Its carrier/company/application are the ONLY legitimate snapshot source. */
export function dealSnapshot(over: Partial<DealSnapshot> = {}): DealSnapshot {
  return {
    dealId: 'deal_1',
    ownerId: '42',
    dealName: 'Acme - 5 trucks',
    companyName: 'Acme Trucking LLC',
    carrierId: '5832379',
    applicationId: 'APP-1',
    ...over,
  };
}

/**
 * What `commsTicketRepo.createWithThread` returns, ECHOING the input.
 *
 * Echoing rather than returning a canned row is what lets a test assert on `created.ticket.*` and know
 * the value came from what the service passed down, not from the fixture.
 */
export function createdUnit(input: CreateTicketInput, created = true): CreatedTicket {
  const thread = threadRow({
    id: 'mth_new',
    kind: input.kind,
    visibility: input.visibility,
    department: input.threadDepartment,
    subject: input.subject,
    messageCount: 1,
    lastMessageId: 'mtm_new',
    lastMessageSeq: 1,
    lastMessagePreview: input.body.slice(0, 160),
    lastMessageAuthorZohoUserId: input.requesterZohoUserId ?? null,
    createdByZohoUserId: input.createdByZohoUserId ?? 'system',
  });
  const ticket = ticketRow({
    id: 'mtk_new',
    threadId: thread.id,
    kind: input.kind,
    ticketTypeId: input.ticketTypeId ?? null,
    ticketTypeCode: input.ticketTypeCode ?? null,
    ticketTypeLabel: input.ticketTypeLabel ?? null,
    targetDepartment: input.targetDepartment,
    sourceDepartment: input.sourceDepartment ?? null,
    sourceMytrion: input.sourceMytrion ?? null,
    priority: input.priority,
    status: 'open',
    requesterKind: input.requesterKind,
    requesterZohoUserId: input.requesterZohoUserId ?? null,
    requesterCarrierId: input.requesterCarrierId ?? null,
    requesterName: input.requesterName,
    carrierId: input.carrierId ?? null,
    companyName: input.companyName ?? null,
    applicationId: input.applicationId ?? null,
    crmDealId: input.crmDealId ?? null,
    cardNumber: input.cardNumber ?? null,
    cardLast4: input.cardLast4 ?? null,
    channel: input.channel ?? 'web',
    source: input.source ?? 'worker',
    slaHours: input.slaHours ?? null,
    dueAt: input.dueAt ?? null,
    firstResponseDueAt: input.firstResponseDueAt ?? null,
    version: 1,
    idempotencyKey: input.idempotencyKey ?? null,
    createdByZohoUserId: input.createdByZohoUserId ?? null,
  });
  const message = messageRow({
    id: 'mtm_new',
    threadId: thread.id,
    threadKind: input.kind,
    body: input.body,
    bodyFormat: input.bodyFormat ?? 'text',
    authorKind: input.requesterKind,
    authorZohoUserId: input.requesterZohoUserId ?? null,
    authorName: input.requesterName,
  });
  return { ticket, thread, members: [], message, created };
}
