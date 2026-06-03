import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { toPublicUser } from '../../modules/auth/authService.js';
import { hashPassword } from '../../modules/auth/password.js';
import { auditRepo } from '../../repos/auditRepo.js';
import { userRepo, type UpdateUserPatch } from '../../repos/userRepo.js';
import { ROLES, AUDIENCES } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  fullName: z.string().max(200).optional(),
  role: z.enum(ROLES),
  audience: z.enum(AUDIENCES),
  tenantId: z.string().min(1).max(100).optional(),
});

const updateUserSchema = z.object({
  fullName: z.string().max(200).nullable().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const adminOnly: RouteShorthandOptions = {
    onRequest: [app.authenticate],
    preHandler: [app.requireRole('admin')],
  };

  app.get('/admin/users', adminOnly, async (request) => {
    const ctx = requireContext(request);
    const users = await userRepo.listByTenant(ctx);
    return { users: users.map(toPublicUser) };
  });

  app.post('/admin/users', adminOnly, async (request) => {
    const ctx = requireContext(request);
    const body = createUserSchema.parse(request.body);
    const passwordHash = await hashPassword(body.password);
    const user = await userRepo.create({
      tenantId: body.tenantId ?? ctx.tenantId,
      email: body.email,
      passwordHash,
      role: body.role,
      audience: body.audience,
      ...(body.fullName !== undefined ? { fullName: body.fullName } : {}),
    });
    await auditFromContext(ctx, {
      action: 'admin.user.create',
      status: 'ok',
      resourceType: 'user',
      resourceId: user.id,
    });
    return { user: toPublicUser(user) };
  });

  app.patch<{ Params: { id: string } }>('/admin/users/:id', adminOnly, async (request) => {
    const ctx = requireContext(request);
    const parsed = updateUserSchema.parse(request.body);
    const patch: UpdateUserPatch = {};
    if (parsed.fullName !== undefined) patch.fullName = parsed.fullName;
    if (parsed.role !== undefined) patch.role = parsed.role;
    if (parsed.status !== undefined) patch.status = parsed.status;
    const user = await userRepo.update(ctx, request.params.id, patch);
    if (!user) throw new NotFoundError('User not found');
    await auditFromContext(ctx, {
      action: 'admin.user.update',
      status: 'ok',
      resourceType: 'user',
      resourceId: user.id,
    });
    return { user: toPublicUser(user) };
  });

  app.get<{ Querystring: { action?: string; limit?: string } }>(
    '/admin/audit',
    adminOnly,
    async (request) => {
      const ctx = requireContext(request);
      const limit = request.query.limit ? Number(request.query.limit) : undefined;
      const entries = await auditRepo.list(ctx, {
        ...(request.query.action ? { action: request.query.action } : {}),
        ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      });
      return { entries };
    },
  );
}
