/**
 * The comms serialization boundary (`modules/comms/dto.ts`).
 *
 * This is where three leaks are closed, so it gets a suite of its own rather than being covered
 * incidentally through the routes:
 *   * the stored FULL card number must never reach the wire,
 *   * `last_message_preview` may be an internal note and must be dropped for a customer reader,
 *   * `default_assignee_zoho_user_id` is routing config and must never be published to a picker.
 *
 * The card and routing-id assertions are made over `JSON.stringify(dto)` on purpose: an assertion on a
 * named key only proves *that* key is clean, while the actual failure mode is the value reappearing
 * under some other name (a spread, a debug field, a nested snapshot).
 */
import { describe, expect, it } from 'vitest';
import {
  readerOf,
  toDepartmentOptionDto,
  toEscalationReasonDto,
  toMessageDto,
  toThreadDto,
  toTicketDto,
  toTicketEventDto,
  toTicketTypeDto,
  type CommsReader,
} from '../../src/modules/comms/dto.js';
import type { MytrionThread, MytrionThreadMessage, MytrionTicket } from '../../src/db/schema/index.js';
import type { TicketWithThread } from '../../src/repos/commsTicketRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';
import {
  CARD_PREFIX,
  deptConfig,
  eventRow,
  FULL_CARD,
  messageRow,
  T0,
  threadRow,
  ticketRow,
  typeRow,
} from './helpers/commsFixtures.js';

// ---------------------------------------------------------------------------------------------
// Fixtures live in helpers/commsFixtures.ts — FULL rows, shared with the ticket-service suite so a
// new schema column has one place to appear rather than two that can drift.
// ---------------------------------------------------------------------------------------------

/** A ticket joined to its thread, as every list and detail read returns it. */
function row(
  ticket: Partial<MytrionTicket> = {},
  thread: Partial<MytrionThread> = {},
  readSeq: number | null = 2,
): TicketWithThread {
  return { ticket: ticketRow(ticket), thread: threadRow(thread), readSeq };
}

const internalReader: CommsReader = { actorZohoUserId: '42', isCustomer: false };
const customerReader: CommsReader = { actorZohoUserId: null, isCustomer: true };

// ---------------------------------------------------------------------------------------------

describe('toTicketDto — the full card number never leaves the server', () => {
  it('the fixture row REALLY carries the card, so the absence assertions below mean something', () => {
    // Guarding the guard: an "absent secret" assertion passes trivially if the fixture never held the
    // secret. This pins the row so a future fixture edit cannot silently defang the whole describe.
    expect(JSON.stringify(ticketRow())).toContain(FULL_CARD);
    expect(JSON.stringify(threadRow())).toContain('INTERNAL');
  });

  it('NO KEY, ANYWHERE, CARRIES THE FULL DIGITS', () => {
    const dto = toTicketDto(row(), internalReader);
    const wire = JSON.stringify(dto);
    expect(wire).not.toContain(FULL_CARD);
    // Not even the leading digits: a "masked" value that keeps the BIN is still a card leak.
    expect(wire).not.toContain(CARD_PREFIX);
    expect(wire).not.toContain('cardNumber');
  });

  it('does emit cardLast4, which is what the UI actually needs', () => {
    const dto = toTicketDto(row(), internalReader);
    expect(dto.client?.cardLast4).toBe('1234');
    expect(JSON.stringify(dto)).toContain('"cardLast4":"1234"');
  });

  it('holds for a customer reader too, and for a card stored with separators', () => {
    const spaced = '4111 1111 1111 1234';
    const dto = toTicketDto(row({ cardNumber: spaced, cardLast4: '1234' }), customerReader);
    const wire = JSON.stringify(dto);
    expect(wire).not.toContain(spaced);
    expect(wire).not.toContain(CARD_PREFIX);
    expect(dto.client?.cardLast4).toBe('1234');
  });

  it('a null last4 does not fall back to deriving one from the stored card', () => {
    const dto = toTicketDto(row({ cardLast4: null }), internalReader);
    expect(dto.client?.cardLast4).toBeNull();
    expect(JSON.stringify(dto)).not.toContain('1234');
  });
});

