/**
 * The native ticket create path (`modules/comms/ticketService.ts`) — the two security properties of the
 * comms system, asserted with no HTTP, no database and no network. Every collaborator is mocked at the
 * module boundary, so a failure here is the service's own logic, not a repo's or Zoho's.
 *
 *   1. THE QUEUE COMES FROM THE CATALOG. `target_department` is read off the `mytrion_ticket_types` row
 *      and never from the request body. The Desk flow accepted a `department` field, so an agent could
 *      file into any queue they liked.
 *   2. AN AGENT MAY ONLY FILE AGAINST A DEAL THEY OWN, and the client snapshot (carrier / company /
 *      application) is read from that same Deal record rather than trusted from the body — otherwise an
 *      agent could attach someone else's carrier to their own deal's ticket.
 *
 * SLA resolution has its own sibling file (comms-ticket-sla.test.ts) to stay inside the 600-line cap.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/integrations/salesDataCenter.js', () => ({
  fetchDealSnapshot: vi.fn(),
}));
vi.mock('../../src/repos/commsCatalogRepo.js', () => ({
  commsCatalogRepo: { byCode: vi.fn(), list: vi.fn(), buildListQuery: vi.fn() },
}));
vi.mock('../../src/repos/commsDepartmentRepo.js', () => ({
  commsDepartmentRepo: { get: vi.fn(), list: vi.fn(), buildListQuery: vi.fn() },
}));
// Partial: `slaHoursFor` and DEFAULT_COMMS_SETTINGS are pure and are part of what is under test — only
// the DB read is replaced.
vi.mock('../../src/repos/commsSettingsRepo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/repos/commsSettingsRepo.js')>();
  return {
    ...mod,
    commsSettingsRepo: { ...mod.commsSettingsRepo, getEffective: vi.fn() },
  };
});
vi.mock('../../src/repos/commsTicketRepo.js', () => ({
  commsTicketRepo: { createWithThread: vi.fn() },
}));
vi.mock('../../src/repos/commsTicketEventRepo.js', () => ({
  commsTicketEventRepo: { append: vi.fn(async () => undefined) },
}));
vi.mock('../../src/modules/audit/auditLogger.js', () => ({
  auditFromContext: vi.fn(async () => undefined),
}));
// `publishSafely` keeps its real semantics (invoke, swallow) so the fan-out call it wraps is
// observable; only the fan-out itself is replaced, since it would otherwise touch the socket hub.
vi.mock('../../src/modules/comms/publish.js', () => ({
  publishSafely: vi.fn((_label: string, fn: () => void) => {
    fn();
  }),
  publishThreadEvent: vi.fn(() => ({ thread: 0, lanes: 0 })),
}));

import {
  createClientTicket,
  resolveOwnedDeal,
  resolveTicketType,
  type CreateClientTicketInput,
} from '../../src/modules/comms/ticketService.js';
import { RBACError, ValidationError } from '../../src/lib/errors.js';
import { auditFromContext } from '../../src/modules/audit/auditLogger.js';
import { fetchDealSnapshot } from '../../src/integrations/salesDataCenter.js';
import { commsCatalogRepo } from '../../src/repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../src/repos/commsDepartmentRepo.js';
import { commsSettingsRepo, DEFAULT_COMMS_SETTINGS } from '../../src/repos/commsSettingsRepo.js';
import { commsTicketEventRepo } from '../../src/repos/commsTicketEventRepo.js';
import { commsTicketRepo } from '../../src/repos/commsTicketRepo.js';
import { publishThreadEvent } from '../../src/modules/comms/publish.js';
import type { CreateTicketInput } from '../../src/repos/commsTicketRepo.js';
import type { TenantContext } from '../../src/types/tenantContext.js';
import {
  CATALOG_DEPARTMENT,
  createdUnit,
  dealSnapshot,
  deptConfig,
  FULL_CARD,
  typeRow,
} from './helpers/commsFixtures.js';

/**
 * THREE distinct department values are in play, so a wrong answer is always visible in an assertion:
 * 'sales' is the caller's own grant, 'billing' is what a hostile/legacy body asks for, and
 * CATALOG_DEPARTMENT ('customer-service') is what the catalog row says — the only correct answer.
 */
const CALLER_DEPARTMENT = 'sales';
const BODY_DEPARTMENT = 'billing';

