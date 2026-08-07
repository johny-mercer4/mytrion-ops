/**
 * Carrier-scoped Deluge touchpoints — tracking, payments, billing forms, card actions,
 * CMP invoice search, maintenance tickets. Every entry is keyed on a carrier the caller
 * must own (carrierParam → assertCarrierOwned for non-admins).
 */
import { z } from 'zod';
import { fetchTruckingNumbers } from '../../../integrations/salesCrmActions.js';
import type { Touchpoint } from '../types.js';
import { carrierId, cardNumber, idString, SALES, shortText } from './common.js';

export const carrierDelugeTouchpoints: Touchpoint[] = [
  // Migrated off Zoho Deluge to a native Zoho-CRM call (kind: 'local'); carrierParam is retained so the
  // dispatcher's assertCarrierOwned still gates non-admins to their own DWH-owned book. Byte-compatible
  // with the old Deluge output.
  //
  // Sales-only on purpose: CS reaches the SAME `fetchTruckingNumbers` via a separate key,
  // `cs.carrier.trucking_number_request` (csDeluge.ts), with no `carrierParam` — CS agents look up
  // any carrier a client calls about, not "their own book", so the ownership gate below must not
  // apply to them. Widening THIS entry's departments to include customer-service was tried first
  // (QA 2026-08-07) and still 403'd every CS lookup, because carrierParam is unconditional here.
  {
    kind: 'local',
    key: 'carrier.trucking_number_request',
    title: 'Tracking numbers (FedEx card shipments)',
    riskClass: 'read',
    departments: SALES,
    carrierParam: 'carrierId',
    paramsSchema: z.object({ carrierId }),
    handler: (_ctx, params) => fetchTruckingNumbers(String(params.carrierId)),
  },
  {
    kind: 'deluge',
    key: 'carrier.check_payment',
    title: 'Payment / CMP invoice check',
    riskClass: 'read',
    departments: SALES,
    carrierParam: 'carrierId',
    functionNames: ['mytrionCheckPayment', 'mytrioncheckpayment'],
    unwrap: 'status',
    paramsSchema: z.object({ carrierId }),
  },
  {
    kind: 'deluge',
    key: 'carrier.billing_form_info',
    title: 'Billing form + verification notes',
    riskClass: 'read',
    departments: SALES,
    carrierParam: 'carrierId',
    // "not found" arrives as a plain string — a clean empty state, not an error.
    functionNames: ['mytrionfetchbillingforminfo', 'mytrionFetchBillingFormInfo'],
    unwrap: 'permissive',
    paramsSchema: z.object({ carrierId }),
  },
  {
    kind: 'deluge',
    key: 'cards.status',
    title: 'Card activate / deactivate (EFS)',
    riskClass: 'destructive',
    departments: SALES,
    carrierParam: 'carrierId',
    functionNames: ['mytrioncardstatus'],
    // Destructive EFS action — a failure payload must NOT read as success (widget parity).
    unwrap: 'cardAction',
    paramsSchema: z.object({
      carrierId,
      cardNumber,
      action: z.enum(['ACTIVATE', 'DEACTIVATE']),
    }),
  },
  {
    kind: 'deluge',
    key: 'cards.limits',
    title: 'Card limit increase / decrease (EFS)',
    riskClass: 'destructive',
    departments: SALES,
    carrierParam: 'carrierId',
    functionNames: ['mytrioncardlimits'],
    unwrap: 'cardAction',
    paramsSchema: z.object({
      carrierId,
      cardNumber,
      limitId: shortText(40),
      limitValue: idString,
      action: z.enum(['INCREASE', 'DECREASE']),
    }),
  },
  {
    kind: 'deluge',
    key: 'invoices.search',
    title: 'Live CMP invoice search',
    riskClass: 'read',
    departments: SALES,
    carrierParam: 'carrierId',
    functionNames: ['mytrionSearchInvoices', 'mytrionsearchinvoices'],
    unwrap: 'status',
    paramsSchema: z.object({ carrierId }),
  },
  /*
   * `maintenance.create` was REMOVED here — the last WRITE path in mytrion-ops that created a
   * maintenance case in Zoho instead of in our own `maintenance_cases` table.
   *
   * It called the `createmaintenance` Deluge, and `POST /v1/touchpoints/maintenance.create` executes
   * any catalog entry, so it stayed reachable by API callers and by agents even though no frontend
   * ever used it. Anything that did would have written a case Mytrion cannot see: reads all come from
   * Postgres now, and there is deliberately no sync back from Zoho. Cases are created through
   * `POST /cs/maintenance` (the Maintenance tab), which writes the table everything else reads.
   *
   * The Deluge function itself is untouched in Zoho, so the in-Zoho widgets that call it directly
   * (self-service create-panel, createticket*.html — via ZOHO.CRM.FUNCTIONS.execute, never through
   * this catalog) keep working exactly as before.
   */
];
