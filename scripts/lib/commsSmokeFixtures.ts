/**
 * Shared fixtures for the comms smoke check (scripts/comms-repo-smoke.ts).
 *
 * Split out only for the 600-line file cap: the entry script owns the refusal guard, the reporter and
 * the substrate checks, `commsTicketChecks.ts` owns the native ticket path, and both need the same
 * tenants, identities and "file a ticket" helper.
 */
import { db } from '../../src/db/client.js';
import {
  mytrionCommsSettings,
  mytrionDepartmentConfig,
  mytrionTicketTypes,
  tenants,
} from '../../src/db/schema/index.js';
import { commsTicketEventRepo } from '../../src/repos/commsTicketEventRepo.js';
import { commsTicketRepo, type CreatedTicket } from '../../src/repos/commsTicketRepo.js';
import { resolveSla, resolveTicketType } from '../../src/modules/comms/ticketService.js';
import type { DealSnapshot } from '../../src/integrations/salesDataCenter.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

export const TENANT = 'octane';
/** A second tenant, so "a different tenant sees nothing" is asserted against real rows. */
export const OTHER_TENANT = 'smoke-other-tenant';
/** Per-run token, so the list/paging assertions narrow to this run and the script is re-runnable. */
export const RUN = Date.now().toString(36);
/** Stored in full on the ticket row; must never appear in a DTO. */
export const CARD_FULL = '4111111111111234';

/** The reporter the entry script owns — passed in so the failure count lives in one place. */
export type Ok = (label: string, cond: boolean, extra?: string) => void;

export function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: TENANT,
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'smoke',
    ...over,
  } as TenantContext;
}

export const sales = ctxOf({ userName: 'Ali (Sales)' });
export const cs = ctxOf({
  userId: 'zoho:77',
  departments: ['customer-service'],
  userName: 'Dilnoza (CS)',
});
export const otherSalesAgent = ctxOf({ userId: 'zoho:999', departments: ['sales'] });

/**
 * Seed the tenants, settings, department config and catalog rows the create path reads.
 *
 * 0092-0094 seed them with `SELECT … FROM tenants t`, so on a database migrated BEFORE any tenant
 * existed (which is exactly what the header's DROP/CREATE + migrate sequence produces) they insert
 * nothing at all. Every insert here is therefore `onConflictDoNothing`, so a DB where the migration
 * seeds DID run keeps the migration's own rows and this stays a genuine no-op.
 */
export async function seedCommsFixtures(): Promise<void> {
  await db
    .insert(tenants)
    .values([
      { id: TENANT, name: 'Octane', audience: 'internal' },
      { id: OTHER_TENANT, name: 'Other', audience: 'partner' },
    ])
    .onConflictDoNothing();

  await db.insert(mytrionCommsSettings).values({ tenantId: TENANT }).onConflictDoNothing();

  await db
    .insert(mytrionDepartmentConfig)
    .values([
      { tenantId: TENANT, department: 'customer-service', acceptsTickets: true },
      { tenantId: TENANT, department: 'billing', acceptsTickets: true },
      {
        tenantId: TENANT,
        department: 'sales',
        acceptsTickets: false,
        ticketAssignmentStrategy: 'manual',
      },
    ])
    .onConflictDoNothing();

  // Only the two codes these checks file against. 'C-7' mirrors the real seeded row (Account
  // Reactivation, queue = customer-service, requires_carrier); 'Q-1' has a DIFFERENT queue, which is
  // what proves target_department is read per catalog row rather than from a constant.
  await db
    .insert(mytrionTicketTypes)
    .values([
      {
        tenantId: TENANT,
        code: 'C-7',
        label: 'Account Reactivation',
        kind: 'ticket',
        targetDepartment: 'customer-service',
        group: 'Customer Service',
        requiresCarrier: true,
        active: true,
        sortOrder: 7,
      },
      {
        tenantId: TENANT,
        code: 'Q-1',
        label: 'Invoice Request',
        kind: 'ticket',
        targetDepartment: 'billing',
        group: 'Billing & Accounting',
        requiresCarrier: true,
        active: true,
        sortOrder: 25,
      },
    ])
    .onConflictDoNothing();
}

/** A deal snapshot as `fetchDealSnapshot` would return it. Owned by 42 — the Sales context above. */
export function dealOf(over: Partial<DealSnapshot> = {}): DealSnapshot {
  return {
    dealId: '5551234000000001',
    ownerId: '42',
    dealName: 'Pilot Logistics — reactivation',
    companyName: 'Pilot Logistics LLC',
    carrierId: `CAR-${RUN}`,
    applicationId: 'APP-88',
    ...over,
  };
}

export interface FileTicketOptions {
  typeCode: string;
  subject: string;
  body: string;
  deal?: DealSnapshot;
  cardNumber?: string;
  idempotencyKey?: string;
}

/**
 * The DB half of `modules/comms/ticketService.createClientTicket`.
 *
 * The service's one non-DB step is the Zoho COQL read that proves the agent owns the deal
 * (`resolveOwnedDeal`) and supplies the client snapshot; it has no database component and is asserted
 * offline. Everything after it is reproduced verbatim — resolve the type from the CATALOG (never from
 * an argument), compute the SLA server-side, write the unit, then append the 'created' journal row the
 * same way the service does, i.e. AFTER the create transaction commits.
 */
export async function fileTicket(
  ctx: TenantContext,
  opts: FileTicketOptions,
): Promise<CreatedTicket> {
  const actor = ctx.userId.slice('zoho:'.length);
  const deal = opts.deal ?? dealOf();
  const type = await resolveTicketType(ctx, opts.typeCode);
  const sla = await resolveSla(ctx, type, new Date());

  const created = await commsTicketRepo.createWithThread(ctx, {
    kind: 'ticket',
    ticketTypeId: type.row.id,
    ticketTypeCode: type.row.code,
    ticketTypeLabel: type.row.label,
    // Straight off the catalog row — never a caller argument. This is the property under test.
    targetDepartment: type.targetDepartment,
    sourceDepartment: 'sales',
    sourceMytrion: 'sales',
    priority: type.priority,
    requesterKind: 'worker',
    requesterZohoUserId: actor,
    requesterName: ctx.userName ?? actor,
    // Client linkage: snapshot from the deal record, not from the request.
    carrierId: deal.carrierId,
    companyName: deal.companyName,
    applicationId: deal.applicationId,
    crmDealId: deal.dealId,
    cardNumber: opts.cardNumber ?? null,
    cardLast4: opts.cardNumber ? opts.cardNumber.slice(-4) : null,
    channel: 'web',
    source: 'worker',
    slaHours: sla.slaHours,
    dueAt: sla.dueAt,
    firstResponseDueAt: sla.firstResponseDueAt,
    idempotencyKey: opts.idempotencyKey ?? null,
    createdByZohoUserId: actor,
    subject: opts.subject,
    visibility: 'department',
    threadDepartment: type.targetDepartment,
    body: opts.body,
  });

  if (created.created) {
    await commsTicketEventRepo.append(ctx, {
      ticketId: created.ticket.id,
      threadId: created.thread.id,
      eventType: 'created',
      actorZohoUserId: actor,
      actorName: ctx.userName ?? null,
      toStatus: 'open',
      detail: { typeCode: type.row.code, targetDepartment: type.targetDepartment },
    });
  }
  return created;
}
