/**
 * Sales "Verification Pipeline" tab (/v1/verification) — the agent's deal-clients (DWH, freshest
 * application date first) + a per-client compliance-pipeline snapshot.
 *
 * Session-authoritative + owner-scoped exactly like /v1/data-center: a non-admin sees only their
 * own deals; an admin (or act-as) may pass ?zoho_user_id and we resolve that target's display name
 * so the DWH name-fallback arm fires. Reads only. The pipeline snapshot comes from the provider
 * (mock this phase) — this route never touches the credit_platform verification DB.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../lib/errors.js';
import { getAgentVerificationClients } from '../../modules/verificationPipeline/service.js';
import { getPipelineProvider } from '../../modules/verificationPipeline/provider.js';
import { resolveActAsTarget } from '../../modules/auth/actAsDirectory.js';
import { resolveZohoUserId } from '../../modules/tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'Verification Pipeline');
}

function dwhError(err: unknown): AppError {
  return new AppError('Data warehouse request failed', {
    statusCode: 502,
    code: 'DWH_ERROR',
    cause: err,
    expose: true,
  });
}

const scopeQuery = z.object({ zoho_user_id: z.string().max(120).optional() });
const pipelineQuery = z.object({
  dealId: z.string().max(64).optional(),
  carrierId: z.string().max(64).optional(),
  applicationId: z.string().max(64).optional(),
  dot: z.string().max(64).optional(),
});

export async function verificationPipelineRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  // The caller's deal-clients, freshest application date first, classified + enriched (DWH).
  app.get('/verification/clients', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    const q = scopeQuery.parse(request.query);
    const ownerId = resolveZohoUserId(ctx, q.zoho_user_id);
    const targetingOther = ctx.allDepartmentAccess && Boolean(q.zoho_user_id?.trim());
    // Supply the TARGET's name (admin View-as) so the DWH name-fallback arm can fire — matches
    // /data-center/clients; the id-suffix arm alone misses agents not aligned to the warehouse id.
    const ownerName = targetingOther
      ? (await resolveActAsTarget(q.zoho_user_id!.trim()))?.name?.trim() || undefined
      : ctx.userName?.trim() || undefined;
    try {
      const clients = await getAgentVerificationClients(ownerId, ownerName);
      return { clients };
    } catch (err) {
      throw dwhError(err);
    }
  });

  // One client's 9-stage compliance pipeline + decision. Provider is mock this phase (no CP query).
  app.get('/verification/pipeline', guard, async (request) => {
    requireSalesAccess(request);
    const q = pipelineQuery.parse(request.query);
    const snapshot = await getPipelineProvider().getPipeline({
      dealId: q.dealId ?? null,
      carrierId: q.carrierId ?? null,
      applicationId: q.applicationId ?? null,
      dot: q.dot ?? null,
    });
    return { snapshot };
  });
}