/** What the body would like the client to be. Every value here must be ignored. */
const BODY_CARRIER_ID = '9999999';
const BODY_COMPANY = 'Someone Elses Fleet Inc';
const BODY_APPLICATION_ID = 'APP-HIJACK';

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:42',
    userName: 'Agent Smith',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: [CALLER_DEPARTMENT],
    allDepartmentAccess: false,
    requestId: 'req_1',
    ...over,
  } as TenantContext;
}

const dealMock = vi.mocked(fetchDealSnapshot);
const byCodeMock = vi.mocked(commsCatalogRepo.byCode);
const deptGetMock = vi.mocked(commsDepartmentRepo.get);
const settingsMock = vi.mocked(commsSettingsRepo.getEffective);
const createMock = vi.mocked(commsTicketRepo.createWithThread);
const appendMock = vi.mocked(commsTicketEventRepo.append);
const auditMock = vi.mocked(auditFromContext);
const publishMock = vi.mocked(publishThreadEvent);

/** The base body. Deliberately carries NO department and NO client fields — those are added per test. */
const baseInput: CreateClientTicketInput = {
  typeCode: 'C-7',
  subject: 'Card is not working',
  description: 'Driver says the card was declined at the pump.',
  dealId: 'deal_1',
};

/** Assert a 400-class refusal whose message actually tells the agent what to do about it. */
async function expectRefusal(work: Promise<unknown>, says: string): Promise<void> {
  const err = await work.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(ValidationError);
  expect((err as ValidationError).statusCode).toBe(400);
  expect((err as Error).message).toContain(says);
}

/** The single arg `createWithThread` was called with — the repo boundary the service must get right. */
function createdWith(): CreateTicketInput {
  expect(createMock).toHaveBeenCalledTimes(1);
  const call = createMock.mock.calls[0];
  if (!call) throw new Error('createWithThread was not called');
  return call[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  byCodeMock.mockResolvedValue(typeRow());
  deptGetMock.mockResolvedValue(deptConfig());
  settingsMock.mockResolvedValue({ ...DEFAULT_COMMS_SETTINGS, persisted: true });
  dealMock.mockResolvedValue(dealSnapshot());
  createMock.mockImplementation(async (_ctx, input) => createdUnit(input));
  publishMock.mockReturnValue({ thread: 0, lanes: 0 });
});

// === PROPERTY 1 — the queue comes from the catalog =============================================

describe('createClientTicket — the target department comes from the CATALOG, never the body', () => {
  it('A BODY-SUPPLIED DEPARTMENT IS IGNORED', async () => {
    // Three different values are in play: the body says 'billing', the caller holds 'sales', the
    // catalog row says 'customer-service'. Only one of the three can be the right answer, so this
    // cannot pass by coincidence.
    const hostileBody: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      targetDepartment: BODY_DEPARTMENT,
      department: BODY_DEPARTMENT,
      threadDepartment: BODY_DEPARTMENT,
      queue: BODY_DEPARTMENT,
    };
    // Guarding the guard: an "absent value" assertion passes trivially when the input never held the
    // value. This pins the body as genuinely hostile before the call.
    expect(JSON.stringify(hostileBody)).toContain(BODY_DEPARTMENT);

    await createClientTicket(ctxOf(), hostileBody);

    const input = createdWith();
    expect(input.targetDepartment).toBe(CATALOG_DEPARTMENT);
    // The thread's department is the same queue — that is what makes the ticket reachable by CS.
    expect(input.threadDepartment).toBe(CATALOG_DEPARTMENT);
    expect(input.visibility).toBe('department');
    // Nothing anywhere in the repo payload carries the body's queue…
    expect(JSON.stringify(input)).not.toContain(BODY_DEPARTMENT);
    // …and it is not the caller's own department either (the other plausible wrong answer).
    expect(input.targetDepartment).not.toBe(CALLER_DEPARTMENT);
  });

  it('retargeting the catalog row retargets the ticket, with no code change', async () => {
    byCodeMock.mockResolvedValue(typeRow({ targetDepartment: 'verification' }));
    deptGetMock.mockResolvedValue(deptConfig({ department: 'verification' }));
    await createClientTicket(ctxOf(), baseInput);
    expect(createdWith().targetDepartment).toBe('verification');
  });

  it('snapshots the catalog identity so a later rename cannot rewrite history', async () => {
    byCodeMock.mockResolvedValue(typeRow({ id: 'mtty_7', code: 'C-7', label: 'Card replacement' }));
    await createClientTicket(ctxOf(), baseInput);
    expect(createdWith()).toMatchObject({
      ticketTypeId: 'mtty_7',
      ticketTypeCode: 'C-7',
      ticketTypeLabel: 'Card replacement',
    });
  });

  it('sourceDepartment / sourceMytrion ARE body-supplied — they are provenance, not authorization', async () => {
    const input = { ...baseInput, sourceDepartment: 'sales', sourceMytrion: 'sales' };
    await createClientTicket(ctxOf(), input);
    expect(createdWith()).toMatchObject({ sourceDepartment: 'sales', sourceMytrion: 'sales' });
  });
});

