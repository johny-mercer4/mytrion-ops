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
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { resolveWritePayload } from '../../modules/customerService/fieldResolver.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireBillingAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'billing', 'Billing');
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

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

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
}