describe('toTicketDto — lastMessagePreview is an internal-only field', () => {
  it('the KEY IS ABSENT for a customer-audience reader, not just null', () => {
    const dto = toTicketDto(row(), customerReader);
    // Absent rather than null: a null would tell a client the field exists and is empty, and the
    // preview may be an internal note verbatim.
    expect('lastMessagePreview' in dto).toBe(false);
    expect(Object.keys(dto)).not.toContain('lastMessagePreview');
    expect(JSON.stringify(dto)).not.toContain('INTERNAL');
  });

  it('is present for an internal reader', () => {
    const dto = toTicketDto(row(), internalReader);
    expect('lastMessagePreview' in dto).toBe(true);
    expect(dto.lastMessagePreview).toBe(
      'INTERNAL: called the bank, they said the BIN is blocked',
    );
  });

  it('an internal reader with no preview stored gets the key with null (shape stays stable)', () => {
    const dto = toTicketDto(row({}, { lastMessagePreview: null }), internalReader);
    expect('lastMessagePreview' in dto).toBe(true);
    expect(dto.lastMessagePreview).toBeNull();
  });

  it('the decision is the AUDIENCE, not whether the reader has an actor id', () => {
    // A system/API-key internal caller has no actor id but is still internal; keying the drop on the
    // actor id instead of the audience would silently strip previews from the CS board.
    const systemInternal: CommsReader = { actorZohoUserId: null, isCustomer: false };
    expect('lastMessagePreview' in toTicketDto(row(), systemInternal)).toBe(true);
  });
});

describe('toTicketDto — client linkage', () => {
  it('client is NULL for kind=escalation', () => {
    // An escalation is about a person and carries no carrier by CHECK constraint; emitting an
    // all-null client object would invite the UI to render a client section for it.
    const dto = toTicketDto(row({ kind: 'escalation' }), internalReader);
    expect(dto.client).toBeNull();
  });

  it('an escalation leaks no client column even if the row somehow holds one', () => {
    const dto = toTicketDto(
      row({ kind: 'escalation', carrierId: '5832379', companyName: 'Acme Trucking LLC' }),
      internalReader,
    );
    const wire = JSON.stringify(dto);
    expect(wire).not.toContain('Acme Trucking LLC');
    expect(wire).not.toContain('5832379');
  });

  it('client is populated for a ticket and for a request', () => {
    expect(toTicketDto(row({ kind: 'ticket' }), internalReader).client).toMatchObject({
      carrierId: '5832379',
      companyName: 'Acme Trucking LLC',
      applicationId: 'APP-1',
      crmDealId: 'deal_1',
    });
    expect(toTicketDto(row({ kind: 'request' }), internalReader).client).not.toBeNull();
  });
});

describe('toTicketDto — unread arithmetic', () => {
  it('unread = messageCount - readSeq', () => {
    expect(toTicketDto(row({}, { messageCount: 5 }, 2), internalReader).unread).toBe(3);
  });

  it('EQUALS messageCount when readSeq is null — never opened is not zero unread', () => {
    // The department-queue case: a CS agent holds no member row on an inbound ticket, and treating the
    // missing row as "read" would make the whole queue look worked.
    expect(toTicketDto(row({}, { messageCount: 5 }, null), internalReader).unread).toBe(5);
  });

  it('is 0 when fully read', () => {
    expect(toTicketDto(row({}, { messageCount: 5 }, 5), internalReader).unread).toBe(0);
  });

  it('CLAMPS AT 0 when the watermark is ahead of the counter', () => {
    // A replayed mark-read can push last_read_seq past message_count; a negative badge is a visible bug.
    expect(toTicketDto(row({}, { messageCount: 5 }, 9), internalReader).unread).toBe(0);
  });

  it('an empty thread reads as 0, not as a negative', () => {
    expect(toTicketDto(row({}, { messageCount: 0 }, null), internalReader).unread).toBe(0);
  });
});

describe('toTicketDto — sla.overdue is server-computed and lifecycle-aware', () => {
  const past = new Date(Date.now() - 3_600_000);
  const future = new Date(Date.now() + 3_600_000);

  it('true for an open ticket past its due date', () => {
    expect(toTicketDto(row({ status: 'open', dueAt: past }), internalReader).sla.overdue).toBe(true);
    expect(
      toTicketDto(row({ status: 'in_progress', dueAt: past }), internalReader).sla.overdue,
    ).toBe(true);
    expect(toTicketDto(row({ status: 'escalated', dueAt: past }), internalReader).sla.overdue).toBe(
      true,
    );
  });

  it('FALSE for resolved / closed / cancelled even when dueAt is in the past', () => {
    // Otherwise every historical ticket renders red forever and the overdue count stops meaning
    // "needs attention".
    for (const status of ['resolved', 'closed', 'cancelled'] as const) {
      expect(
        toTicketDto(row({ status, dueAt: past }), internalReader).sla.overdue,
        `status ${status} must not be overdue`,
      ).toBe(false);
    }
  });

  it('false before the due date, and false when there is no due date at all', () => {
    expect(toTicketDto(row({ status: 'open', dueAt: future }), internalReader).sla.overdue).toBe(
      false,
    );
    expect(toTicketDto(row({ status: 'open', dueAt: null }), internalReader).sla.overdue).toBe(
      false,
    );
  });

  it('serializes the SLA timestamps as ISO strings, not Date objects', () => {
    const dto = toTicketDto(row(), internalReader);
    expect(dto.sla.dueAt).toBe(ticketRow().dueAt?.toISOString());
    expect(dto.sla.firstResponseAt).toBeNull();
    expect(dto.createdAt).toBe(T0.toISOString());
  });
});

