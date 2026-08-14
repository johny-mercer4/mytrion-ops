/**
 * Automation-only first-run enqueue (`POST /v1/verification/cases/:id/first-run`).
 * Human Run/Approve/Reset stay on the case HTTP routes — this path is inbox sequencing.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { maybeAdvanceFirstRun } from '../../modules/verification/firstRunTrigger.js';
import { InboxWhitelistError } from '../../integrations/creditPlatformInboxWrites.js';
import { AppError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireVerificationWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'verification', 'Verification first-run');
}

const idParams = z.object({ id: z.string().min(1).max(80) });
const body = z.object({
  retry: z.boolean().optional(),
});

export async function verificationFirstRunRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.post<{ Params: { id: string } }>('/verification/cases/:id/first-run', guard, async (request) => {
    requireDepartment(request, 'verification', 'Verification first-run');
    const ctx = requireVerificationWrite(request);
    const { id } = idParams.parse(request.params);
    const parsed = body.parse(request.body ?? {});
    try {
      const result = await maybeAdvanceFirstRun(ctx, id, {
        wait: true,
        retry: Boolean(parsed.retry),
        agent: ctx.userName || ctx.userId || 'system',
      });
      await auditFromContext(ctx, {
        action: 'verification.case.first_run',
        status: result.status === 'error' ? 'error' : 'ok',
        resourceType: 'verification_case',
        resourceId: id,
        detail: {
          firstRunStatus: result.status,
          step: result.step,
          inboxId: result.inboxId,
          reason: result.reason,
        },
      });
      return result;
    } catch (err) {
      if (err instanceof InboxWhitelistError) {
        throw new AppError(err.message, {
          statusCode: 400,
          code: err.code,
          expose: true,
          details: { rejected: err.rejected },
        });
      }
      throw err;
    }
  });
}
