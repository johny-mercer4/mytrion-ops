/**
 * Billing Mytrion — REST writes (/v1/billing/*).
 *
 * The Data Center deal-billing edit is a DIRECT Zoho CRM record update (the widget's
 * datacenter-panel.js edit modal calls ZOHO.CRM.API.updateRecord, not a Deluge function), so it
 * lives here as a route — not a touchpoint — where the servercrm/CRM key stays server-side, the
 * field allowlist + casing resolution run, and the write is audited. Mirrors the CS
 * /cs/data-center/deals/:id route but gated to the `billing` department.
 *
 * The Transactions mapping writes (map/unmap/top-up/sync/split) ARE Deluge functions and go
 * through the billing.* touchpoints instead (see catalog/billingDeluge.ts).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { serverCrmPost } from '../../integrations/serverCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { fuzzyResolveCarrier } from '../../modules/billing/fuzzyCarrier.js';
import { toCandidateWire, toReturnWire, toTxWire } from '../../modules/billing/wire.js';
import { resolveWritePayload } from '../../modules/customerService/fieldResolver.js';
import { carrierMemoryRepo } from '../../repos/carrierMemoryRepo.js';
import { paymentReturnRepo } from '../../repos/paymentReturnRepo.js';
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireBillingAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'billing', 'Billing');
}

/** Tri-state boolean query flag ("1"/"true"/"yes" → true). */
const boolish = z.enum(['0', '1', 'true', 'false', 'yes', 'no']).transform((v) => v === '1' || v === 'true' || v === 'yes');

const txListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(2000).default(200),
  source: z.enum(['mx', 'zelle', 'chase', 'stripe']).optional(),
  isMapped: boolish.optional(),
  carrierId: z.string().max(60).optional(),
  dateFrom: z.string().max(40).optional(),
  dateTo: z.string().max(40).optional(),
});
const txSearchQuery = z.object({
  query: z.string().min(1).max(200),
  limit: z.coerce.number().int().positive().max(2000).optional(),
});
const returnsListQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(2000).default(200),
  matched: boolish.optional(),
});
const candidatesQuery = z.object({
  query: z.string().max(200).optional(),
  amount: z.string().max(40).optional(),
  beforeDate: z.string().max(40).optional(),
  customerName: z.string().max(200).optional(),
});
const fuzzyBody = z.object({
  senderName: z.string().max(200).optional(),
  description: z.string().max(400).optional(),
  email: z.string().max(200).optional(),
});

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

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // ─── Reads (Postgres-backed; replace the Zoho billing.* read touchpoints) ────────────────

  /** Paged payment ledger (newest first). The panel filters/groups/KPIs client-side. */
  app.get('/billing/transactions', guard, async (request) => {
    requireBillingAccess(request);
    const q = txListQuery.parse(request.query);
    const { rows, page, total, hasMore } = await paymentTransactionRepo.listPage(q);
    return {
      transactions: rows.map(toTxWire),
      page,
      total_fetched: total,
      total,
      has_more: hasMore,
      hasMore,
    };
  });

  /** Full-dataset text search (payer / memo / txn # / exact carrier id). */
  app.get('/billing/transactions/search', guard, async (request) => {
    requireBillingAccess(request);
    const q = txSearchQuery.parse(request.query);
    const rows = await paymentTransactionRepo.search(q.query, q.limit ?? 500);
    return { records: rows.map(toTxWire), count: rows.length };
  });

  /** Paged returns / chargebacks queue. */
  app.get('/billing/returns', guard, async (request) => {
    requireBillingAccess(request);
    const q = returnsListQuery.parse(request.query);
    const { rows, page, hasMore } = await paymentReturnRepo.listPage(q);
    return { returns: rows.map(toReturnWire), page, has_more: hasMore, hasMore };
  });

  /** Candidate original payments for manually matching a return. */
  app.get('/billing/returns/candidates', guard, async (request) => {
    requireBillingAccess(request);
    const q = candidatesQuery.parse(request.query);
    const rows = await paymentTransactionRepo.findReturnCandidates(q);
    return { status: 'success', records: rows.map(toCandidateWire), mode: 'search' };
  });

  /** Learned company → carrier memory (fetched whole, widget parity). */
  app.get('/billing/carrier/memory', guard, async (request) => {
    requireBillingAccess(request);
    const rows = await carrierMemoryRepo.list();
    return { data: rows.map((m) => ({ companyName: m.companyName, carrierId: m.carrierId })) };
  });

  /** Fuzzy carrier suggestion from a payer name / bank descriptor (DWH roster + PG memory). */
  app.post('/billing/carrier/fuzzy', guard, async (request) => {
    requireBillingAccess(request);
    const body = fuzzyBody.parse(request.body ?? {});
    return fuzzyResolveCarrier(body);
  });

  /** Data Center billing-fields edit on a Deal (allowlisted, casing-resolved, audited). */
  app.post('/billing/data-center/deals/:id', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = idParam.parse(request.params);
    const body = dealBillingBody.parse(request.body);
    const resolved = await resolveWritePayload(
      'Deals',
      Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)),
    );
    await zohoCrmRecords.updateRecord('Deals', id, resolved);
    await auditFromContext(ctx, {
      action: 'billing.datacenter.deal_update',
      status: 'ok',
      resourceType: 'crm_deal',
      resourceId: id,
      detail: { fields: Object.keys(resolved) },
    });
    return { id, updatedFields: Object.keys(resolved) };
  });

  /**
   * Real-time mapping relay (Phase 3b). The Transactions panel POSTs a mapping/unmap/returned
   * event here after a successful write; we forward it to servercrm's mapping-event hub (which
   * rebroadcasts over the WebSocket to other open clients). This proxy keeps the servercrm
   * x-api-key server-side — the browser never holds it. `mappedBy` is overwritten with the
   * verified session name so peers see the real actor, never a client-supplied label.
   * Best-effort: a relay failure must not fail the user's mapping, so we swallow upstream errors.
   */
  const mappingEventBody = z.object({
    action: z.enum(['map', 'unmap', 'returned']),
    transactionRecordId: z.string().min(1).max(120),
    source: z.string().max(40).optional(),
    carrierId: z.string().max(120).optional(),
    mappingType: z.string().max(60).optional(),
    mappedAt: z.string().max(40).optional(),
    originId: z.string().max(80),
  });

  app.post('/billing/mapping-event', guard, async (request, reply) => {
    const ctx = requireBillingAccess(request);
    const body = mappingEventBody.parse(request.body);
    const payload = { ...body, mappedBy: ctx.userName ?? 'A billing agent' };
    try {
      await serverCrmPost('/api/billing/mapping-event', payload);
    } catch {
      // Relay is best-effort — the authoritative write already succeeded client-side.
      return reply.code(202).send({ relayed: false });
    }
    return { relayed: true };
  });
}
