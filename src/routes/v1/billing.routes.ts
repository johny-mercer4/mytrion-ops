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
import { NotFoundError } from '../../lib/errors.js';
import { serverCrmPost } from '../../integrations/serverCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  applyInvoicePayment,
  patchCompanyBalance,
  resolveCompanyId,
  reverseMapping,
} from '../../modules/billing/cmpWrites.js';
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

/** Actor label for mapped_by / matched_by — always the verified session, never client-supplied. */
function actor(ctx: TenantContext): string {
  return ctx.userName ?? 'A billing agent';
}

/** Bank descriptors are never learnable senders — skip the memory write (widget parity). */
function isJunkCompanyName(name: string): boolean {
  const n = name.trim();
  return !n || n.length < 3 || /^\d+$/.test(n);
}

const txIdParam = z.object({ id: z.coerce.number().int().positive() });

const mapBody = z.object({
  invoiceId: z.string().min(1).max(60),
  invoiceNumber: z.string().max(60).default(''),
  paymentAmount: z.coerce.number(),
  paymentDate: z.string().max(40),
  note: z.string().max(500).optional(),
  carrierId: z.string().min(1).max(60),
});
const topUpBody = z.object({
  carrierId: z.string().min(1).max(60),
  paymentAmount: z.coerce.number(),
  paymentDate: z.string().max(40),
  note: z.string().max(500).optional(),
});
const syncBody = z.object({
  carrierId: z.string().min(1).max(60),
  invoiceNumber: z.string().max(60).optional(),
});
const splitBody = z.object({ splitsJson: z.string().min(2).max(20000) });
const unmapBody = z.object({ clearCrm: z.enum(['true', 'false']).optional() });
const returnMatchBody = z.object({ transactionRecordId: z.coerce.number().int().positive() });
const memoryBody = z.object({ companyName: z.string().max(200), carrierId: z.string().min(1).max(60) });

