import type { FastifyInstance } from 'fastify';
import { toolRegistry } from '../../modules/tools/index.js';
import { requireContext } from './helpers.js';

/** List the tools the authenticated user may call (filtered by audience + scopes + risk). */
export async function toolsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/tools', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    const tools = toolRegistry.listForContext(ctx).map((tool) => ({
      name: tool.name,
      description: tool.description,
      riskClass: tool.riskClass,
      requiredScopes: tool.requiredScopes,
      allowedAudiences: tool.allowedAudiences,
    }));
    return { tools };
  });
}
