/**
 * Carrier User Management (Mytrion Admin) — CRUD for carrier-company login accounts
 * (carrier_users). Admin-only: the static API_KEY (systemContext, role 'admin') and
 * admin-profile Zoho workers pass; 'worker'-role sessions and customer sessions are
 * denied. Every write is audited. Mutations also ship POST aliases (Zoho-proxy-safe),
 * matching the scope-risks convention.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { hashPassword } from '../../modules/auth/password.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  carrier_id: z.string().max(120).optional(),
});

const createSchema = z.object({
  carrier_id: z.union([z.string().min(1).max(120), z.number()]).transform(String),
  application_id: z.union([z.string().max(120), z.number()]).transform(String).optional(),
  login: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-zA-Z0-9._@-]+$/, 'letters, digits, and . _ @ - only'),
  password: z.string().min(8).max(200),
  agent_name: z.string().max(200).optional(),
  agent_zoho_user_id: z.string().max(120).optional(),
  profile: z.string().max(120).optional(),
});

const updateSchema = z
  .object({
    carrier_id: z.union([z.string().min(1).max(120), z.number()]).transform(String).optional(),
    application_id: z.union([z.string().max(120), z.number()]).transform(String).nullable().optional(),
    password: z.string().min(8).max(200).optional(),
    agent_name: z.string().max(200).nullable().optional(),
    agent_zoho_user_id: z.string().max(120).nullable().optional(),
    profile: z.string().max(120).nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

/** Admin gate: static API key (role 'admin') or an admin-profile worker session. */
function requireAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.role !== 'admin' && !ctx.bypassRbac) {
    throw new RBACError('Carrier user management requires admin access');
  }
  return ctx;
}

export async function carrierUsersRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/carrier-users', guard, async (request) => {
    const ctx = requireAdmin(request);
    const query = listQuerySchema.parse(request.query);
    return carrierUserRepo.list(ctx, {
      ...(query.limit !== undefined ? { limit: query.limit } : {}),
      ...(query.offset !== undefined ? { offset: query.offset } : {}),
      ...(query.carrier_id ? { carrierId: query.carrier_id } : {}),
    });
  });

  app.post('/carrier-users', guard, async (request, reply) => {
    const ctx = requireAdmin(request);
    const body = createSchema.parse(request.body);
    const user = await carrierUserRepo.create(ctx, {
      carrierId: body.carrier_id,
      applicationId: body.application_id,
      login: body.login,
      passwordHash: await hashPassword(body.password),
      agentName: body.agent_name,
      agentZohoUserId: body.agent_zoho_user_id,
      profile: body.profile,
    });
    await auditFromContext(ctx, {
      action: 'admin.carrier_user.create',
      status: 'ok',
      resourceType: 'carrier_user',
      resourceId: user.id,
      detail: { carrierId: user.carrierId, login: user.login },
    });
    return reply.code(201).send({ user });
  });

  /** Partial update — password reset, status toggle, re-assignment. */
  app.post('/carrier-users/:id', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const user = await carrierUserRepo.update(ctx, id, {
      ...(body.carrier_id !== undefined ? { carrierId: body.carrier_id } : {}),
      ...(body.application_id !== undefined ? { applicationId: body.application_id } : {}),
      ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {}),
      ...(body.agent_name !== undefined ? { agentName: body.agent_name } : {}),
      ...(body.agent_zoho_user_id !== undefined
        ? { agentZohoUserId: body.agent_zoho_user_id }
        : {}),
      ...(body.profile !== undefined ? { profile: body.profile } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
    });
    if (!user) throw new NotFoundError('Carrier user not found');
    await auditFromContext(ctx, {
      action: 'admin.carrier_user.update',
      status: 'ok',
      resourceType: 'carrier_user',
      resourceId: id,
      detail: {
        fields: Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined),
        // Never log the password itself; note that a reset happened.
        ...(body.password !== undefined ? { passwordReset: true } : {}),
      },
    });
    return { user };
  });

  const deleteHandler = async (request: FastifyRequest) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const removed = await carrierUserRepo.deleteById(ctx, id);
    if (!removed) throw new NotFoundError('Carrier user not found');
    await auditFromContext(ctx, {
      action: 'admin.carrier_user.delete',
      status: 'ok',
      resourceType: 'carrier_user',
      resourceId: id,
    });
    return { deleted: true, id };
  };
  app.delete('/carrier-users/:id', guard, deleteHandler);
  app.post('/carrier-users/:id/delete', guard, deleteHandler); // POST alias (proxy-safe)
}
