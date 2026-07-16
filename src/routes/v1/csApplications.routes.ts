/**
 * Customer Service Mytrion — Applications writes (/v1/cs/applications).
 *
 * Reads go through the `cs.applications.list` touchpoint; these routes carry the write
 * side the widget did client-side: the edit-modal save and the onboarding tick-boxes,
 * both with Edit_History append + Deal mirror (applicationsSave.ts) and audit logging.
 * Field casing is resolved server-side against live metadata — a wrong-cased write is a
 * 400 here, never Zoho's silent no-op.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  ONBOARDING_FIELDS,
  saveApplication,
} from '../../modules/customerService/applicationsSave.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireCsAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'customer-service', 'CS applications');
}

const idParam = z.object({ id: z.string().regex(/^\d+$/, 'id must be a CRM record id').max(60) });

const saveBody = z.object({
  changes: z
    .record(z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]))
    .refine((v) => Object.keys(v).length > 0, 'changes must not be empty'),
});

const onboardingBody = z.object({
  field: z.enum(ONBOARDING_FIELDS),
  value: z.boolean(),
});

export async function csApplicationsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  /** Edit-modal save: validated/allowlisted changes + Edit_History + Deal mirror. */
  app.post('/cs/applications/:id', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const body = saveBody.parse(request.body);
    try {
      const result = await saveApplication(ctx, id, body.changes);
      await auditFromContext(ctx, {
        action: 'cs.application.update',
        status: 'ok',
        resourceType: 'crm_application',
        resourceId: id,
        detail: {
          fields: result.updatedFields,
          dealId: result.dealId,
          dealSyncedFields: result.dealSyncedFields,
          ...(result.warning ? { warning: result.warning } : {}),
        },
      });
      return result;
    } catch (err) {
      await auditFromContext(ctx, {
        action: 'cs.application.update',
        status: 'error',
        resourceType: 'crm_application',
        resourceId: id,
        detail: { fields: Object.keys(body.changes) },
      });
      throw err;
    }
  });

  /** Single onboarding tick-box (optimistic toggle in the UI). */
  app.post('/cs/applications/:id/onboarding', guard, async (request) => {
    const ctx = requireCsAccess(request);
    const { id } = idParam.parse(request.params);
    const body = onboardingBody.parse(request.body);
    try {
      const result = await saveApplication(ctx, id, { [body.field]: body.value });
      await auditFromContext(ctx, {
        action: 'cs.application.onboarding_toggle',
        status: 'ok',
        resourceType: 'crm_application',
        resourceId: id,
        detail: { field: body.field, value: body.value, dealId: result.dealId },
      });
      return result;
    } catch (err) {
      await auditFromContext(ctx, {
        action: 'cs.application.onboarding_toggle',
        status: 'error',
        resourceType: 'crm_application',
        resourceId: id,
        detail: { field: body.field, value: body.value },
      });
      throw err;
    }
  });
}
