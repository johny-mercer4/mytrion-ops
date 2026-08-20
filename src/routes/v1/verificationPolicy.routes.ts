/**
 * Verification underwriting POLICY — its own route plugin.
 *
 * Lifted out of `verificationFlow.routes.ts`, which was 631 lines against the house 600-line cap.
 * These two endpoints are the natural thing to move: they are desk CONFIGURATION rather than
 * per-case work, they are the only routes in that file gated on `admin` rather than the
 * verification department, and nothing else in it reads them.
 *
 * ADMIN-ONLY ON THE WRITE, and enforced as a `preHandler` so the check cannot be skipped by an early
 * return in the body: these factors price every approved limit, and `bankFirstTruckMin` /
 * `wexCardCutoff` decide how each case is routed at Phase 5.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { verificationPolicyRepo } from '../../repos/verificationReviewRepo.js';
import { resolveVerificationCaseOwner } from '../../modules/verification/verificationOwner.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'verification', 'Verification underwriting');
}
function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification underwriting');
}

const policyBody = z.object({
  strongFactor: z.coerce.number().min(0).max(10).nullable().optional(),
  moderateFactor: z.coerce.number().min(0).max(10).nullable().optional(),
  weakFactor: z.coerce.number().min(0).max(10).nullable().optional(),
  adbReviewThreshold: z.coerce.number().min(0).max(10_000_000).optional(),
  nsfReviewThreshold: z.coerce.number().int().min(0).max(1000).optional(),
  bankFirstTruckMin: z.coerce.number().int().min(1).max(10_000).optional(),
  wexCardCutoff: z.coerce.number().int().min(1).max(10_000).optional(),
});

/** numeric columns take text; null stays null so a factor can be UNSET, not zeroed. */
const numText = (v: number | null | undefined): string | null | undefined =>
  v === undefined ? undefined : v === null ? null : String(v);

export async function verificationPolicyRoutes(app: FastifyInstance): Promise<void> {
  const auth = { onRequest: [app.authenticate] };

  // ---- policy ----

  /**
   * Underwriting policy, plus WHO the Verification agent is.
   *
   * The owner rides along here because this is the one call both desk surfaces already make — the
   * queue and the case view each load it, cached for an hour — and because there is nothing
   * per-case to project: no `decided_by`, no case-event actor, `distribute_type: 'shared'`. One
   * configured agent owns every case, so it is desk config, not row data.
   */
  app.get('/verification/flow/policy', auth, async (request) => {
    const ctx = requireVerificationRead(request);
    const [policy, verificationOwner] = await Promise.all([
      verificationPolicyRepo.get(ctx),
      resolveVerificationCaseOwner(),
    ]);
    return { ...policy, verificationOwner };
  });

  app.post(
    '/verification/flow/policy',
    // Underwriting policy sets the risk factors that price every limit, so it is admin-only —
    // deliberately narrower than the rest of the desk, and enforced as a preHandler so the check
    // cannot be skipped by an early return in the body.
    { onRequest: [app.authenticate], preHandler: [app.requireRole('admin')] },
    async (request) => {
      const ctx = requireVerificationWrite(request);
      const body = policyBody.parse(request.body ?? {});
      const updated = await verificationPolicyRepo.update(
        ctx,
        {
          ...(body.strongFactor === undefined ? {} : { strongFactor: numText(body.strongFactor) }),
          ...(body.moderateFactor === undefined
            ? {}
            : { moderateFactor: numText(body.moderateFactor) }),
          ...(body.weakFactor === undefined ? {} : { weakFactor: numText(body.weakFactor) }),
          ...(body.adbReviewThreshold === undefined
            ? {}
            : { adbReviewThreshold: String(body.adbReviewThreshold) }),
          ...(body.nsfReviewThreshold === undefined
            ? {}
            : { nsfReviewThreshold: body.nsfReviewThreshold }),
          ...(body.bankFirstTruckMin === undefined
            ? {}
            : { bankFirstTruckMin: body.bankFirstTruckMin }),
          ...(body.wexCardCutoff === undefined ? {} : { wexCardCutoff: body.wexCardCutoff }),
        },
        ctx.userId,
      );
      await auditFromContext(ctx, {
        action: 'verification.flow.policy_updated',
        status: 'ok',
        resourceType: 'verification_policy',
        resourceId: ctx.tenantId,
        detail: { fields: Object.keys(body) },
      });
      return updated;
    },
  );
}
