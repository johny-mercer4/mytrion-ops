import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { errorMessage, NotFoundError } from '../../lib/errors.js';
import { runChatTurn, streamChatTurn, type ChatTurnOptions } from '../../modules/chat/chatService.js';
import { startSSE } from '../../modules/chat/streaming.js';
import { conversationRepo } from '../../repos/conversationRepo.js';
import { messageRepo } from '../../repos/messageRepo.js';
import type { Conversation, Message } from '../../db/schema/index.js';
import { sseCorsHeaders } from '../../lib/cors.js';
import { resolveAllDepartmentAccess } from '../../lib/department.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const stringOrList = z.union([z.string(), z.array(z.string().max(120)).max(50)]);
const scopeSchema = z.union([z.string(), z.array(z.string().max(60)).max(50)]);

const chatSchema = z.object({
  message: z.string().min(1).max(8000),
  conversationId: z.string().min(1).max(100).optional(),
  model: z.string().min(1).max(100).optional(),
  // --- Caller identity (from the Zoho widget) ---
  zoho_user_id: z.string().min(1).max(120).optional(),
  user_name: z.string().min(1).max(200).optional(),
  // Caller's Zoho role + profile. An "Administrator" profile bypasses ALL RBAC (RAG + tools).
  role: stringOrList.optional(),
  profile: stringOrList.optional(),
  // --- RBAC scope: the caller's department(s). Accepts a single key or a list. ---
  department_scope: scopeSchema.optional(),
  // Compatibility aliases (same effect as department_scope).
  departmentAccess: z.array(z.string().min(1).max(60)).max(50).optional(),
  allDepartments: z.boolean().optional(),
});

type ChatBody = z.infer<typeof chatSchema>;

const createConversationSchema = z.object({
  zoho_user_id: z.string().min(1).max(120).optional(),
  user_name: z.string().min(1).max(200).optional(),
  profile: stringOrList.optional(),
  role: stringOrList.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  department_scope: scopeSchema.optional(),
});

const updateConversationSchema = z
  .object({
    // Owner scoping (optional): when present, only the owner's conversation is updated.
    zoho_user_id: z.string().min(1).max(120).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    department_scope: scopeSchema.optional(),
  })
  .refine((p) => p.title !== undefined || p.department_scope !== undefined, {
    message: 'Provide at least one field to update (title, department_scope).',
  });

