import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import { listActiveUsers, type CrmUser } from '../../integrations/zohoCrm.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { toPublicUser } from '../../modules/auth/authService.js';
import { hashPassword } from '../../modules/auth/password.js';
import { auditRepo } from '../../repos/auditRepo.js';
import { userRepo, type UpdateUserPatch } from '../../repos/userRepo.js';
import { ROLES, AUDIENCES } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

/** Lowercased, trimmed term list from a CSV env value. */
function terms(csv: string): string[] {
  return csv
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** True if `value` contains any of the terms (case-insensitive substring). */
function containsAny(value: string | null, list: string[]): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return list.some((t) => v.includes(t));
}

/**
 * True if a CRM user's profile OR role marks them as a sales agent. Substring match so a term like
 * "Sales Agent" catches the "Sales Agent" profile AND region roles ("Uzbekistan Sales Agent", …).
 */
function isSalesAgent(u: CrmUser): boolean {
  return (
    containsAny(u.profile, terms(env.SALES_AGENT_PROFILE_NAMES)) ||
    containsAny(u.role, terms(env.SALES_AGENT_ROLE_NAMES))
  );
}

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

const auditQuerySchema = z.object({
  /** Action PREFIX ('auth.' matches every auth event; exact names work too). */
  action: z.string().max(120).optional(),
  audience: z.enum(AUDIENCES).optional(),
  status: z.enum(['ok', 'denied', 'error']).optional(),
  user_id: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
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

  // Active Sales-profile CRM users for the admin "act as agent" picker. Gated on allDepartmentAccess
  // (real admins), NOT requireRole — every Zoho worker session carries internal role 'admin', so the
  // department-access flag is the true admin gate. `?all=1` bypasses the sales filter (still admin-only)
  // for when the exact live profile/role name is still unknown.
  app.get<{ Querystring: { all?: string } }>(
    '/admin/agents',
    { onRequest: [app.authenticate] },
    async (request) => {
      const ctx = requireContext(request);
      if (!ctx.allDepartmentAccess) {
        throw new RBACError('Admin (all-department) access required to list agents.');
      }
      const users = await listActiveUsers();
      const all = request.query.all === '1' || request.query.all === 'true';
      const agents = (all ? users : users.filter(isSalesAgent)).sort((a, b) =>
        (a.name ?? '').localeCompare(b.name ?? ''),
      );
      await auditFromContext(ctx, {
        action: 'admin.agents.list',
        status: 'ok',
        resourceType: 'crm_user',
        detail: { count: agents.length, all },
      });
      return { agents };
    },
  );

  // Audit trail for the Mytrion Admin: who (user/name/profile/role/company) did what, when.
  // Guard: session OR static API key (dev transport), then a role-admin check — same gate as
  // /carrier-users, so admin-profile workers and the trusted widget key pass, 'worker'
  // sessions and customer sessions are denied.
  app.get('/admin/audit', { onRequest: [app.sessionOrApiKey] }, async (request) => {
    const ctx = requireContext(request);
    if (ctx.role !== 'admin' && !ctx.bypassRbac) {
      throw new RBACError('Audit log requires admin access');
    }
    const q = auditQuerySchema.parse(request.query);
    const filter = {
      ...(q.action ? { action: q.action } : {}),
      ...(q.audience ? { audience: q.audience } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.user_id ? { userId: q.user_id } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
      ...(q.offset !== undefined ? { offset: q.offset } : {}),
    };
    const [entries, total] = await Promise.all([
      auditRepo.list(ctx, filter),
      auditRepo.count(ctx, filter),
    ]);
    // Drop tenantId from the wire DTO; everything else is display data for the admin.
    return {
      entries: entries.map(({ tenantId: _tenantId, ...rest }) => rest),
      total,
    };
  });
}
