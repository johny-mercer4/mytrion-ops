/**
 * Admin management of payment_delete_grants — who besides an admin may hard-delete a manually-
 * entered payment_transactions row (today: Chase, the only rail with no automated feed). See
 * modules/billing/paymentDeleteAccess.ts for the check this list feeds, and billing.routes.ts's
 * DELETE /billing/transactions/:id for where it's enforced.
 */
import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { RBACError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { paymentDeleteGrantRepo } from '../../repos/paymentDeleteGrantRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const grantBody = z.object({
  zohoUserId: z.string().min(1).max(60),
  source: z.string().min(1).max(40).default('chase'),
});
const sourceQuery = z.object({ source: z.string().min(1).max(40).default('chase') });

export async function paymentDeleteGrantsRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /** True-admin gate (same convention as mytrionAccess.routes.ts) — granting this to someone else
   *  is an access-control action, not a billing-department one; a non-admin who HOLDS a grant must
   *  not be able to hand it to someone else. */
  function requireAdmin(request: Parameters<typeof requireContext>[0]): TenantContext {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      throw new RBACError('Admin (all-department) access required to manage delete grants.');
    }
    return ctx;
  }

  app.get('/billing/delete-grants', guard, async (request) => {
    requireAdmin(request);
    const { source } = sourceQuery.parse(request.query);
    const grants = await paymentDeleteGrantRepo.listBySource(source);
    return { grants };
  });

  app.post('/billing/delete-grants', guard, async (request) => {
    const ctx = requireAdmin(request);
    const b = grantBody.parse(request.body ?? {});
    const grant = await paymentDeleteGrantRepo.grant({
      zohoUserId: b.zohoUserId,
      source: b.source,
      grantedBy: ctx.userName ?? ctx.userId,
    });
    await auditFromContext(ctx, {
      action: 'billing.delete-grants.grant',
      status: 'ok',
      resourceType: 'payment_delete_grant',
      resourceId: String(grant.id),
      detail: { zohoUserId: b.zohoUserId, source: b.source },
    });
    return { status: 'success', grant };
  });

  app.delete('/billing/delete-grants', guard, async (request) => {
    const ctx = requireAdmin(request);
    const b = grantBody.parse(request.body ?? {});
    const revoked = await paymentDeleteGrantRepo.revoke(b.zohoUserId, b.source);
    if (!revoked) throw new ValidationError(`No grant found for ${b.zohoUserId} / ${b.source}`);
    await auditFromContext(ctx, {
      action: 'billing.delete-grants.revoke',
      status: 'ok',
      resourceType: 'payment_delete_grant',
      resourceId: `${b.zohoUserId}:${b.source}`,
      detail: { zohoUserId: b.zohoUserId, source: b.source },
    });
    return { status: 'success' };
  });
}