interface SplitAlloc {
  type: 'invoice' | 'prepay' | 'syncOnly';
  carrierId: string;
  amount: number;
  invoiceId?: string;
  invoiceNumber?: string;
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
    const result = await fuzzyResolveCarrier(body);
    return { status: 'success', ...result };
  });

  // ─── Writes (PG row-of-record + CMP money movement via servercrm) ────────────────────────
  // Each: validate → CMP call(s) via servercrm → on success stamp the PG mapping → audit → return
  // the widget-compatible {status:'success'|'partial'|'error'}. Identity (mapped_by/matched_by) is
  // the verified session, never client-supplied. Money is only ever moved in CMP.

  const cmpErr = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /** Map a payment to a CMP invoice. */
  app.post('/billing/transactions/:id/map', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = txIdParam.parse(request.params);
    const b = mapBody.parse(request.body);
    const tx = await paymentTransactionRepo.getById(id);
    if (!tx) throw new NotFoundError(`Transaction ${id} not found`);
    if (tx.isInvoiceMapped) return { status: 'error', message: 'Transaction is already mapped' };
    let paymentId: string | null = null;
    try {
      ({ paymentId } = await applyInvoicePayment({ invoiceId: b.invoiceId, amount: b.paymentAmount, paymentDate: b.paymentDate, notes: b.note }));
    } catch (e) {
      await auditFromContext(ctx, { action: 'billing.transactions.map', status: 'error', resourceType: 'payment_transaction', resourceId: String(id), detail: { invoiceId: b.invoiceId, error: cmpErr(e) } });
      return { status: 'error', message: `CMP payment failed: ${cmpErr(e)}` };
    }
    const cmpRef = { kind: 'invoice', invoiceId: b.invoiceId, invoiceNumber: b.invoiceNumber, amount: b.paymentAmount, paymentId };
    await paymentTransactionRepo.applyMapping(id, { carrierId: b.carrierId, isInvoiceMapped: true, mappingType: 'Invoice', mappedBy: actor(ctx), mappedAt: new Date(), cmpRef });
    await auditFromContext(ctx, { action: 'billing.transactions.map', status: 'ok', resourceType: 'payment_transaction', resourceId: String(id), detail: { invoiceId: b.invoiceId, paymentId, amount: b.paymentAmount } });
    return { status: 'success', paymentId };
  });

  /** Prepay top-up (credit the carrier's CMP company balance). */
  app.post('/billing/transactions/:id/top-up', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = txIdParam.parse(request.params);
    const b = topUpBody.parse(request.body);
    const tx = await paymentTransactionRepo.getById(id);
    if (!tx) throw new NotFoundError(`Transaction ${id} not found`);
    if (tx.isInvoiceMapped) return { status: 'error', message: 'Transaction is already mapped' };
    let companyId = '';
    try {
      companyId = await resolveCompanyId(b.carrierId);
      if (!companyId) return { status: 'error', message: `No CMP company for carrier ${b.carrierId}` };
      await patchCompanyBalance(companyId, b.paymentAmount);
    } catch (e) {
      await auditFromContext(ctx, { action: 'billing.transactions.topup', status: 'error', resourceType: 'payment_transaction', resourceId: String(id), detail: { carrierId: b.carrierId, error: cmpErr(e) } });
      return { status: 'error', message: `CMP top-up failed: ${cmpErr(e)}` };
    }
    const cmpRef = { kind: 'prepay', companyId, carrierId: b.carrierId, amount: b.paymentAmount };
    await paymentTransactionRepo.applyMapping(id, { carrierId: b.carrierId, isInvoiceMapped: true, mappingType: 'Prepay Top-Up', mappedBy: actor(ctx), mappedAt: new Date(), cmpRef });
    await auditFromContext(ctx, { action: 'billing.transactions.topup', status: 'ok', resourceType: 'payment_transaction', resourceId: String(id), detail: { carrierId: b.carrierId, companyId, amount: b.paymentAmount } });
    return { status: 'success', topUpId: companyId };
  });

  /** CRM-only sync (the CMP payment already exists in the portal; just reconcile PG). */
  app.post('/billing/transactions/:id/sync-crm-only', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = txIdParam.parse(request.params);
    const b = syncBody.parse(request.body);
    const tx = await paymentTransactionRepo.getById(id);
    if (!tx) throw new NotFoundError(`Transaction ${id} not found`);
    if (tx.isInvoiceMapped) return { status: 'error', message: 'Transaction is already mapped' };
    const mappingType = b.invoiceNumber ? 'CRM-Sync (Invoice)' : 'CRM-Sync (Prepay)';
    await paymentTransactionRepo.applyMapping(id, { carrierId: b.carrierId, isInvoiceMapped: true, mappingType, mappedBy: actor(ctx), mappedAt: new Date() });
    await auditFromContext(ctx, { action: 'billing.transactions.sync', status: 'ok', resourceType: 'payment_transaction', resourceId: String(id), detail: { carrierId: b.carrierId, mappingType } });
    return { status: 'success' };
  });

  /** Split a payment across invoices/prepay (sequential CMP; stop-on-first-failure → partial). */
  app.post('/billing/transactions/:id/split', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = txIdParam.parse(request.params);
    const { splitsJson } = splitBody.parse(request.body);
    const tx = await paymentTransactionRepo.getById(id);
    if (!tx) throw new NotFoundError(`Transaction ${id} not found`);
    if (tx.isInvoiceMapped) return { status: 'error', message: 'Transaction is already mapped' };
    let splits: SplitAlloc[];
    try {
      const parsed: unknown = JSON.parse(splitsJson);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('empty splits');
      splits = parsed as SplitAlloc[];
    } catch (e) {
      return { status: 'error', message: `Invalid splits: ${cmpErr(e)}` };
    }
    const results: Record<string, unknown>[] = [];
    for (const s of splits) {
      try {
        if (s.type === 'invoice') {
          if (!s.invoiceId) throw new Error('split invoice missing invoiceId');
          const { paymentId } = await applyInvoicePayment({ invoiceId: s.invoiceId, amount: s.amount, paymentDate: new Date().toISOString().slice(0, 10) });
          results.push({ type: 'invoice', carrierId: s.carrierId, amount: s.amount, invoiceId: s.invoiceId, invoiceNumber: s.invoiceNumber ?? '', paymentId, status: 'success' });
        } else if (s.type === 'prepay') {
          const companyId = await resolveCompanyId(s.carrierId);
          if (!companyId) throw new Error(`no CMP company for ${s.carrierId}`);
          await patchCompanyBalance(companyId, s.amount);
          results.push({ type: 'prepay', carrierId: s.carrierId, amount: s.amount, cmpCompanyId: companyId, status: 'success' });
        } else {
          results.push({ type: 'syncOnly', carrierId: s.carrierId, amount: s.amount, status: 'success' });
        }
      } catch (e) {
        const applied = results.length;
        await auditFromContext(ctx, { action: 'billing.transactions.split', status: 'error', resourceType: 'payment_transaction', resourceId: String(id), detail: { applied, error: cmpErr(e) } });
        return { status: 'partial', message: `Split failed after ${applied} of ${splits.length}: ${cmpErr(e)}`, appliedCount: applied, reversed: [] };
      }
    }
    await paymentTransactionRepo.applyMapping(id, { carrierId: splits[0]?.carrierId ?? '', isInvoiceMapped: true, mappingType: 'Split', mappedBy: actor(ctx), mappedAt: new Date(), splitAllocations: results });
    await auditFromContext(ctx, { action: 'billing.transactions.split', status: 'ok', resourceType: 'payment_transaction', resourceId: String(id), detail: { appliedCount: results.length } });
    return { status: 'success', appliedCount: results.length };
  });

  /** Unmap: reverse the CMP money, then clear the PG mapping (unless clearCrm=false). */
  app.post('/billing/transactions/:id/unmap', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = txIdParam.parse(request.params);
    const b = unmapBody.parse(request.body ?? {});
    const tx = await paymentTransactionRepo.getById(id);
    if (!tx) throw new NotFoundError(`Transaction ${id} not found`);
    const rev = await reverseMapping({
      cmpRef: tx.cmpRef,
      splitAllocations: tx.splitAllocations,
      carrierId: tx.carrierId,
      amount: tx.amount != null ? Number(tx.amount) : null,
      chargedDay: tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : null,
    });
    if (!rev.ok) {
      await auditFromContext(ctx, { action: 'billing.transactions.unmap', status: 'error', resourceType: 'payment_transaction', resourceId: String(id), detail: { message: rev.message } });
      return { status: 'partial', message: rev.message ?? 'CMP reversal incomplete — mapping kept', reversed: rev.reversed };
    }
    if (b.clearCrm !== 'false') await paymentTransactionRepo.clearMapping(id);
    await auditFromContext(ctx, { action: 'billing.transactions.unmap', status: 'ok', resourceType: 'payment_transaction', resourceId: String(id), detail: { kind: rev.kind, cleared: b.clearCrm !== 'false' } });
    return { status: 'success', reversed: rev.reversed };
  });

  /** Match a return to its original payment: reverse the CMP payment (KEEP the mapping), flag returned. */
  app.post('/billing/returns/:id/match', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const { id } = txIdParam.parse(request.params);
    const b = returnMatchBody.parse(request.body);
    const ret = await paymentReturnRepo.getById(id);
    if (!ret) throw new NotFoundError(`Return ${id} not found`);
    const tx = await paymentTransactionRepo.getById(b.transactionRecordId);
    if (!tx) throw new NotFoundError(`Transaction ${b.transactionRecordId} not found`);

    let matchNote = 'not mapped — no CMP payment to reverse';
    let isReversed = false;
    if (tx.isInvoiceMapped) {
      const rev = await reverseMapping({
        cmpRef: tx.cmpRef,
        splitAllocations: tx.splitAllocations,
        carrierId: tx.carrierId,
        amount: tx.amount != null ? Number(tx.amount) : null,
        chargedDay: tx.occurredAt ? tx.occurredAt.toISOString().slice(0, 10) : null,
      });
      if (rev.ok) {
        isReversed = rev.kind !== 'none';
        if (isReversed) matchNote = 'Reversal(s) applied to CMP';
      } else {
        matchNote = `CMP reverse failed — reconcile manually: ${rev.message ?? ''}`;
      }
    }
    await paymentReturnRepo.linkMatch(id, { originalTransactionId: b.transactionRecordId, matchNote, matchedBy: actor(ctx), isReversed });
    await paymentTransactionRepo.setReturned(b.transactionRecordId, new Date());
    await auditFromContext(ctx, { action: 'billing.returns.match', status: 'ok', resourceType: 'payment_return', resourceId: String(id), detail: { transactionId: b.transactionRecordId, isReversed, matchNote } });
    return { status: 'success', matchNote, isReversed };
  });

  /** Learn a company → carrier pair (auto-map memory). */
  app.post('/billing/carrier/memory', guard, async (request) => {
    const ctx = requireBillingAccess(request);
    const b = memoryBody.parse(request.body);
    if (isJunkCompanyName(b.companyName)) return { status: 'success', skipped: true };
    const { created } = await carrierMemoryRepo.insertDedup({ companyName: b.companyName, carrierId: b.carrierId, createdBy: actor(ctx) });
    return { status: 'success', created };
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
