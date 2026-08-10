/**
 * Permission set admin — Salesforce-style named, reusable, additive grants.
 *
 * Its own file rather than more of mytrionAccess.routes.ts, which is already 319 lines and near the
 * 600-line cap once this is added.
 *
 * SHAPE, borrowed from commsAdmin.routes.ts because that screen solved the same problem: ONE snapshot
 * GET that returns the whole editor, then GRANULAR PATCHes per row so each control owns its own busy
 * state and two admins editing two different Mytrions of the same set do not clobber each other. The
 * grant writes go through `jsonb_set` in the UPDATE for the same reason — read-modify-write in JS
 * loses whichever write lands second.
 *
 * WHAT IS AND IS NOT SECURED. A set's Mytrion grants and its read/full modes are enforced end to end:
 * they reach TenantContext.departments and .mytrionAccessModes, which every RBAC gate reads. The TAB
 * grants inside a set are UI gating only — the backend enforces at Mytrion + read/full and nothing
 * finer, so hiding a tab removes the door, not the lock. That is why tab keys are validated only for
 * shape here and never against a taxonomy: a key the server does not recognise grants nothing and
 * denies nothing, and duplicating the frontend's tab vocabulary would turn the "dynamic" requirement
 * into "dynamic, after a server release".
 */
import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError, ValidationError } from '../../lib/errors.js';
import { MYTRION_IDS, type MytrionId } from '../../lib/mytrions.js';
import { listActiveUsersCached } from '../../modules/auth/actAsDirectory.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { mytrionAccessService } from '../../modules/access/mytrionAccessService.js';
import {
  mytrionPermissionSetAssignmentsRepo,
  mytrionPermissionSetsRepo,
} from '../../repos/mytrionPermissionSetsRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const mytrionIdSchema = z.enum([...MYTRION_IDS] as [MytrionId, ...MytrionId[]]);

/**
 * Tab keys are opaque. camelCase is allowed because the app already uses it (sales.callHub) — the
 * server's only interest is "short, and safe to put in a jsonb array".
 */
const tabKeySchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9-]{0,63}$/, 'Invalid tab key');

const createBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
});

const metaBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
});

const grantBody = z.object({
  mode: z.enum(['read', 'full']),
  /**
   * `null` UNSCOPES the Mytrion — every tab, including ones added later. An empty ARRAY is a
   * different statement: scoped to nothing. Both are legal and they must not be conflated, which is
   * why this is nullable rather than optional-with-default.
   */
  tabs: z.array(tabKeySchema).max(64).nullable(),
});

const assignBody = z.object({
  zohoUserId: z.string().trim().min(1).max(120),
  userName: z.string().max(200).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
});

