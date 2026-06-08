import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorMessage, NotFoundError } from '../../lib/errors.js';
import { runChatTurn, streamChatTurn, type ChatTurnOptions } from '../../modules/chat/chatService.js';
import { startSSE } from '../../modules/chat/streaming.js';
import { conversationRepo } from '../../repos/conversationRepo.js';
import { messageRepo } from '../../repos/messageRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const chatSchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  // --- Caller identity (from the Zoho widget) ---
  zoho_user_id: z.string().min(1).max(120).optional(),
  user_name: z.string().min(1).max(200).optional(),
  // --- RBAC scope: the caller's department(s). Accepts a single key or a list. ---
  department_scope: z.union([z.string(), z.array(z.string().max(60)).max(50)]).optional(),
  // Compatibility aliases (same effect as department_scope).
  departmentAccess: z.array(z.string().min(1).max(60)).max(50).optional(),
  allDepartments: z.boolean().optional(),
});

type ChatBody = z.infer<typeof chatSchema>;

function toArray(v?: string | string[]): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Stable conversation-owner id for a Zoho caller (namespaced to avoid collisions). */
function identityFrom(body: ChatBody): string | undefined {
  const id = body.zoho_user_id?.trim();
  if (id) return `zoho:${id}`;
  const name = body.user_name?.trim();
  if (name) return `zoho-name:${name}`;
  return undefined;
}

/**
 * Build the per-request context for a chat call: department RBAC from `department_scope`
 * (+ aliases/headers), and the conversation owner from `zoho_user_id` (fallback `user_name`).
 */
function chatContext(request: FastifyRequest, body: ChatBody): TenantContext {
  const departmentAccess = [...toArray(body.department_scope), ...(body.departmentAccess ?? [])];
  const accessBody: { departmentAccess: string[]; allDepartments?: boolean } = { departmentAccess };
  if (body.allDepartments !== undefined) accessBody.allDepartments = body.allDepartments;
  const ctx = withDepartmentAccess(requireContext(request), request, accessBody);
  const userId = identityFrom(body);
  return userId ? { ...ctx, userId } : ctx;
}

function optionsFrom(body: ChatBody): ChatTurnOptions {
  const opts: ChatTurnOptions = {};
  if (body.model) opts.model = body.model;
  const name = body.user_name?.trim();
  if (name) opts.userName = name;
  return opts;
}

/** Resolve the conversation-owner id for GET routes (query `?zohoUserId=`). */
function ownerContext(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  const q = request.query as { zohoUserId?: string };
  const id = q.zohoUserId?.trim();
  return id ? { ...ctx, userId: `zoho:${id}` } : ctx;
}

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.apiKeyAuth] };

  app.post('/chat', guard, async (request) => {
    const body = chatSchema.parse(request.body);
    return runChatTurn(body.conversationId, body.message, chatContext(request, body), optionsFrom(body));
  });

  app.post('/chat/stream', guard, async (request, reply) => {
    const body = chatSchema.parse(request.body);
    const ctx = chatContext(request, body);
    const sse = startSSE(reply);
    try {
      await streamChatTurn(body.conversationId, body.message, ctx, sse, optionsFrom(body));
    } catch (err) {
      sse.send('error', { message: errorMessage(err) });
    } finally {
      sse.close();
    }
  });

  app.get('/chat/conversations', guard, async (request) => {
    const conversations = await conversationRepo.listForUser(ownerContext(request));
    return { conversations };
  });

  app.get<{ Params: { id: string } }>(
    '/chat/conversations/:id/messages',
    guard,
    async (request) => {
      const ctx = ownerContext(request);
      const conversation = await conversationRepo.findOwned(ctx, request.params.id);
      if (!conversation) throw new NotFoundError('Conversation not found');
      const messages = await messageRepo.listByConversation(ctx, conversation.id, { limit: 200 });
      return { conversation, messages };
    },
  );
}
