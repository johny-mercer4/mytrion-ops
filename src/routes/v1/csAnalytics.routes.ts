/**
 * Customer Service Mytrion — analytics + Data Center (/v1/cs/*).
 *
 * The DWH analytics proxy keeps the servercrm x-api-key server-side (the widget fetched
 * these endpoints from the browser with an org-variable key) and enforces scope where the
 * widget only gated client-side: non-managers are FORCED to their own Desk-assignee /
 * owner-email scope (email join via csAnalyticsScope; unmatched ⇒ explicit flag, never
 * org-wide data). Managers may drill into any agent or fetch org-wide aggregates.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverCrm } from '../../integrations/serverCrm.js';
import { countMaintenanceCases, fetchMaintenanceAnalytics } from '../../integrations/csMaintenance.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { DESK_DEPARTMENTS, zohoDesk } from '../../integrations/zohoDesk.js';
import { enrichTicketOwners } from '../../modules/tools/deskOwners.js';
import { RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  fetchCsEligibleRoster,
  isCsManager,
  resolveDeskAgentId,
} from '../../modules/customerService/csAnalyticsScope.js';
import { resolveWritePayload } from '../../modules/customerService/fieldResolver.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireCsAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'customer-service', 'CS analytics');
}

const isoStamp = z.string().max(40).regex(/^\d{4}-\d{2}-\d{2}/, 'expected an ISO date/datetime');

const windowQuery = z.object({
  from: isoStamp,
  to: isoStamp,
  prevFrom: isoStamp,
  prevTo: isoStamp,
});

const ticketsQuery = windowQuery.extend({ assigneeId: z.string().max(60).optional() });
const callsQuery = windowQuery.extend({ ownerEmail: z.string().max(200).optional() });
/** Home tile: just the current window (no previous-period comparison). */
const countQuery = z.object({ from: z.string().min(10).max(40), to: z.string().min(10).max(40) });

/** Trim a string-ish Desk field to a non-empty string, else null. */
function sstr(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

/** Owner (assigned agent) name from an enriched Desk ticket's `assignee` (name, or first+last). */
function ticketOwnerName(assignee: unknown): string | null {
  if (!assignee || typeof assignee !== 'object') return null;
  const a = assignee as Record<string, unknown>;
  if (typeof a.name === 'string' && a.name.trim()) return a.name.trim();
  const full = [a.firstName, a.lastName].filter((x): x is string => typeof x === 'string' && Boolean(x.trim())).join(' ').trim();
  return full || null;
}

export interface TeamOpenTicket {
  id: string;
  ticketNumber: string | null;
  status: string | null;
  statusType: string | null;
  priority: string | null;
  subject: string | null;
  owner: string | null;
}

/** Zoho's standard open (non-closed) ticket statuses. Fetched server-side per status so no open
 *  ticket is ever crowded out of a newest-N window; a status this org renamed just returns empty. */
const CS_OPEN_STATUSES = ['Open', 'On Hold', 'Escalated'] as const;

/**
 * A ticket's origin, read the same way `zohoDesk.listRejectionReportTickets` does — Desk has no
 * field for this, so subject prefix is the only signal: `desk.routes.ts` stamps CRM-widget tickets
 * "CRM Ticket: …" and `serviceRequest.ts` stamps mini-app tickets "Mini-app: …".
 */
function isCrmOrMobileTicket(row: Record<string, unknown>): boolean {
  const subject = String(row.subject ?? '').trim();
  return /^crm ticket:/i.test(subject) || /^mini-app:/i.test(subject);
}

/**
 * Open CS Desk tickets from the CRM widget + mobile mini-app, merged across the open statuses
 * (deduped by id, Open first). Auto-created "Rejection Report: …" tickets (and anything else
 * without a recognized origin) land in the same CS department but are excluded — the Home team
 * panel is CRM + mobile-app requests only.
 */
async function fetchCsOpenTicketsDetailed(): Promise<Record<string, unknown>[]> {
  const perStatus = await Promise.all(
    CS_OPEN_STATUSES.map((status) =>
      zohoDesk
        .listTicketsDetailed({ departmentId: DESK_DEPARTMENTS.cs, status, limit: 100 })
        .catch(() => [] as Record<string, unknown>[]),
    ),
  );
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of perStatus.flat()) {
    const id = String(row.id ?? '');
    if (id && !byId.has(id) && isCrmOrMobileTicket(row)) byId.set(id, row);
  }
  return [...byId.values()];
}

/** Data Center billing edit — exact widget allowlist (datacenter-panel.js edit modal). */
const dealBillingBody = z
  .object({
    Payment_Type_Billing: z.string().max(60).nullable().optional(),
    Billing_Cycle: z.string().max(60).nullable().optional(),
    Billing_Verification: z.union([z.string().max(60), z.boolean()]).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, 'no billing fields supplied');

const idParam = z.object({ id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60) });

