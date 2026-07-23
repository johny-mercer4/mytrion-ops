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
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { DESK_DEPARTMENTS, zohoDesk } from '../../integrations/zohoDesk.js';
import { enrichTicketOwners } from '../../modules/tools/deskOwners.js';
import { RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  fetchDeskAgentRoster,
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

/** All open CS Desk tickets, merged across the open statuses (deduped by id, Open first). */
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
    if (id && !byId.has(id)) byId.set(id, row);
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
   * Team-wide open-ticket aggregate for the Home panel (widget parity: every CS agent sees
   * the TEAM overview). Deliberately narrow — a summed count + priority histogram, never
   * the per-agent breakdown (that stays manager-only via /cs/analytics/tickets).
   */
  app.get('/cs/analytics/tickets/team-open', guard, async (request) => {
    requireCsAccess(request);
    const q = z.object({ from: isoStamp, to: isoStamp }).parse(request.query);
    // Aggregate counts come from the DWH analytics proxy (accurate total even >100). The per-ticket
    // list is a live Desk read (CS dept, Open) so an agent sees the actual tickets — number, status,
    // owner — not just a histogram. Independent so a slow/failed Desk read still returns the counts.
    const [aggR, listR] = await Promise.allSettled([
      serverCrm.get('/api/desk/dwh/tickets/analytics', { from: q.from, to: q.to }) as Promise<{
        data?: { agents?: Array<{ open_count?: number }>; byPriority?: unknown };
      }>,
      fetchCsOpenTicketsDetailed(),
    ]);
    const agg = aggR.status === 'fulfilled' ? aggR.value : {};
    const agents = agg.data?.agents ?? [];
    const summedOpen = agents.reduce((sum, a) => sum + (Number(a.open_count) || 0), 0);

    let tickets: TeamOpenTicket[] = [];
    if (listR.status === 'fulfilled') {
      const enriched = await enrichTicketOwners(listR.value).catch(() => listR.value);
      tickets = enriched
        .map((t) => ({
          id: String(t.id ?? ''),
          ticketNumber: sstr(t.ticketNumber),
          status: sstr(t.status),
          statusType: sstr(t.statusType),
          priority: sstr(t.priority),
          subject: sstr(t.subject),
          owner: ticketOwnerName(t.assignee),
        }))
        .filter((t) => t.id)
        .slice(0, 100);
    }
    // Prefer the DWH total; fall back to the live list length if the analytics proxy was down.
    const openTickets = summedOpen > 0 ? summedOpen : tickets.length;
    return { openTickets, byPriority: agg.data?.byPriority ?? [], tickets };
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

  /** Desk agent roster (leaderboard + drill-in) — manager tier only. */
  app.get('/cs/analytics/roster', guard, async (request) => {
    const ctx = requireCsAccess(request);
    if (!isCsManager(ctx)) {
      throw new RBACError('The agent roster requires CS manager access');
    }
    const agents = await fetchDeskAgentRoster();
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