describe('toMessageDto — authorship is an id match, never a name match', () => {
  it('mine is true on an id-to-id match', () => {
    expect(toMessageDto(messageRow({ authorZohoUserId: '42' }), internalReader).mine).toBe(true);
  });

  it('MINE IS FALSE WHEN ONLY THE NAME MATCHES', () => {
    // The Desk-era widget had to guess authorship by display name because every Mytrion comment came
    // from one shared agent. Native messages carry the real id; a name heuristic must not creep back.
    const named: CommsReader = { actorZohoUserId: '99', isCustomer: false };
    const dto = toMessageDto(
      messageRow({ authorZohoUserId: '42', authorName: 'Agent Smith' }),
      named,
    );
    expect(dto.mine).toBe(false);
    expect(dto.author.name).toBe('Agent Smith');
  });

  it('mine is false for a different author id', () => {
    expect(toMessageDto(messageRow({ authorZohoUserId: '77' }), internalReader).mine).toBe(false);
  });

  it('mine is FALSE when the reader has no actor id', () => {
    // Two nulls must not compare equal: a carrier or system reader would otherwise own every
    // system-authored message in the thread.
    expect(toMessageDto(messageRow({ authorZohoUserId: '42' }), customerReader).mine).toBe(false);
    expect(toMessageDto(messageRow({ authorZohoUserId: null }), customerReader).mine).toBe(false);
  });

  it('a null author id never matches, even for a reader with an id', () => {
    expect(toMessageDto(messageRow({ authorZohoUserId: null }), internalReader).mine).toBe(false);
  });
});

describe('toMessageDto — a redacted message serves no body', () => {
  it('body is an empty string once redactedAt is set', () => {
    const dto = toMessageDto(
      messageRow({ body: 'my card number is 4111111111111234', redactedAt: T0 }),
      internalReader,
    );
    expect(dto.body).toBe('');
    expect(JSON.stringify(dto)).not.toContain(FULL_CARD);
  });

  it('keeps the row identity so sequence integrity survives the redaction', () => {
    const dto = toMessageDto(messageRow({ seq: 4, redactedAt: T0 }), internalReader);
    expect(dto.seq).toBe(4);
    expect(dto.id).toBe('mtm_1');
    expect(dto.redactedAt).toBe(T0.toISOString());
  });

  it('an un-redacted message still serves its body', () => {
    expect(toMessageDto(messageRow(), internalReader).body).toBe(
      'The card was declined at the pump.',
    );
  });

  it('mentions degrade to an empty array rather than leaking a non-array jsonb value', () => {
    // jsonb is admin/DB-writable; a scalar there would otherwise reach the client as `mentions: 5`.
    const bad = { ...messageRow(), mentions: 'oops' } as unknown as MytrionThreadMessage;
    // Cast justified: this constructs an out-of-contract DB value on purpose, which the typed row
    // builder cannot express — the assertion is precisely that the DTO tolerates it.
    expect(toMessageDto(bad, internalReader).mentions).toEqual([]);
  });
});

describe('toEscalationReasonDto — routing config is never published', () => {
  it('exposes routed as a BOOLEAN and never the assignee id', () => {
    // Guarding the guard: the source row must actually hold the id being asserted absent.
    expect(JSON.stringify(typeRow({ defaultAssigneeZohoUserId: '9876543' }))).toContain('9876543');
    const dto = toEscalationReasonDto(typeRow({ defaultAssigneeZohoUserId: '9876543' }));
    expect(dto.routed).toBe(true);
    const wire = JSON.stringify(dto);
    expect(wire).not.toContain('9876543');
    expect(wire).not.toContain('default_assignee_zoho_user_id');
    expect(wire).not.toContain('defaultAssigneeZohoUserId');
  });

  it('routed is false for an unrouted reason, so the picker can disable it', () => {
    expect(toEscalationReasonDto(typeRow({ defaultAssigneeZohoUserId: null })).routed).toBe(false);
    // A blank string is unrouted too — an admin clearing the field must not read as configured.
    expect(toEscalationReasonDto(typeRow({ defaultAssigneeZohoUserId: '' })).routed).toBe(false);
  });

  it('emits exactly the four contract keys', () => {
    expect(Object.keys(toEscalationReasonDto(typeRow())).sort()).toEqual([
      'code',
      'label',
      'routed',
      'sortOrder',
    ]);
  });
});

