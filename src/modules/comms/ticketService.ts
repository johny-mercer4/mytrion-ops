import { RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../audit/auditLogger.js';
import { fetchDealSnapshot, type DealSnapshot } from '../../integrations/salesDataCenter.js';
import { commsCatalogRepo } from '../../repos/commsCatalogRepo.js';
import { commsDepartmentRepo } from '../../repos/commsDepartmentRepo.js';
import { commsSettingsRepo, slaHoursFor } from '../../repos/commsSettingsRepo.js';
import { commsTicketEventRepo } from '../../repos/commsTicketEventRepo.js';
import { actorZohoUserIdOf } from '../../repos/commsThreadRepo.js';
import { commsTicketRepo, type CreatedTicket } from '../../repos/commsTicketRepo.js';
import type { CommsTicketPriority, MytrionTicketType } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { publishSafely, publishThreadEvent } from './publish.js';

/**
 * The native ticket create path — where the two security properties of this system live.
 *
 *   1. THE QUEUE COMES FROM THE CATALOG. `target_department` is read off the `mytrion_ticket_types`
 *      row and never from the request body. The Desk flow accepted a `department` field, which means an
 *      agent could file into any queue they liked; here choosing a type IS choosing a queue, and
 *      retargeting a whole family of types is a catalog UPDATE rather than a deploy.
 *   2. AN AGENT MAY ONLY FILE AGAINST THEIR OWN DEAL. Verified against Zoho, and the client snapshot
 *      (company, carrier, application) is read from that same deal record rather than trusted from the
 *      body — otherwise an agent could attach someone else's carrier to their own deal's ticket.
 *
 * Kept out of the route so both properties are unit-testable with no HTTP and no database.
 */

/** Fallbacks used only when a tenant has no settings row AND the map lacks the priority. */
const FALLBACK_RESOLUTION_HOURS = 24;
const FALLBACK_FIRST_RESPONSE_HOURS = 8;

export interface CreateClientTicketInput {
  /** Catalog code — 'C-7', 'Q-1', 'V-3'. Chooses the queue. */
  typeCode: string;
  subject: string;
  description: string;
  /** The agent's Zoho CRM Deal. Required: a client ticket is always about a deal of theirs. */
  dealId: string;
  /** Operational payload for card-shaped types. Never client identity. */
  cardNumber?: string | undefined;
  priority?: CommsTicketPriority | undefined;
  /** Which Mytrion filed it — answers "who generates the most CS load". */
  sourceMytrion?: string | undefined;
  sourceDepartment?: string | undefined;
  idempotencyKey?: string | undefined;
}

export interface ResolvedTicketType {
  row: MytrionTicketType;
  targetDepartment: string;
  priority: CommsTicketPriority;
}

/**
 * Resolve a catalog code into a routable ticket type, or refuse.
 *
 * Every refusal here is a 400 the agent can act on, which is the difference between this and the Desk
 * path: filing an unroutable ticket in Desk succeeded and then sat in nobody's queue.
 */
export async function resolveTicketType(
  ctx: TenantContext,
  typeCode: string,
  requestedPriority?: CommsTicketPriority,
): Promise<ResolvedTicketType> {
  const row = await commsCatalogRepo.byCode(ctx, typeCode);
  if (!row || row.kind !== 'ticket') {
    throw new ValidationError(`Unknown ticket type '${typeCode}'.`);
  }
  if (!row.active) {
    throw new ValidationError(`Ticket type '${row.code}' (${row.label}) is no longer available.`);
  }
  // Guaranteed by mytrion_ticket_types_target_chk, but a NULL here would insert a ticket with no queue,
  // so it is checked rather than asserted away.
  const targetDepartment = row.targetDepartment;
  if (!targetDepartment) {
    throw new ValidationError(`Ticket type '${row.code}' has no target department configured.`);
  }

  const config = await commsDepartmentRepo.get(ctx, targetDepartment);
  if (config && !config.acceptsTickets) {
    throw new ValidationError(
      `The ${targetDepartment} queue is not accepting tickets. Pick a different request type.`,
    );
  }

  return {
    row,
    targetDepartment,
    // Requested priority is advisory and clamped by zod at the route; the catalog default wins when the
    // client says nothing, and 'medium' is the last resort so `priority` is never NULL.
    priority: requestedPriority ?? row.defaultPriority ?? 'medium',
  };
}

/**
 * Verify the caller owns the deal and return its client snapshot.
 *
 * Blanket-access callers (admin / all-department / bypass) skip the ownership check — they legitimately
 * file on behalf of an agent — but they do NOT skip the deal read: the snapshot still has to come from
 * the record, or an admin-filed ticket would be the one with an unverified carrier on it.
 */
export async function resolveOwnedDeal(
  ctx: TenantContext,
  dealId: string,
  actorZohoUserId: string,
): Promise<DealSnapshot> {
  let snapshot: DealSnapshot | null;
  try {
    snapshot = await fetchDealSnapshot(dealId);
  } catch (err) {
    // A CRM outage must not read as "this deal is not yours" — that would send an agent hunting for a
    // permissions problem that does not exist.
    throw new ValidationError(
      `Could not verify the deal in CRM: ${err instanceof Error ? err.message : 'lookup failed'}`,
    );
  }
  if (!snapshot) throw new ValidationError(`Deal ${dealId} was not found in CRM.`);

  const blanket = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
  if (!blanket && snapshot.ownerId !== actorZohoUserId) {
    await auditFromContext(ctx, {
      action: 'comms.ticket.create',
      status: 'denied',
      resourceType: 'crm_deal',
      resourceId: dealId,
      detail: { reason: 'deal not owned by caller', dealOwnerId: snapshot.ownerId },
    });
    throw new RBACError('This deal is not yours — you can only file tickets on your own deals.');
  }
  return snapshot;
}

export interface SlaTargets {
  slaHours: number;
  dueAt: Date;
  firstResponseDueAt: Date;
}

/**
 * Resolution and first-response deadlines.
 *
 * Computed server-side, unlike the Sales widget which does this arithmetic in the browser: a deadline
 * the client calculates cannot be swept for breaches, and two clients on different clocks disagree
 * about whether the same ticket is late.
 */
export async function resolveSla(
  ctx: TenantContext,
  type: ResolvedTicketType,
  from: Date,
): Promise<SlaTargets> {
  const settings = await commsSettingsRepo.getEffective(ctx);
  const config = await commsDepartmentRepo.get(ctx, type.targetDepartment);

  // Precedence: the catalog row is the most specific, then a department override, then the tenant map.
  // All 60 seeded rows have sla_hours NULL, so in practice the map is what runs today.
  const slaHours =
    type.row.slaHours ??
    config?.slaHoursOverride ??
    slaHoursFor(settings.slaHoursByPriority, type.priority, FALLBACK_RESOLUTION_HOURS);

  const firstResponseHours = slaHoursFor(
    settings.firstResponseHoursByPriority,
    type.priority,
    FALLBACK_FIRST_RESPONSE_HOURS,
  );

  return {
    slaHours,
    dueAt: new Date(from.getTime() + slaHours * 3_600_000),
    // Clamped so a misconfigured map cannot promise a first response after the resolution deadline.
    firstResponseDueAt: new Date(
      from.getTime() + Math.min(firstResponseHours, slaHours) * 3_600_000,
    ),
  };
}

/** Last 4 for display. The full card is stored but never logged or placed in audit detail. */
function lastFour(cardNumber?: string): string | null {
  const digits = (cardNumber ?? '').replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/**
 * File a client ticket end to end: resolve the type, verify the deal, compute SLA, write the unit,
 * journal it, and publish.
 *
 * Returns the created unit. The caller (the route) owns the audit-success row and the HTTP shape.
 */
export async function createClientTicket(
  ctx: TenantContext,
  input: CreateClientTicketInput,
): Promise<CreatedTicket> {
  const actor = actorZohoUserIdOf(ctx);
  if (!actor) {
    throw new RBACError('Filing a ticket requires a signed-in worker identity.');
  }

  const type = await resolveTicketType(ctx, input.typeCode, input.priority);
  const deal = await resolveOwnedDeal(ctx, input.dealId, actor);

  if (type.row.requiresCarrier && !deal.carrierId) {
    throw new ValidationError(
      `'${type.row.label}' needs an activated client. Deal ${input.dealId} has no Carrier ID yet.`,
    );
  }
  if (type.row.requiresCard && !input.cardNumber) {
    throw new ValidationError(`'${type.row.label}' needs a card number.`);
  }

  const now = new Date();
  const sla = await resolveSla(ctx, type, now);

  const created = await commsTicketRepo.createWithThread(ctx, {
    kind: 'ticket',
    ticketTypeId: type.row.id,
    ticketTypeCode: type.row.code,
    ticketTypeLabel: type.row.label,
    targetDepartment: type.targetDepartment,
    sourceDepartment: input.sourceDepartment ?? null,
    sourceMytrion: input.sourceMytrion ?? null,
    priority: type.priority,
    requesterKind: 'worker',
    requesterZohoUserId: actor,
    requesterName: ctx.userName ?? actor,
    // Snapshot, straight off the deal record.
    carrierId: deal.carrierId,
    companyName: deal.companyName,
    applicationId: deal.applicationId,
    crmDealId: deal.dealId,
    cardNumber: input.cardNumber ?? null,
    cardLast4: lastFour(input.cardNumber),
    channel: 'web',
    source: 'worker',
    slaHours: sla.slaHours,
    dueAt: sla.dueAt,
    firstResponseDueAt: sla.firstResponseDueAt,
    idempotencyKey: input.idempotencyKey ?? null,
    createdByZohoUserId: actor,
    subject: input.subject,
    // DEPARTMENT-visible, so the whole target queue can work it. This is what makes a native ticket
    // reachable by CS without materialising a member row for every CS agent up front.
    visibility: 'department',
    threadDepartment: type.targetDepartment,
    body: input.description,
  });

  // A replay wrote nothing, so it must not journal or publish a second time.
  if (!created.created) return created;

  await commsTicketEventRepo.append(ctx, {
    ticketId: created.ticket.id,
    threadId: created.thread.id,
    eventType: 'created',
    actorZohoUserId: actor,
    actorName: ctx.userName ?? null,
    toStatus: 'open',
    detail: {
      typeCode: type.row.code,
      targetDepartment: type.targetDepartment,
      priority: type.priority,
      dealId: deal.dealId,
      carrierId: deal.carrierId,
      slaHours: sla.slaHours,
    },
  });

  publishSafely('comms.ticket.created', () => {
    publishThreadEvent(
      created.thread,
      created.members,
      {
        type: 'comms.ticket.created',
        threadId: created.thread.id,
        seq: created.message.seq,
        ticketId: created.ticket.id,
        number: created.ticket.number,
        kind: created.ticket.kind,
        subject: created.thread.subject,
        status: created.ticket.status,
        priority: created.ticket.priority,
        targetDepartment: created.ticket.targetDepartment,
        companyName: created.ticket.companyName,
      },
      // alsoQueue: the target department's board is the whole point of filing — the requester is the
      // only member yet, so without this nobody on the receiving side hears about it.
      { alsoQueue: true, excludeMemberKey: actor },
    );
  });

  return created;
}
