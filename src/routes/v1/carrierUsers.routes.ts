/**
 * Carrier User Management (Mytrion Admin) — CRUD for carrier-company login accounts
 * (carrier_users). Admin-only: the static API_KEY (systemContext, role 'admin') and
 * admin-profile Zoho workers pass; 'worker'-role sessions and customer sessions are
 * denied. Every write is audited. Mutations also ship POST aliases (Zoho-proxy-safe),
 * matching the scope-risks convention.
 *
 * Profile model: 'owner' (fleet) is tied to carrier_id OR application_id — an account can
 * be provisioned on the application id alone (login/password/profile/unique key) before
 * the carrier exists; POST /carrier-users/populate-carrier back-fills the carrier id for
 * everything under that application later. 'driver' is a child of an owner (parent_user_id
 * required, must be an ACTIVE owner) tied to one card_id — assignable at creation or later.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ConflictError, NotFoundError, RBACError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { hashPassword } from '../../modules/auth/password.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const idString = z.union([z.string().max(120), z.number()]).transform(String);

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  carrier_id: z.string().max(120).optional(),
  profile: z.enum(['owner', 'driver']).optional(),
});

const createSchema = z
  .object({
    profile: z.enum(['owner', 'driver']).default('owner'),
    carrier_id: idString.optional(),
    application_id: idString.optional(),
    parent_user_id: z.string().max(120).optional(),
    card_id: idString.optional(),
    login: z
      .string()
      .min(3)
      .max(120)
      .regex(/^[a-zA-Z0-9._@-]+$/, 'letters, digits, and . _ @ - only'),
    password: z.string().min(8).max(200),
    agent_name: z.string().max(200).optional(),
    agent_zoho_user_id: z.string().max(120).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.profile === 'owner') {
      // Application-only provisioning is fine ("unique key which is application") — but the
      // account must be tied to SOMETHING; the carrier id can be populated later.
      if (!v.carrier_id?.trim() && !v.application_id?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['carrier_id'],
          message: 'An owner needs a carrier_id or an application_id (the unique key)',
        });
      }
      if (v.parent_user_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['parent_user_id'],
          message: 'Owners have no parent — parent_user_id is for drivers',
        });
      }
    } else if (!v.parent_user_id?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['parent_user_id'],
        message: 'A driver must belong to an owner (parent_user_id)',
      });
    }
  });

const updateSchema = z
  .object({
    carrier_id: idString.nullable().optional(),
    application_id: idString.nullable().optional(),
    card_id: idString.nullable().optional(),
    password: z.string().min(8).max(200).optional(),
    agent_name: z.string().max(200).nullable().optional(),
    agent_zoho_user_id: z.string().max(120).nullable().optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update',
  });

const populateCarrierSchema = z.object({
  application_id: idString,
  carrier_id: idString,
});

/** Admin gate: static API key (role 'admin') or an admin-profile worker session. */
function requireAdmin(request: FastifyRequest): TenantContext {
  const ctx = requireContext(request);
  if (ctx.role !== 'admin' && !ctx.bypassRbac) {
    throw new RBACError('Carrier user management requires admin access');
  }
  return ctx;
}

/** A driver's parent must exist, be an OWNER, and be active. */
async function assertValidParent(ctx: TenantContext, parentUserId: string): Promise<void> {
  const parent = await carrierUserRepo.findById(ctx, parentUserId);
  if (!parent) throw new NotFoundError(`Parent owner '${parentUserId}' not found`);
  if (parent.profile !== 'owner') {
    throw new AppError('A driver must belong to an OWNER account', {
      statusCode: 400,
      code: 'INVALID_PARENT',
      expose: true,
    });
  }
  if (parent.status !== 'active') {
    throw new AppError('The parent owner account is disabled', {
      statusCode: 400,
      code: 'INVALID_PARENT',
      expose: true,
    });
  }
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
      ...(query.profile ? { profile: query.profile } : {}),
    });
  });

  app.post('/carrier-users', guard, async (request, reply) => {
    const ctx = requireAdmin(request);
    const body = createSchema.parse(request.body);
    if (body.profile === 'driver' && body.parent_user_id) {
      await assertValidParent(ctx, body.parent_user_id.trim());
    }
    const user = await carrierUserRepo.create(ctx, {
      profile: body.profile,
      carrierId: body.carrier_id,
      applicationId: body.application_id,
      parentUserId: body.parent_user_id,
      cardId: body.card_id,
      login: body.login,
      passwordHash: await hashPassword(body.password),
      agentName: body.agent_name,
      agentZohoUserId: body.agent_zoho_user_id,
    });
    await auditFromContext(ctx, {
      action: 'admin.carrier_user.create',
      status: 'ok',
      resourceType: 'carrier_user',
      resourceId: user.id,
      detail: {
        profile: user.profile,
        login: user.login,
        ...(user.carrierId ? { carrierId: user.carrierId } : {}),
        ...(user.applicationId ? { applicationId: user.applicationId } : {}),
        ...(user.parentUserId ? { parentUserId: user.parentUserId } : {}),
        ...(user.cardId ? { cardId: user.cardId } : {}),
      },
    });
    return reply.code(201).send({ user });
  });

  /**
   * Back-fill the carrier id for everything provisioned under an application id — the
   * "populate later, automatically" hook (admin action today; a conversion automation or
   * webhook can call it with the API key tomorrow).
   */
  app.post('/carrier-users/populate-carrier', guard, async (request) => {
    const ctx = requireAdmin(request);
    const body = populateCarrierSchema.parse(request.body);
    const updated = await carrierUserRepo.populateCarrierId(
      ctx,
      body.application_id,
      body.carrier_id,
    );
    await auditFromContext(ctx, {
      action: 'admin.carrier_user.populate_carrier',
      status: 'ok',
      resourceType: 'carrier_user',
      detail: {
        applicationId: body.application_id,
        carrierId: body.carrier_id,
        updated: updated.map((u) => u.id),
      },
    });
    return { updated, count: updated.length };
  });

  /** Partial update — password reset, status toggle, card/carrier assignment. */
  app.post('/carrier-users/:id', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = request.params as { id: string };
    const body = updateSchema.parse(request.body);
    const user = await carrierUserRepo.update(ctx, id, {
      ...(body.carrier_id !== undefined ? { carrierId: body.carrier_id } : {}),
      ...(body.application_id !== undefined ? { applicationId: body.application_id } : {}),
      ...(body.card_id !== undefined ? { cardId: body.card_id } : {}),
      ...(body.password !== undefined ? { passwordHash: await hashPassword(body.password) } : {}),
      ...(body.agent_name !== undefined ? { agentName: body.agent_name } : {}),
      ...(body.agent_zoho_user_id !== undefined
        ? { agentZohoUserId: body.agent_zoho_user_id }
        : {}),
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
    // An owner with driver accounts cannot be deleted out from under them.
    const children = await carrierUserRepo.countChildren(ctx, id);
    if (children > 0) {
      throw new ConflictError(
        `This owner has ${children} driver account(s) — delete or reassign them first`,
      );
    }
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