export async function mytrionPermissionSetsRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /** Same true-admin gate as User Management — allDepartmentAccess is the real marker. */
  function requireAdmin(request: Parameters<typeof requireContext>[0]): TenantContext {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      throw new RBACError('Admin (all-department) access required for permission sets.');
    }
    return ctx;
  }

  async function loadSet(ctx: TenantContext, id: string) {
    const set = await mytrionPermissionSetsRepo.findById(ctx, id);
    if (!set) throw new AppError('Permission set not found', { code: 'NOT_FOUND', statusCode: 404 });
    return set;
  }

  /**
   * The whole screen in one request.
   *
   * `roster` carries every active Zoho worker with `assigned` already computed, copying the
   * stub-synthesis idea from GET /admin/mytrion-access/roles: an admin can assign someone who has
   * never had an access row of any kind.
   */
  app.get('/admin/permission-sets', guard, async (request) => {
    const ctx = requireAdmin(request);
    const sets = await mytrionPermissionSetsRepo.list(ctx);
    const [counts, assignments, roster] = await Promise.all([
      mytrionPermissionSetAssignmentsRepo.countsBySetId(
        ctx,
        sets.map((s) => s.id),
      ),
      mytrionPermissionSetAssignmentsRepo.listAllActive(ctx),
      listActiveUsersCached().catch(() => []),
    ]);
    const assignedIds = new Set(assignments.map((a) => a.zohoUserId));
    return {
      sets: sets.map((s) => ({ ...s, assigneeCount: counts[s.id] ?? 0 })),
      assignments,
      roster: roster.map((u) => ({
        zohoUserId: u.zohoUserId,
        name: u.name ?? null,
        email: u.email ?? null,
        assigned: assignedIds.has(u.zohoUserId),
      })),
    };
  });

  app.post('/admin/permission-sets', guard, async (request, reply) => {
    const ctx = requireAdmin(request);
    const body = createBody.parse(request.body ?? {});
    const existing = await mytrionPermissionSetsRepo.list(ctx);
    if (existing.some((s) => s.key === body.name.trim().toLowerCase())) {
      throw new ValidationError('A permission set with that name already exists');
    }
    const set = await mytrionPermissionSetsRepo.create(ctx, {
      name: body.name,
      description: body.description ?? null,
      createdByZohoUserId: ctx.userId,
    });
    await auditFromContext(ctx, {
      action: 'admin.permission_set.create',
      status: 'ok',
      resourceType: 'mytrion_permission_set',
      resourceId: set.id,
      detail: { after: { name: set.name, description: set.description } },
    });
    // A brand-new set has no assignees, so nothing to invalidate yet.
    reply.code(201);
    return { set };
  });

  app.patch('/admin/permission-sets/:id', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = metaBody.parse(request.body ?? {});
    const before = await loadSet(ctx, id);
    const after = await mytrionPermissionSetsRepo.updateMeta(ctx, id, {
      // Spread rather than pass `body` directly: exactOptionalPropertyTypes distinguishes "absent"
      // from "present and undefined", and Zod's .optional() produces the latter.
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.active === undefined ? {} : { active: body.active }),
    });
    if (!after) throw new AppError('Permission set not found', { code: 'NOT_FOUND', statusCode: 404 });

    await auditFromContext(ctx, {
      action: 'admin.permission_set.update',
      status: 'ok',
      resourceType: 'mytrion_permission_set',
      resourceId: id,
      detail: {
        changed: Object.keys(body),
        before: { name: before.name, description: before.description, active: before.active },
        after: { name: after.name, description: after.description, active: after.active },
      },
    });
    // Deactivating a set changes what every holder can reach.
    if (body.active !== undefined) mytrionAccessService.invalidateAll();
    return { set: after };
  });

  app.patch('/admin/permission-sets/:id/mytrions/:mytrionId', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id, mytrionId } = z
      .object({ id: z.string().min(1), mytrionId: mytrionIdSchema })
      .parse(request.params);
    const body = grantBody.parse(request.body ?? {});
    const before = await loadSet(ctx, id);
    const after = await mytrionPermissionSetsRepo.setMytrionGrant(ctx, id, mytrionId, body);
    if (!after) throw new AppError('Permission set not found', { code: 'NOT_FOUND', statusCode: 404 });

    await auditFromContext(ctx, {
      action: 'admin.permission_set.mytrion.update',
      status: 'ok',
      resourceType: 'mytrion_permission_set',
      resourceId: id,
      detail: {
        mytrionId,
        before: {
          granted: before.allowedMytrions.includes(mytrionId),
          mode: before.mytrionAccessModes[mytrionId] ?? null,
          tabs: before.tabGrants[mytrionId] ?? null,
        },
        after: {
          granted: true,
          mode: after.mytrionAccessModes[mytrionId] ?? null,
          tabs: after.tabGrants[mytrionId] ?? null,
        },
      },
    });
    /**
     * Editing a set changes access for everyone holding it, so the whole cache goes.
     *
     * The same thing profile and role default saves already do, for the same reason: this is config
     * that fans out to many users, it changes a handful of times a month, and the cost is one
     * re-resolve per active worker within the 10s TTL. An assignment lookup + per-user invalidation
     * would be more code for identical behaviour, and subtly wrong for a set whose assignees change
     * in the same session.
     */
    mytrionAccessService.invalidateAll();
    return { set: after };
  });

  app.delete('/admin/permission-sets/:id/mytrions/:mytrionId', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id, mytrionId } = z
      .object({ id: z.string().min(1), mytrionId: mytrionIdSchema })
      .parse(request.params);
    const before = await loadSet(ctx, id);
    const after = await mytrionPermissionSetsRepo.removeMytrionGrant(ctx, id, mytrionId);
    if (!after) throw new AppError('Permission set not found', { code: 'NOT_FOUND', statusCode: 404 });

    await auditFromContext(ctx, {
      action: 'admin.permission_set.mytrion.remove',
      status: 'ok',
      resourceType: 'mytrion_permission_set',
      resourceId: id,
      detail: {
        mytrionId,
        before: {
          mode: before.mytrionAccessModes[mytrionId] ?? null,
          tabs: before.tabGrants[mytrionId] ?? null,
        },
      },
    });
    mytrionAccessService.invalidateAll();
    return { set: after };
  });

  app.delete('/admin/permission-sets/:id', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const before = await loadSet(ctx, id);
    const removed = await mytrionPermissionSetsRepo.remove(ctx, id);

    await auditFromContext(ctx, {
      action: 'admin.permission_set.delete',
      status: removed ? 'ok' : 'error',
      resourceType: 'mytrion_permission_set',
      resourceId: id,
      detail: {
        before: {
          name: before.name,
          allowedMytrions: before.allowedMytrions,
          tabGrants: before.tabGrants,
        },
      },
    });
    mytrionAccessService.invalidateAll();
    return { removed };
  });

  app.post('/admin/permission-sets/:id/assignees', guard, async (request, reply) => {
    const ctx = requireAdmin(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const body = assignBody.parse(request.body ?? {});
    await loadSet(ctx, id);
    const assignment = await mytrionPermissionSetAssignmentsRepo.assign(ctx, {
      permissionSetId: id,
      zohoUserId: body.zohoUserId,
      userName: body.userName ?? null,
      email: body.email ?? null,
      assignedByZohoUserId: ctx.userId,
    });
    await auditFromContext(ctx, {
      action: 'admin.permission_set.assignee.add',
      status: 'ok',
      resourceType: 'mytrion_permission_set',
      resourceId: id,
      detail: { after: { zohoUserId: body.zohoUserId, userName: body.userName ?? null } },
    });
    // One user changed — precise and cheap, unlike a set edit.
    mytrionAccessService.invalidateUser(ctx.tenantId, body.zohoUserId);
    reply.code(201);
    return { assignment };
  });

  app.delete('/admin/permission-sets/:id/assignees/:zohoUserId', guard, async (request) => {
    const ctx = requireAdmin(request);
    const { id, zohoUserId } = z
      .object({ id: z.string().min(1), zohoUserId: z.string().min(1) })
      .parse(request.params);
    const removed = await mytrionPermissionSetAssignmentsRepo.unassign(ctx, id, zohoUserId);
    await auditFromContext(ctx, {
      action: 'admin.permission_set.assignee.remove',
      status: 'ok',
      resourceType: 'mytrion_permission_set',
      resourceId: id,
      detail: { before: { zohoUserId } },
    });
    mytrionAccessService.invalidateUser(ctx.tenantId, zohoUserId);
    return { removed };
  });
}
