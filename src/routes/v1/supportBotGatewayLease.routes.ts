import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { supportBotGatewayLeaseRepo } from '../../repos/supportBotGatewayLeaseRepo.js';
import { requireContext } from './helpers.js';

const identity = z.string().trim().min(1).max(200);
const scopeSchema = z.object({ botIdentity: identity, holderId: identity });

/** Coordinates exactly one long-poll consumer while allowing warm standby replicas. */
export async function supportBotGatewayLeaseRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.supportBotGatewayAuth] };

  app.post('/support-bot/gateway-lease/acquire', guard, async (request) => {
    const body = scopeSchema.extend({ ttlSeconds: z.number().int().min(15).max(120) })
      .parse(request.body);
    const ctx = requireContext(request);
    const result = await supportBotGatewayLeaseRepo.acquire(ctx, body);
    if (result.acquired && result.changedHolder) {
      await auditFromContext(ctx, {
        action: 'support_bot.gateway_lease.acquire',
        status: 'ok',
        resourceType: 'support_bot_gateway_lease',
        resourceId: result.lease.id,
        detail: {
          botIdentity: result.lease.botIdentity,
          holderId: result.lease.holderId,
          fencingToken: result.lease.fencingToken,
        },
      });
    }
    return {
      acquired: result.acquired,
      fencingToken: result.lease.fencingToken,
      expiresAt: result.lease.expiresAt,
    };
  });

  app.post('/support-bot/gateway-lease/release', guard, async (request) => {
    const body = scopeSchema.extend({ fencingToken: z.number().int().positive() })
      .parse(request.body);
    const ctx = requireContext(request);
    const released = await supportBotGatewayLeaseRepo.release(ctx, body);
    if (released) {
      await auditFromContext(ctx, {
        action: 'support_bot.gateway_lease.release',
        status: 'ok',
        resourceType: 'support_bot_gateway_lease',
        resourceId: `${body.botIdentity}:${body.fencingToken}`,
        detail: body,
      });
    }
    return { released };
  });
}
