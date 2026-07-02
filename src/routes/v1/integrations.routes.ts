/**
 * Composio connection management (admin): inspect and connect the shared org account's toolkits.
 *   GET  /v1/integrations/composio/status            → connected toolkits + status
 *   POST /v1/integrations/composio/authorize {toolkit} → Connect Link (redirectUrl) to OAuth it
 * Flag-gated (FF_COMPOSIO_ENABLED) + admin-only, and the Composio SDK is lazy-imported so it never
 * loads at boot when the flag is off.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { requireContext } from './helpers.js';

const authorizeSchema = z.object({
  toolkit: z.string().min(1).max(60),
});

export async function integrationsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  function requireAdmin(request: Parameters<typeof requireContext>[0]): void {
    if (!env.FF_COMPOSIO_ENABLED) {
      throw new NotFoundError('Composio integration is disabled (set FF_COMPOSIO_ENABLED).');
    }
    if (requireContext(request).role !== 'admin') {
      throw new RBACError('Managing Composio connections requires the admin role.');
    }
  }

  app.get('/integrations/composio/status', guard, async (request) => {
    requireAdmin(request);
    const { listConnections, COMPOSIO_TOOLKITS, COMPOSIO_ORG_USER } = await import(
      '../../integrations/composio.js'
    );
    const connections = await listConnections();
    return { orgUser: COMPOSIO_ORG_USER, toolkits: COMPOSIO_TOOLKITS, connections };
  });

  app.post('/integrations/composio/authorize', guard, async (request) => {
    requireAdmin(request);
    const body = authorizeSchema.parse(request.body);
    const { authorizeToolkit } = await import('../../integrations/composio.js');
    const { redirectUrl, id } = await authorizeToolkit(body.toolkit.toUpperCase());
    return { toolkit: body.toolkit.toUpperCase(), connectedAccountId: id, redirectUrl };
  });
}
