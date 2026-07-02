/**
 * Multi-agent orchestrator endpoint: POST /v1/agent (stream + non-stream) with optional
 * direct-to-child mode (`agent: <key>`), plus POST /v1/agent/deep as a deprecated alias.
 * Flag-gated (FF_ORCHESTRATOR_ENABLED, or the legacy FF_DEEP_AGENTS_ENABLED) and lazy-loaded so
 * the LangChain/LangGraph stack stays out of cold start when off. Identity/RBAC context comes
 * from the same callerIdentity builders as /v1/chat, so RAG + tools enforce identical policy.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { sseCorsHeaders } from '../../lib/cors.js';
import { errorMessage, NotFoundError } from '../../lib/errors.js';
import { AGENT_KEYS } from '../../modules/agents/types.js';
import { startSSE } from '../../modules/chat/streaming.js';
import { buildCallerContext, callerIdentitySchema, toArray } from './callerIdentity.js';

const agentTurnSchema = callerIdentitySchema.extend({
  message: z.string().min(1).max(8000),
  conversationId: z.string().min(1).max(100).optional(),
  /** Direct-to-child mode: run exactly this department agent (RBAC-checked server-side). */
  agent: z.enum(AGENT_KEYS).optional(),
  stream: z.boolean().optional(),
});

type AgentTurnBody = z.infer<typeof agentTurnSchema>;

function turnOptions(body: AgentTurnBody) {
  const userName = body.user_name?.trim();
  const profile = toArray(body.profile).join(', ');
  const role = toArray(body.role).join(', ');
  return {
    ...(body.conversationId ? { conversationId: body.conversationId } : {}),
    ...(body.agent ? { agent: body.agent } : {}),
    ...(userName ? { userName } : {}),
    ...(body.zoho_user_id ? { zohoUserId: body.zoho_user_id } : {}),
    ...(profile ? { profile } : {}),
    ...(role ? { role } : {}),
    ...(body.department_scope !== undefined ? { departmentScope: body.department_scope } : {}),
  };
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.apiKeyAuth] };

  const enabled = (): boolean => env.FF_ORCHESTRATOR_ENABLED || env.FF_DEEP_AGENTS_ENABLED;

  app.post('/agent', guard, async (request, reply) => {
    if (!enabled()) {
      throw new NotFoundError('Agent endpoint is disabled (set FF_ORCHESTRATOR_ENABLED).');
    }
    const body = agentTurnSchema.parse(request.body);
    const ctx = buildCallerContext(request, body);
    // Lazy import: keeps the heavy LangChain/LangGraph deps out of cold start when the flag is off.
    const service = await import('../../modules/agents/orchestratorService.js');

    if (body.stream) {
      const sse = startSSE(reply, sseCorsHeaders(request.headers.origin));
      try {
        await service.streamAgentTurn(body.message, ctx, sse, turnOptions(body));
      } catch (err) {
        sse.send('error', { message: errorMessage(err) });
      } finally {
        sse.close();
      }
      return reply;
    }
    return service.runAgentTurn(body.message, ctx, turnOptions(body));
  });

  // Deprecated alias (old DeepAgents endpoint): same handler, old response shape preserved
  // by returning { answer } derived from the new result.
  app.post('/agent/deep', guard, async (request) => {
    if (!enabled()) {
      throw new NotFoundError('DeepAgents endpoint is disabled (set FF_ORCHESTRATOR_ENABLED).');
    }
    const body = agentTurnSchema.parse(request.body);
    const ctx = buildCallerContext(request, body);
    const service = await import('../../modules/agents/orchestratorService.js');
    const result = await service.runAgentTurn(body.message, ctx, turnOptions(body));
    return { answer: result.message, conversationId: result.conversationId };
  });
}
