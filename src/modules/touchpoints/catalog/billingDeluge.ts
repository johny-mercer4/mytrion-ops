/**
 * Billing Mytrion Deluge touchpoints — the read + write surface of the old
 * zoho-octane/app/billing-mytrion widget (Transactions panel + Data Center detail lookups).
 *
 * Unwrap modes mirror how the widget parses each function's `details.output`:
 *  - Reads (fetch/search transactions, invoices, fuzzy carrier, carrier memory) — the widget
 *    consumes the payload directly without a status gate → 'permissive' (returns the parsed
 *    body as-is).
 *  - Writes (map invoice, prepay top-up, CRM-only sync, split-map, unmap, save memory) return
 *    {status:'success'|'partial'|'error', message, …}. The widget inspects `status` itself and
 *    treats 'partial' as a distinct, user-actionable outcome (NOT an error), so these are also
 *    'permissive' — the frontend replicates the widget's status handling. A 'status' unwrap here
 *    would collapse 'partial' into a 502 and lose the "reconcile CMP manually" path.
 *
 * RBAC: billing is a PORTFOLIO role — agents view/act on the whole payment book, not an owned
 * carrier roster — so these carry `departments:['billing']` but deliberately NO carrierParam
 * (that would trigger owner-scoping via assertCarrierOwned and wrongly block billing agents).
 * The widget's only sub-role gate is view-only for "Verification Agent"; that read-only guard is
 * enforced in the UI (and can be hardened server-side later).
 *
 * Write risk class: these are money-adjacent (map/reverse CMP payments, prepay top-ups) but they
 * are billing's core, everyday job — so they are 'write' (invokable by the billing department),
 * not 'destructive' (admin-only unless FF_TOUCHPOINT_DESTRUCTIVE_SALES). Mapped_By/At/Type are
 * written server-side by the Deluge functions; the caller identity (`mappedBy`/`unmappedBy`) is
 * injected from the verified session (agentNameParam), never trusted from the client.
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { carrierId, idString, limit, shortText } from './common.js';

const BILLING_DEPARTMENTS = ['billing'] as const;

/** Transaction source type as the Deluge functions expect it (BM_TX_SOURCES `type`). */
const txType = z.enum(['Zelle', 'Chase', 'Mx_Merchant', 'Stripe', 'ACH', 'Wire', 'Check', 'Card']);

export const billingDelugeTouchpoints: Touchpoint[] = [
  // ── Reads ──────────────────────────────────────────────────────────────
  {
    kind: 'deluge',
    key: 'billing.transactions.list',
    title: 'Payment transactions (paged, all sources)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionfetchpaymenttransactions'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      page: limit(100_000, 1),
      limit: limit(500, 200),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.transactions.search',
    title: 'Server-side transaction search',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionsearchtransactions'],
    unwrap: 'permissive',
    paramsSchema: z.object({ query: shortText(300) }),
  },
  {
    kind: 'deluge',
    key: 'billing.invoices.search',
    title: 'Open invoices for a carrier (mapping)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionSearchInvoices'],
    unwrap: 'permissive',
    paramsSchema: z.object({ carrierId }),
  },
  {
    kind: 'deluge',
    key: 'billing.carrier.fuzzy',
    title: 'Fuzzy carrier suggestions (sender / memo / email)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionfuzzysearchcarrier'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      senderName: z.string().max(300).default(''),
      description: z.string().max(500).default(''),
      email: z.string().max(200).default(''),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.carrier.memory',
    title: 'Company↔carrier memory index (fuzzy search seed)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionfetchcarriermemory'],
    unwrap: 'permissive',
    paramsSchema: z.object({}),
  },

  // ── Writes (money-adjacent, but billing's core job → 'write') ───────────
  {
    kind: 'deluge',
    key: 'billing.transactions.mapInvoice',
    title: 'Map a transaction to an invoice',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    agentNameParam: 'mappedBy',
    functionNames: ['mytrionupdateinvoice'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      invoiceId: idString,
      invoiceNumber: shortText(80),
      paymentAmount: z.coerce.number(),
      paymentDate: shortText(40),
      note: z.string().max(1000).default(''),
      transactionRecordId: idString,
      type: txType,
      carrierId,
      mappedBy: shortText(200).optional(),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.transactions.topUp',
    title: 'Prepay top-up from a transaction',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    agentNameParam: 'mappedBy',
    functionNames: ['mytriontopupprepay'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      carrierId,
      paymentAmount: z.coerce.number(),
      paymentDate: shortText(40),
      note: z.string().max(1000).default(''),
      transactionRecordId: idString,
      type: txType,
      mappedBy: shortText(200).optional(),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.transactions.syncCrmOnly',
    title: 'Sync CRM only (CMP payment pre-existed)',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    agentNameParam: 'mappedBy',
    functionNames: ['mytrionSyncCRMOnly'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      transactionRecordId: idString,
      type: txType,
      carrierId,
      mappedBy: shortText(200).optional(),
      invoiceNumber: z.string().max(80).default(''),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.transactions.applySplits',
    title: 'Split-map a transaction across carriers/invoices',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    agentNameParam: 'mappedBy',
    functionNames: ['mytrionApplySplits'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      transactionRecordId: idString,
      type: txType,
      mappedBy: shortText(200).optional(),
      // Serialized allocation array (widget parity: splitsJson is itself a JSON string).
      splitsJson: z.string().max(20_000),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.transactions.unmap',
    title: 'Unmap a transaction (reverse CMP + clear CRM)',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    agentNameParam: 'unmappedBy',
    functionNames: ['mytrionUnmapTransaction'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      transactionRecordId: idString,
      type: txType,
      unmappedBy: shortText(200).optional(),
      // "true" = full unmap (reverse CMP + clear CRM); widget always sends the string.
      clearCrm: z.enum(['true', 'false']).default('true'),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.carrier.saveMemory',
    title: 'Persist a company↔carrier mapping (fuzzy memory)',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionSaveCarrierMemory'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      companyName: shortText(300),
      carrierId,
    }),
  },

  // ── Returns & chargebacks (Phase 2) ─────────────────────────────────────
  {
    kind: 'deluge',
    key: 'billing.returns.list',
    title: 'Returns / chargebacks (paged, Mx_Merchant_Returns)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionfetchreturns'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      page: limit(100_000, 1),
      limit: limit(500, 200),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.returns.candidates',
    title: 'Find the original MX transaction for a return',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    functionNames: ['mytrionsearchreturncandidates'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      query: z.string().max(300).default(''),
      amount: z.string().max(40).default(''),
      beforeDate: z.string().max(40).default(''),
      customerName: z.string().max(300).default(''),
    }),
  },
  {
    kind: 'deluge',
    key: 'billing.returns.match',
    title: 'Manual-match a return + reverse the CMP payment',
    riskClass: 'write',
    departments: BILLING_DEPARTMENTS,
    agentNameParam: 'matchedBy',
    functionNames: ['mytrionmanualmatchreturn'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      returnRecordId: idString,
      transactionRecordId: idString,
      matchedBy: shortText(200).optional(),
    }),
  },
];