export async function csAnalyticsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Backend verdict the frontend renders manager UI from (never a client heuristic). */
  app.get('/cs/context', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const manager = isCsManager(ctx);
    const deskAgentId = await resolveDeskAgentId(ctx).catch(() => null);
    return {
      isManager: manager,
      deskAgentId,
      email: ctx.email ?? null,
      unmatched: !manager && deskAgentId === null,
    };
  });

  /**
   * Team-wide open-ticket count for the Home panel (widget parity: every CS agent sees the TEAM
   * overview) — CRM + mobile-app tickets only, matching the list below it (see
   * fetchCsOpenTicketsDetailed). Count and priority breakdown are derived from that same list
   * rather than the DWH aggregate: the DWH has no subject field, so it can't exclude Rejection
   * Report tickets, which would make the KPI disagree with the rows actually shown. The trade-off
   * is the same cap fetchCsOpenTicketsDetailed already has (100 per status × 3 statuses).
   */
  app.get('/cs/analytics/tickets/team-open', guard, async (request) => {
    requireCsAccess(request);
    const raw = await fetchCsOpenTicketsDetailed();
    const enriched = await enrichTicketOwners(raw).catch(() => raw);
    const allTickets: TeamOpenTicket[] = enriched
      .map((t) => ({
        id: String(t.id ?? ''),
        ticketNumber: sstr(t.ticketNumber),
        status: sstr(t.status),
        statusType: sstr(t.statusType),
        priority: sstr(t.priority),
        subject: sstr(t.subject),
        owner: ticketOwnerName(t.assignee),
      }))
      .filter((t) => t.id);

    const priorityCounts = new Map<string, number>();
    for (const t of allTickets) {
      const key = t.priority ?? 'Other';
      priorityCounts.set(key, (priorityCounts.get(key) ?? 0) + 1);
    }

    return {
      openTickets: allTickets.length,
      byPriority: [...priorityCounts.entries()].map(([priority, count]) => ({ priority, count })),
      tickets: allTickets.slice(0, 100),
    };
  });

  /** Tickets analytics (DWH; scoped by Desk assignee_id). */
  app.get('/cs/analytics/tickets', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const q = ticketsQuery.parse(request.query);
    const query: Record<string, string> = {
      from: q.from,
      to: q.to,
      prevFrom: q.prevFrom,
      prevTo: q.prevTo,
    };
    if (isCsManager(ctx)) {
      if (q.assigneeId) query.assigneeId = q.assigneeId;
    } else {
      const own = await resolveDeskAgentId(ctx);
      if (!own) return { unmatched: true };
      query.assigneeId = own;
    }
    return serverCrm.get('/api/desk/dwh/tickets/analytics', query);
  });

  /** Calls analytics (DWH; scoped by CRM owner email). */
  app.get('/cs/analytics/calls', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const q = callsQuery.parse(request.query);
    const query: Record<string, string> = {
      from: q.from,
      to: q.to,
      prevFrom: q.prevFrom,
      prevTo: q.prevTo,
    };
    if (isCsManager(ctx)) {
      if (q.ownerEmail) query.ownerEmail = q.ownerEmail.toLowerCase();
    } else {
      const own = ctx.email?.trim().toLowerCase();
      if (!own) return { unmatched: true };
      query.ownerEmail = own;
    }
    return serverCrm.get('/api/desk/dwh/calls/analytics', query);
  });

  /**
   * Maintenance analytics — SQL over our own `maintenance_cases` table (see
   * integrations/csMaintenance.ts). Two generations back this was the `cs.analytics.maintenance`
   * Deluge, which paginated 5,000 records and mis-bucketed every status; that touchpoint has since
   * been removed from the catalog entirely, so this route is the only way to these figures.
   * Org-wide, like the Deluge it replaced: Maintenance rows are not owned by the CS desk.
   */
  app.get('/cs/analytics/maintenance', guard, async (request) => {
    requireCsAccess(request);
    const q = windowQuery.parse(request.query);
    const data = await fetchMaintenanceAnalytics({
      from: q.from.slice(0, 10),
      to: q.to.slice(0, 10),
      prevFrom: q.prevFrom.slice(0, 10),
      prevTo: q.prevTo.slice(0, 10),
    });
    return { success: true, data };
  });

  /** Count for the CS Home "Maintenance" tile — a windowed COUNT (the Deluge's had no WHERE → 0). */
  app.get('/cs/analytics/maintenance/count', guard, async (request) => {
    requireCsAccess(request);
    const q = countQuery.parse(request.query);
    return { count: await countMaintenanceCases(q.from.slice(0, 10), q.to.slice(0, 10)) };
  });

  /**
   * CS-eligible agent roster (leaderboard + drill-in) — manager tier only. Scoped by
   * admin-granted Mytrion access (fetchCsEligibleRoster), NOT Desk department membership: a Desk
   * department can carry cross-assigned overflow agents from other desks (QA 2026-08-07).
   */
  app.get('/cs/analytics/roster', guard, async (request) => {
    const ctx = requireCsAccess(request);
    if (!isCsManager(ctx)) {
      throw new RBACError('The agent roster requires CS manager access');
    }
    const agents = await fetchCsEligibleRoster(ctx);
    return { agents };
  });

  /** Data Center billing-fields edit on a Deal (allowlisted, casing-resolved, audited). */
  app.post('/cs/data-center/deals/:id', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const body = dealBillingBody.parse(request.body);
    const resolved = await resolveWritePayload(
      'Deals',
      Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    );
    await zohoCrmRecords.updateRecord('Deals', id, resolved);
    await auditFromContext(ctx, {
      action: 'cs.datacenter.deal_update',
      status: 'ok',
      resourceType: 'crm_deal',
      resourceId: id,
      detail: { fields: Object.keys(resolved) },
    });
    return { id, updatedFields: Object.keys(resolved) };
  });
}