const listQuerySchema = z.object({
  zoho_user_id: z.string().min(1).max(120).optional(),
  zohoUserId: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/** Optional owner scoping for the by-id GET route (query) and delete route (body). */
const idScopeQuerySchema = z.object({
  zoho_user_id: z.string().min(1).max(120).optional(),
  zohoUserId: z.string().min(1).max(120).optional(),
});
const deleteBodySchema = z.object({ zoho_user_id: z.string().min(1).max(120).optional() });

function toArray(v?: string | string[]): string[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

/** Stable conversation-owner id for a Zoho caller (namespaced to avoid collisions). */
function identityFrom(zohoUserId?: string, userName?: string): string | undefined {
  const id = zohoUserId?.trim();
  if (id) return `zoho:${id}`;
  const name = userName?.trim();
  if (name) return `zoho-name:${name}`;
  return undefined;
}

/** Owner-scoped context (userId = `zoho:<id>`) so list/create attach to that user's chats. */
function ownerCtx(ctx: TenantContext, zohoUserId?: string, userName?: string): TenantContext {
  const userId = identityFrom(zohoUserId, userName);
  return userId ? { ...ctx, userId } : ctx;
}

/**
 * Build the per-request context for a chat call: department RBAC from `department_scope`
 * (+ aliases/headers), and the conversation owner from `zoho_user_id` (fallback `user_name`).
 */
function chatContext(request: FastifyRequest, body: ChatBody): TenantContext {
  const departmentAccess = [...toArray(body.department_scope), ...(body.departmentAccess ?? [])];
  // Admin profile/role (or explicit allDepartments) bypasses RBAC for BOTH RAG and tools —
  // Developers/Managers/Admins per ADMIN_PROFILE_MARKERS (matched on profile AND role).
  const allDepartments = resolveAllDepartmentAccess({
    allDepartments: body.allDepartments,
    profile: body.profile,
    role: body.role,
  });
  const ctx = withDepartmentAccess(requireContext(request), request, { departmentAccess, allDepartments });
  const merged = ownerCtx(ctx, body.zoho_user_id, body.user_name);
  const profiles = toArray(body.profile);
  const callerRole = toArray(body.role).join(', ');
  if (profiles.length > 0) merged.profiles = profiles;
  if (callerRole) merged.callerRole = callerRole;
  const userName = body.user_name?.trim();
  if (userName) merged.userName = userName;
  return merged;
}

function optionsFrom(body: ChatBody): ChatTurnOptions {
  const opts: ChatTurnOptions = {};
  if (body.model) opts.model = body.model;
  const name = body.user_name?.trim();
  if (name) opts.userName = name;
  const zohoUserId = body.zoho_user_id?.trim();
  if (zohoUserId) opts.zohoUserId = zohoUserId;
  const profile = toArray(body.profile).join(', ');
  if (profile) opts.profile = profile;
  const role = toArray(body.role).join(', ');
  if (role) opts.role = role;
  if (body.department_scope !== undefined) opts.departmentScope = body.department_scope;
  return opts;
}

// --- DTO mappers (flat; drop internal fields; ISO 8601 timestamps) ---

function conversationDto(c: Conversation) {
  return {
    id: c.id,
    zohoUserId: c.zohoUserId,
    userName: c.userName,
    profile: c.profile,
    role: c.role,
    title: c.title,
    departmentScope: c.departmentScope ?? null,
    messageCount: c.messageCount,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
  };
}

function conversationListItem(c: Conversation) {
  return {
    id: c.id,
    title: c.title,
    messageCount: c.messageCount,
    departmentScope: c.departmentScope ?? null,
    createdAt: c.createdAt.toISOString(),
    lastMessageAt: c.lastMessageAt.toISOString(),
  };
}

function messageDto(m: Message) {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ragPassages: m.ragPassages ?? null,
    tools: m.tools ?? [],
    error: m.error ?? null,
    createdAt: m.createdAt.toISOString(),
  };
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
    const sse = startSSE(reply, sseCorsHeaders(request.headers.origin));
    try {
      await streamChatTurn(body.conversationId, body.message, ctx, sse, optionsFrom(body));
    } catch (err) {
      sse.send('error', { message: errorMessage(err) });
    } finally {
      sse.close();
    }
  });

  // Create a new (possibly empty) conversation up front.
  app.post('/chat/conversations', guard, async (request, reply) => {
    const body = createConversationSchema.parse(request.body);
    const ctx = ownerCtx(requireContext(request), body.zoho_user_id, body.user_name);
    const created = await conversationRepo.create(ctx, {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.zoho_user_id !== undefined ? { zohoUserId: body.zoho_user_id } : {}),
      ...(body.user_name !== undefined ? { userName: body.user_name } : {}),
      ...(toArray(body.profile).length > 0 ? { profile: toArray(body.profile).join(', ') } : {}),
      ...(toArray(body.role).length > 0 ? { role: toArray(body.role).join(', ') } : {}),
      ...(body.department_scope !== undefined ? { departmentScope: body.department_scope } : {}),
    });
    void reply.code(201);
    return { conversation: conversationDto(created) };
  });

  // List a user's conversations (most-recent first) + total.
  app.get('/chat/conversations', guard, async (request) => {
    const q = listQuerySchema.parse(request.query);
    const ctx = ownerCtx(requireContext(request), q.zoho_user_id ?? q.zohoUserId);
    const page = { limit: q.limit ?? 30, offset: q.offset ?? 0 };
    const [rows, total] = await Promise.all([
      conversationRepo.listForUser(ctx, page),
      conversationRepo.countForUser(ctx),
    ]);
    return { conversations: rows.map(conversationListItem), total };
  });

  // Fetch one conversation + its clean transcript (chronological).
  // Owner-scoped when zoho_user_id is supplied (the widget always has it) so a caller can't read
  // another user's chat by id; tenant-scoped fallback only when no owner is given (admin).
  app.get<{ Params: { id: string } }>('/chat/conversations/:id', guard, async (request) => {
    const q = idScopeQuerySchema.parse(request.query);
    const zid = q.zoho_user_id ?? q.zohoUserId;
    const ctx = ownerCtx(requireContext(request), zid);
    const conversation = zid
      ? await conversationRepo.findOwned(ctx, request.params.id)
      : await conversationRepo.findById(ctx, request.params.id);
    if (!conversation) throw new NotFoundError('Conversation not found');
    const messages = await messageRepo.listTranscript(ctx, conversation.id);
    return { conversation: conversationDto(conversation), messages: messages.map(messageDto) };
  });

  // Rename / update (owner-scoped when zoho_user_id is supplied).
  app.post<{ Params: { id: string } }>('/chat/conversations/:id', guard, async (request) => {
    const body = updateConversationSchema.parse(request.body);
    const ctx = ownerCtx(requireContext(request), body.zoho_user_id);
    const patch = {
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.department_scope !== undefined ? { departmentScope: body.department_scope } : {}),
    };
    const updated = body.zoho_user_id
      ? await conversationRepo.updateOwned(ctx, request.params.id, patch)
      : await conversationRepo.update(ctx, request.params.id, patch);
    if (!updated) throw new NotFoundError('Conversation not found');
    return { conversation: conversationDto(updated) };
  });

  // Delete (POST alias) — cascades to messages (owner-scoped when zoho_user_id is supplied).
  app.post<{ Params: { id: string } }>(
    '/chat/conversations/:id/delete',
    guard,
    async (request: FastifyRequest<{ Params: { id: string } }>) => {
      const body = deleteBodySchema.parse(request.body ?? {});
      const ctx = ownerCtx(requireContext(request), body.zoho_user_id);
      const deleted = body.zoho_user_id
        ? await conversationRepo.deleteByIdOwned(ctx, request.params.id)
        : await conversationRepo.deleteById(ctx, request.params.id);
      if (!deleted) throw new NotFoundError('Conversation not found');
      return { deleted: true, id: request.params.id };
    },
  );
}
