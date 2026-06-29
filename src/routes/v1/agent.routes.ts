/**
 * DeepAgents orchestrator endpoint: POST /v1/agent/deep.
 * Flag-gated (FF_DEEP_AGENTS_ENABLED) and lazy-loaded so the LangChain/LangGraph stack is only
 * imported when the flag is on. Builds the same department-scoped TenantContext as /v1/chat, so the
 * orchestrator's RAG + tool-caller children enforce identical RBAC + audit.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { NotFoundError } from '../../lib/errors.js';
import { resolveAllDepartmentAccess } from '../../lib/department.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const stringOrList = z.union([z.string(), z.array(z.string().max(120)).max(50)]);
const scopeSchema = z.union([z.string(), z.array(z.string().max(60)).max(50)]);

const deepAgentSchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().min(1).max(100).optional(),
  // Caller identity (from the Zoho widget), same shape as /v1/chat.
  zoho_user_id: z.string().min(1).max(120).optional(),
  user_name: z.string().min(1).max(200).optional(),
  role: stringOrList.optional(),
  profile: stringOrList.optional(),
  department_scope: scopeSchema.optional(),
  allDepartments: z.boolean().optional(),
});

function toArray(v?: string | string[]): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export async function agentRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.apiKeyAuth] };

  app.post('/agent/deep', guard, async (request) => {
    if (!env.FF_DEEP_AGENTS_ENABLED) {
      throw new NotFoundError('DeepAgents endpoint is disabled (set FF_DEEP_AGENTS_ENABLED).');
    }
    const body = deepAgentSchema.parse(request.body);

    const departmentAccess = toArray(body.department_scope);
    const allDepartments = resolveAllDepartmentAccess({
      allDepartments: body.allDepartments,
      profile: body.profile,
      role: body.role,
    });
    const ctx = withDepartmentAccess(requireContext(request), request, { departmentAccess, allDepartments });
    const profiles = toArray(body.profile);
    if (profiles.length > 0) ctx.profiles = profiles;
    const callerRole = toArray(body.role).join(', ');
    if (callerRole) ctx.callerRole = callerRole;
    const userName = body.user_name?.trim();
    if (userName) ctx.userName = userName;

    // Lazy import: keeps the heavy LangChain/LangGraph deps out of cold start when the flag is off.
    const { runDeepAgent } = await import('../../modules/deepagents/service.js');
    return runDeepAgent(body.message, ctx, body.conversationId ? { conversationId: body.conversationId } : {});
  });
}
