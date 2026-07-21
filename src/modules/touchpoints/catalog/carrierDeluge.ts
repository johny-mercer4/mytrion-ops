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
  // dispatcher's assertCarrierOwned still gates non-admins. Byte-compatible with the old Deluge output.
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
  {
    kind: 'deluge',
    key: 'maintenance.create',
    title: 'Maintenance ticket (mechanical / tire)',
    riskClass: 'write',
    departments: SALES,
    carrierParam: 'carrierId',
    functionNames: ['createmaintenance'],
    unwrap: 'permissive',
    paramsSchema: z.object({
      companyName: shortText(300),
      companyId: idString,
      number: shortText(40),
      type: z.enum(['Mechanical', 'Tire Replacement']),
      carrierId,
    }),
  },
];