describe('resolveTicketType — every unroutable type is refused with a 400', () => {
  it('an UNKNOWN code is refused', async () => {
    byCodeMock.mockResolvedValue(undefined);
    await expectRefusal(resolveTicketType(ctxOf(), 'C-999'), 'C-999');
  });

  it('an escalation-reason row is not a ticket type, even though it lives in the same table', async () => {
    byCodeMock.mockResolvedValue(typeRow({ kind: 'escalation_reason' }));
    await expect(resolveTicketType(ctxOf(), 'C-7')).rejects.toBeInstanceOf(ValidationError);
  });

  it('an INACTIVE code is refused', async () => {
    byCodeMock.mockResolvedValue(typeRow({ active: false }));
    await expectRefusal(resolveTicketType(ctxOf(), 'C-7'), 'no longer available');
  });

  it('a type with NO target department is refused rather than inserted queue-less', async () => {
    byCodeMock.mockResolvedValue(typeRow({ targetDepartment: null }));
    await expectRefusal(resolveTicketType(ctxOf(), 'C-7'), 'no target department');
  });

  it('a target department with accepts_tickets=false is refused', async () => {
    deptGetMock.mockResolvedValue(deptConfig({ acceptsTickets: false }));
    await expectRefusal(resolveTicketType(ctxOf(), 'C-7'), CATALOG_DEPARTMENT);
  });

  it('a MISSING department config is not a closed queue — it falls through as accepting', async () => {
    // 0087 seeds ten rows, but a department added later has none; refusing there would take the whole
    // queue offline on a data gap rather than on a decision.
    deptGetMock.mockResolvedValue(undefined);
    await expect(resolveTicketType(ctxOf(), 'C-7')).resolves.toMatchObject({
      targetDepartment: CATALOG_DEPARTMENT,
    });
  });

  it('priority precedence: request > catalog default > medium', async () => {
    byCodeMock.mockResolvedValue(typeRow({ defaultPriority: 'high' }));
    expect((await resolveTicketType(ctxOf(), 'C-7')).priority).toBe('high');
    expect((await resolveTicketType(ctxOf(), 'C-7', 'critical')).priority).toBe('critical');
    byCodeMock.mockResolvedValue(typeRow({ defaultPriority: null }));
    expect((await resolveTicketType(ctxOf(), 'C-7')).priority).toBe('medium');
  });
});