describe('toTicketTypeDto / toDepartmentOptionDto — no routing ids either', () => {
  it('a ticket type never carries its default assignee', () => {
    const dto = toTicketTypeDto(
      typeRow({ kind: 'ticket', targetDepartment: 'customer-service', defaultAssigneeZohoUserId: '9876543' }),
    );
    expect(JSON.stringify(dto)).not.toContain('9876543');
    // targetDepartment is informational for the UI; the server re-derives it on create.
    expect(dto.targetDepartment).toBe('customer-service');
  });

  it('a department option never carries the manager or default assignee', () => {
    const config = deptConfig({
      defaultAssigneeZohoUserId: '111222',
      managerZohoUserId: '333444',
      managerName: 'Dept Lead',
      slaHoursOverride: 6,
    });
    // Guarding the guard: the row genuinely holds the routing ids being asserted absent.
    expect(JSON.stringify(config)).toContain('333444');
    const wire = JSON.stringify(toDepartmentOptionDto(config));
    expect(wire).not.toContain('111222');
    expect(wire).not.toContain('333444');
    expect(wire).not.toContain('Dept Lead');
    expect(Object.keys(toDepartmentOptionDto(config)).sort()).toEqual([
      'acceptsEscalations',
      'acceptsTickets',
      'department',
    ]);
  });
});

describe('toTicketEventDto — a non-JSON detail degrades, it does not throw', () => {
  it('a plain string becomes { note }', () => {
    const dto = toTicketEventDto(eventRow({ detail: 'auto-assigned by the sweeper' }));
    expect(dto.detail).toEqual({ note: 'auto-assigned by the sweeper' });
  });

  it('malformed JSON becomes { note } with the raw text, never a thrown activity read', () => {
    // The column is text and a hand-written journal row is not guaranteed to be JSON; one bad row must
    // not 500 the whole trail.
    const raw = '{"reason": round_robin,}';
    expect(() => toTicketEventDto(eventRow({ detail: raw }))).not.toThrow();
    expect(toTicketEventDto(eventRow({ detail: raw })).detail).toEqual({ note: raw });
  });

  it('a JSON scalar or array also becomes { note } — the contract is an object or null', () => {
    expect(toTicketEventDto(eventRow({ detail: '"just a string"' })).detail).toEqual({
      note: '"just a string"',
    });
    expect(toTicketEventDto(eventRow({ detail: '[1,2,3]' })).detail).toEqual({ note: '[1,2,3]' });
    expect(toTicketEventDto(eventRow({ detail: '42' })).detail).toEqual({ note: '42' });
    expect(toTicketEventDto(eventRow({ detail: 'null' })).detail).toEqual({ note: 'null' });
  });

  it('a well-formed object is passed through as parsed', () => {
    const dto = toTicketEventDto(
      eventRow({ detail: '{"reason":"round_robin","skipped":3}' }),
    );
    expect(dto.detail).toEqual({ reason: 'round_robin', skipped: 3 });
  });

  it('a null detail stays null, and an empty string is treated as absent', () => {
    expect(toTicketEventDto(eventRow({ detail: null })).detail).toBeNull();
    expect(toTicketEventDto(eventRow({ detail: '' })).detail).toBeNull();
  });

  it('serializes the journal identity and time', () => {
    const dto = toTicketEventDto(eventRow({ fromStatus: 'open', toStatus: 'in_progress' }));
    expect(dto).toMatchObject({
      id: 'mtke_1',
      eventType: 'created',
      actor: { zohoUserId: '42', name: 'Agent Smith' },
      fromStatus: 'open',
      toStatus: 'in_progress',
      occurredAt: T0.toISOString(),
    });
  });
});

describe('toThreadDto / readerOf', () => {
  it('the thread header carries no preview and no dm key', () => {
    const dto = toThreadDto(threadRow());
    const wire = JSON.stringify(dto);
    expect(wire).not.toContain('INTERNAL');
    expect(wire).not.toContain('dmKey');
    expect(dto).toMatchObject({ id: 'mth_1', messageCount: 5, lastMessageSeq: 5 });
  });

  it('readerOf derives the actor from the session, and flags a customer audience', () => {
    const ctx = (over: Partial<TenantContext>): TenantContext =>
      ({
        tenantId: 'octane',
        userId: 'zoho:42',
        audience: 'internal',
        role: 'worker',
        scopes: [],
        departments: ['sales'],
        allDepartmentAccess: false,
        requestId: 'r',
        ...over,
      }) as TenantContext;

    expect(readerOf(ctx({}))).toEqual({ actorZohoUserId: '42', isCustomer: false });
    expect(readerOf(ctx({ audience: 'customer', userId: 'client:cu_9' }))).toEqual({
      actorZohoUserId: null,
      isCustomer: true,
    });
    // A system identity is internal but has no actor — the two flags are independent.
    expect(readerOf(ctx({ userId: 'system' }))).toEqual({
      actorZohoUserId: null,
      isCustomer: false,
    });
  });
});
