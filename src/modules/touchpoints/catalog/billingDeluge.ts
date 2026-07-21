/**
 * Billing Mytrion Deluge touchpoints — RESIDUAL surface after the Postgres migration.
 *
 * The Transactions/Returns/carrier read+write surface (list/search, fuzzy/memory, map/top-up/
 * sync/split/unmap, carrier.saveMemory, returns.list/candidates/match) moved OFF Zoho to the
 * Postgres-backed REST routes in `src/routes/v1/billing.routes.ts` (money still moves through CMP
 * via the servercrm /api/billing/cmp/* endpoints). What remains here is the ONE read that is still
 * a CMP lookup wrapped in Deluge — open invoices for a carrier during mapping. It reads CMP (not a
 * Zoho module) and will move to a servercrm CMP endpoint in a later pass.
 *
 * RBAC: billing is a PORTFOLIO role — `departments:['billing']`, no carrierParam (owner-scoping via
 * assertCarrierOwned would wrongly block billing agents).
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { carrierId } from './common.js';

const BILLING_DEPARTMENTS = ['billing'] as const;

export const billingDelugeTouchpoints: Touchpoint[] = [
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
];