describe('createClientTicket — a refused type never reaches the database', () => {
  it('a closed queue short-circuits before any write', async () => {
    deptGetMock.mockResolvedValue(deptConfig({ acceptsTickets: false }));
    await expect(createClientTicket(ctxOf(), baseInput)).rejects.toBeInstanceOf(ValidationError);
    expect(createMock).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('an unknown code short-circuits before the CRM read too', async () => {
    byCodeMock.mockResolvedValue(undefined);
    await expect(createClientTicket(ctxOf(), baseInput)).rejects.toBeInstanceOf(ValidationError);
    expect(dealMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

describe('createClientTicket — catalog requirement flags', () => {
  it('requires_carrier=true + a deal with NO Carrier_ID is refused, body carrier or not', async () => {
    // The flag is checked against the DEAL: passing `carrierId` in the body would otherwise satisfy it
    // for a deal that has no activated client at all.
    byCodeMock.mockResolvedValue(typeRow({ requiresCarrier: true, label: 'Card replacement' }));
    dealMock.mockResolvedValue(dealSnapshot({ carrierId: null }));
    const body: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      carrierId: BODY_CARRIER_ID,
    };
    await expectRefusal(createClientTicket(ctxOf(), body), 'Carrier ID');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('requires_carrier=true + a deal WITH a carrier proceeds', async () => {
    byCodeMock.mockResolvedValue(typeRow({ requiresCarrier: true }));
    await createClientTicket(ctxOf(), baseInput);
    expect(createdWith().carrierId).toBe('5832379');
  });

  it('requires_card=true + NO cardNumber is refused', async () => {
    byCodeMock.mockResolvedValue(typeRow({ requiresCard: true, label: 'Card replacement' }));
    await expectRefusal(createClientTicket(ctxOf(), baseInput), 'card number');
    expect(createMock).not.toHaveBeenCalled();
  });

  it('requires_card=true + a card proceeds, storing the full value but exposing only last4', async () => {
    byCodeMock.mockResolvedValue(typeRow({ requiresCard: true }));
    await createClientTicket(ctxOf(), { ...baseInput, cardNumber: '4111 1111 1111 1234' });
    const input = createdWith();
    expect(input.cardNumber).toBe('4111 1111 1111 1234');
    expect(input.cardLast4).toBe('1234');
  });

  it('a card too short to have a last4 yields null rather than a partial value', async () => {
    byCodeMock.mockResolvedValue(typeRow({ requiresCard: true }));
    await createClientTicket(ctxOf(), { ...baseInput, cardNumber: '12' });
    expect(createdWith().cardLast4).toBeNull();
  });

  it('neither flag set means neither is required', async () => {
    await expect(createClientTicket(ctxOf(), baseInput)).resolves.toMatchObject({ created: true });
  });
});

// === PROPERTY 2 — a deal you own, and the snapshot comes from that record ======================

describe('resolveOwnedDeal — ownership', () => {
  it("A DEAL OWNED BY ANOTHER AGENT IS AN RBACError, AND IS AUDITED AS 'denied'", async () => {
    dealMock.mockResolvedValue(dealSnapshot({ ownerId: '77' }));
    const err = await resolveOwnedDeal(ctxOf(), 'deal_1', '42').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RBACError);
    expect((err as RBACError).statusCode).toBe(403);

    expect(auditMock).toHaveBeenCalledTimes(1);
    const [, fields] = auditMock.mock.calls[0]!;
    expect(fields).toMatchObject({
      action: 'comms.ticket.create',
      status: 'denied',
      resourceType: 'crm_deal',
      resourceId: 'deal_1',
    });
    expect(fields.detail).toMatchObject({ dealOwnerId: '77' });
  });

  it('an OWNERLESS deal is not "mine" either', async () => {
    dealMock.mockResolvedValue(dealSnapshot({ ownerId: null }));
    await expect(resolveOwnedDeal(ctxOf(), 'deal_1', '42')).rejects.toBeInstanceOf(RBACError);
  });

  it('the owner match is exact — a prefix or a numeric-ish near-miss is not ownership', async () => {
    dealMock.mockResolvedValue(dealSnapshot({ ownerId: '420' }));
    await expect(resolveOwnedDeal(ctxOf(), 'deal_1', '42')).rejects.toBeInstanceOf(RBACError);
  });

  it('the owner returns the snapshot and writes NO denial', async () => {
    await expect(resolveOwnedDeal(ctxOf(), 'deal_1', '42')).resolves.toMatchObject({
      carrierId: '5832379',
    });
    expect(auditMock).not.toHaveBeenCalled();
  });
});

describe('resolveOwnedDeal — blanket access skips the check but NOT the read', () => {
  const others = () => dealMock.mockResolvedValue(dealSnapshot({ ownerId: '77' }));

  it.each([
    ['admin role', { role: 'admin' as const }],
    ['allDepartmentAccess', { allDepartmentAccess: true }],
    ['bypassRbac', { bypassRbac: true }],
  ])('%s files on behalf of another agent without a denial', async (_label, over) => {
    others();
    await expect(resolveOwnedDeal(ctxOf(over), 'deal_1', '42')).resolves.toMatchObject({
      ownerId: '77',
    });
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('STILL SNAPSHOTS FROM THE DEAL — an admin-filed ticket is not the unverified one', async () => {
    others();
    const hostileBody: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      carrierId: BODY_CARRIER_ID,
      companyName: BODY_COMPANY,
      applicationId: BODY_APPLICATION_ID,
    };
    await createClientTicket(ctxOf({ role: 'admin' }), hostileBody);

    expect(dealMock).toHaveBeenCalledWith('deal_1');
    const input = createdWith();
    expect(input).toMatchObject({
      carrierId: '5832379',
      companyName: 'Acme Trucking LLC',
      applicationId: 'APP-1',
      crmDealId: 'deal_1',
    }); // straight off the deal record
    for (const forged of [BODY_CARRIER_ID, BODY_COMPANY]) {
      expect(JSON.stringify(input)).not.toContain(forged);
    }
  });
});

describe('resolveOwnedDeal — a CRM failure is NOT "not yours"', () => {
  it('a lookup THROW becomes a distinct 400 that names the CRM, and no denial is audited', async () => {
    dealMock.mockRejectedValue(new Error('COQL 502 Bad Gateway'));
    const err = await resolveOwnedDeal(ctxOf(), 'deal_1', '42').catch((e: unknown) => e);
    // The important half is what it is NOT: an RBACError would send the agent hunting for a
    // permissions problem that does not exist.
    expect(err).not.toBeInstanceOf(RBACError);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toContain('Could not verify the deal in CRM');
    expect((err as Error).message).toContain('COQL 502 Bad Gateway');
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('a non-Error rejection still produces the CRM-verification message, not a crash', async () => {
    dealMock.mockRejectedValue('socket hang up');
    const err = await resolveOwnedDeal(ctxOf(), 'deal_1', '42').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toContain('lookup failed');
  });

  it('a MISSING deal is a third, distinct outcome — "not found", not "not yours" and not an outage', async () => {
    dealMock.mockResolvedValue(null);
    const err = await resolveOwnedDeal(ctxOf(), 'deal_404', '42').catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(RBACError);
    expect(err).toBeInstanceOf(ValidationError);
    expect((err as Error).message).toContain('was not found in CRM');
    expect((err as Error).message).not.toContain('Could not verify');
    expect(auditMock).not.toHaveBeenCalled();
  });

  it('the three failures are distinguishable by message, which is what the agent acts on', async () => {
    const messageFor = async (arrange: () => void): Promise<string> => {
      auditMock.mockClear();
      arrange();
      const err = await resolveOwnedDeal(ctxOf(), 'deal_1', '42').catch((e: unknown) => e);
      return (err as Error).message;
    };
    const outage = await messageFor(() => dealMock.mockRejectedValue(new Error('boom')));
    const missing = await messageFor(() => dealMock.mockResolvedValue(null));
    const notMine = await messageFor(() => dealMock.mockResolvedValue(dealSnapshot({ ownerId: '7' })));
    expect(new Set([outage, missing, notMine]).size).toBe(3);
  });
});

describe('createClientTicket — the client snapshot comes from the DEAL RECORD', () => {
  it('body-supplied client fields are ignored in favour of the deal', async () => {
    const hostileBody: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      carrierId: BODY_CARRIER_ID,
      companyName: BODY_COMPANY,
      applicationId: BODY_APPLICATION_ID,
      crmDealId: 'deal_OTHER',
    };
    // Guarding the guard: the body must genuinely hold the forged client before we assert it is gone.
    for (const forged of [BODY_CARRIER_ID, BODY_COMPANY, BODY_APPLICATION_ID, 'deal_OTHER']) {
      expect(JSON.stringify(hostileBody)).toContain(forged);
    }
    await createClientTicket(ctxOf(), hostileBody);

    const input = createdWith();
    expect(input).toMatchObject({
      carrierId: '5832379',
      companyName: 'Acme Trucking LLC',
      applicationId: 'APP-1',
      crmDealId: 'deal_1',
    });
    const wire = JSON.stringify(input);
    for (const forged of [BODY_CARRIER_ID, BODY_COMPANY, BODY_APPLICATION_ID, 'deal_OTHER']) {
      expect(wire, `body value "${forged}" reached the repo`).not.toContain(forged);
    }
  });

  it('a deal with empty client fields yields nulls, never a body fallback', async () => {
    dealMock.mockResolvedValue(
      dealSnapshot({ carrierId: null, companyName: null, applicationId: null }),
    );
    const hostileBody: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      carrierId: BODY_CARRIER_ID,
      companyName: BODY_COMPANY,
    };
    await createClientTicket(ctxOf(), hostileBody);
    expect(createdWith()).toMatchObject({
      carrierId: null,
      companyName: null,
      applicationId: null,
    });
  });

  it('the requester is the verified session identity, not a body field', async () => {
    const hostileBody: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      requesterZohoUserId: '77',
      requesterName: 'Someone Else',
      createdByZohoUserId: '77',
    };
    await createClientTicket(ctxOf(), hostileBody);
    expect(createdWith()).toMatchObject({
      requesterKind: 'worker',
      requesterZohoUserId: '42',
      requesterName: 'Agent Smith',
      createdByZohoUserId: '42',
    });
  });

  it('an identity with no worker id cannot file at all, and no CRM read happens', async () => {
    for (const ctx of [
      ctxOf({ userId: 'system' }),
      ctxOf({ audience: 'customer', userId: 'client:cu_9', role: 'viewer' }),
      ctxOf({ userId: 'zoho:' }),
    ]) {
      await expect(createClientTicket(ctx, baseInput)).rejects.toBeInstanceOf(RBACError);
    }
    expect(dealMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });
});

// === Journal + publish =========================================================================

describe('createClientTicket — journal and publish', () => {
  it('journals a created event whose detail names the SERVER-derived queue', async () => {
    const hostileBody: CreateClientTicketInput & Record<string, unknown> = {
      ...baseInput,
      targetDepartment: BODY_DEPARTMENT,
    };
    await createClientTicket(ctxOf(), hostileBody);

    expect(appendMock).toHaveBeenCalledTimes(1);
    const [, event] = appendMock.mock.calls[0]!;
    expect(event).toMatchObject({
      ticketId: 'mtk_new',
      threadId: 'mth_new',
      eventType: 'created',
      actorZohoUserId: '42',
      toStatus: 'open',
    });
    expect(event.detail).toMatchObject({
      typeCode: 'C-7',
      targetDepartment: CATALOG_DEPARTMENT,
      dealId: 'deal_1',
      carrierId: '5832379',
    });
    expect(JSON.stringify(event.detail)).not.toContain(BODY_DEPARTMENT);
  });

  it('THE FULL CARD NUMBER IS NEVER AUDIT-LOGGED OR JOURNALLED', async () => {
    byCodeMock.mockResolvedValue(typeRow({ requiresCard: true }));
    await createClientTicket(ctxOf(), { ...baseInput, cardNumber: FULL_CARD });
    const [, event] = appendMock.mock.calls[0]!;
    expect(JSON.stringify(event)).not.toContain(FULL_CARD);
    expect(JSON.stringify(event)).not.toContain('411111111111');
    // Nothing was audited on the happy path here (the route owns the success row), but if a denial had
    // been written it must be card-free too.
    expect(JSON.stringify(auditMock.mock.calls)).not.toContain(FULL_CARD);
  });

  it('a denied deal never journals and never publishes', async () => {
    dealMock.mockResolvedValue(dealSnapshot({ ownerId: '77' }));
    await expect(createClientTicket(ctxOf(), baseInput)).rejects.toBeInstanceOf(RBACError);
    expect(createMock).not.toHaveBeenCalled();
    expect(appendMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('publishes to the thread AND the target queue, excluding the author', async () => {
    await createClientTicket(ctxOf(), baseInput);
    expect(publishMock).toHaveBeenCalledTimes(1);
    const [thread, , payload, opts] = publishMock.mock.calls[0]!;
    expect(thread).toMatchObject({ id: 'mth_new', department: CATALOG_DEPARTMENT });
    expect(payload).toMatchObject({
      type: 'comms.ticket.created',
      threadId: 'mth_new',
      ticketId: 'mtk_new',
      targetDepartment: CATALOG_DEPARTMENT,
    });
    // alsoQueue is what makes a filed ticket visible to the receiving department at all.
    expect(opts).toMatchObject({ alsoQueue: true, excludeMemberKey: '42' });
  });

  it('a REPLAY (created=false) neither journals nor publishes a second time', async () => {
    createMock.mockImplementation(async (_ctx, input) => createdUnit(input, false));
    const result = await createClientTicket(ctxOf(), {
      ...baseInput,
      idempotencyKey: 'idem-1',
    });
    expect(result.created).toBe(false);
    expect(appendMock).not.toHaveBeenCalled();
    expect(publishMock).not.toHaveBeenCalled();
  });

  it('the idempotency key is passed through so the repo can replay-match it', async () => {
    await createClientTicket(ctxOf(), { ...baseInput, idempotencyKey: 'idem-1' });
    expect(createdWith()).toMatchObject({ idempotencyKey: 'idem-1', source: 'worker' });
  });

  it('the opening message is the description, and the ticket kind is always "ticket"', async () => {
    await createClientTicket(ctxOf(), baseInput);
    expect(createdWith()).toMatchObject({
      kind: 'ticket',
      subject: 'Card is not working',
      body: 'Driver says the card was declined at the pump.',
      channel: 'web',
    });
  });
});
