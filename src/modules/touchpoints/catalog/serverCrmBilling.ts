/**
 * Billing Mytrion servercrm DWH touchpoints — the `/api/billing/dwh/*` reads the widget makes
 * via ZOHO.CRM.HTTP.get (Data Center deals, Debtors, avg-days & carrier-type detail lookups).
 * The servercrm client injects the API key + base URL (same host as the /api/agent/dwh reads).
 *
 * RBAC: portfolio role — departments:['billing'], and deliberately NO carrierParam. avg-days /
 * carrier-type take a carrierId in the query, but it comes from a deal/transaction the billing
 * agent is already viewing across the whole book, so owner-scoping (assertCarrierOwned) must NOT
 * apply here (see billingDeluge.ts for the same rationale).
 */
import { z } from 'zod';
import type { Touchpoint } from '../types.js';
import { carrierId, ymdDate } from './common.js';

const BILLING_DEPARTMENTS = ['billing'] as const;

export const serverCrmBillingTouchpoints: Touchpoint[] = [
  {
    kind: 'servercrm',
    key: 'billing.datacenter.deals',
    title: 'Billing Data Center deals (DWH portfolio)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/dwh/deals',
    // `fresh=1` bypasses the servercrm cache (widget parity); otherwise no params.
    paramsSchema: z.object({ fresh: z.enum(['0', '1']).optional() }),
  },
  {
    kind: 'servercrm',
    key: 'billing.debtors.list',
    title: 'Debtors (DWH overdue-invoice roll-up)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/dwh/debtors',
    paramsSchema: z.object({ fresh: z.enum(['0', '1']).optional() }),
  },
  {
    kind: 'servercrm',
    key: 'billing.datacenter.avgDays',
    title: 'Average days-to-pay for a carrier',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/dwh/avg-payment-days',
    paramsSchema: z.object({ carrierId }),
  },
  {
    kind: 'servercrm',
    key: 'billing.carrier.type',
    title: 'Carrier billing type (LOC / Prepay / Deposit)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/dwh/carrier-type',
    paramsSchema: z.object({ carrierId }),
  },

  // ── Prepay (Phase 2) ────────────────────────────────────────────────────
  {
    kind: 'servercrm',
    key: 'billing.prepay.companies',
    title: 'Prepay companies (loaded vs payments over a range)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/dwh/prepay-companies',
    // `fresh=1` bypasses servercrm's 2-minute list cache (Refresh button).
    paramsSchema: z.object({ startDate: ymdDate, endDate: ymdDate, fresh: z.enum(['0', '1']).optional() }),
  },
  {
    kind: 'servercrm',
    key: 'billing.prepay.rmve',
    title: 'Live EFS RMVE for the visible page (batch, max 60)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/dwh/prepay-rmve',
    // carrierIds is a comma-joined list (widget parity); the upstream caps the batch.
    paramsSchema: z.object({
      carrierIds: z.string().max(2000),
      startDate: ymdDate,
      endDate: ymdDate,
      fresh: z.enum(['0', '1']).optional(),
    }),
  },
  {
    kind: 'servercrm',
    key: 'billing.prepay.ledger',
    title: 'Per-carrier daily reconciliation ledger (modal)',
    riskClass: 'read',
    departments: BILLING_DEPARTMENTS,
    method: 'GET',
    pathTemplate: '/api/billing/prepay-ledger',
    paramsSchema: z.object({ carrierId, startDate: ymdDate, endDate: ymdDate }),
  },
];
