import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { AppError, RBACError } from '../../lib/errors.js';
import { MYTRION_IDS, roleKeyOf, toMytrionAccessModes, type MytrionId } from '../../lib/mytrions.js';
import { listActiveUsersCached } from '../../modules/auth/actAsDirectory.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { mytrionAccessService } from '../../modules/access/mytrionAccessService.js';
import { mytrionProfileDefaultsRepo } from '../../repos/mytrionProfileDefaultsRepo.js';
import { mytrionRoleDefaultsRepo } from '../../repos/mytrionRoleDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../repos/workerMytrionAccessRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const mytrionIdSchema = z.enum([...MYTRION_IDS] as [MytrionId, ...MytrionId[]]);
const mytrionAccessModesSchema = z.record(z.string(), z.enum(['read', 'full'])).optional();

/** Per-user override patch. `allowedMytrions: null` = inherit profile+role defaults; array = replace. */
const userAccessBody = z.object({
  allowedMytrions: z.array(mytrionIdSchema).max(20).nullable().optional(),
  deniedMytrions: z.array(mytrionIdSchema).max(20).optional(),
  homeMytrion: mytrionIdSchema.nullable().optional(),
  allDepartmentAccess: z.boolean().nullable().optional(),
  mytrionAccessModes: mytrionAccessModesSchema,
  /** Zoho user ids this worker may "View as" (targeted impersonation grant). */
  viewAsUserIds: z.array(z.string().min(1).max(120)).max(50).optional(),
  active: z.boolean().optional(),
  // Denormalized CRM snapshot for display/audit (the admin UI has the user loaded).
  userName: z.string().max(200).nullable().optional(),
  email: z.string().max(254).nullable().optional(),
  profileName: z.string().max(200).nullable().optional(),
});

const profileDefaultBody = z.object({
  profileName: z.string().min(1).max(200),
  allowedMytrions: z.array(mytrionIdSchema).max(20),
  homeMytrion: mytrionIdSchema.nullable().optional(),
  allDepartmentAccess: z.boolean().optional(),
  active: z.boolean().optional(),
});

const roleDefaultBody = z.object({
  roleName: z.string().min(1).max(200),
  allowedMytrions: z.array(mytrionIdSchema).max(20),
  homeMytrion: mytrionIdSchema.nullable().optional(),
  allDepartmentAccess: z.boolean().optional(),
  mytrionAccessModes: mytrionAccessModesSchema,
  active: z.boolean().optional(),
});

/**
 * Invariant: a grant that leaves exactly ONE accessible Mytrion always carries it as home, so
 * Landing auto-navigates and the picker can never appear for single-Mytrion users. `??` also
 * covers an explicit null — clearing home on a single-Mytrion grant is meaningless.
 */
function normalizedHome(
  home: MytrionId | null | undefined,
  allowed: MytrionId[] | null | undefined,
): MytrionId | null {
  const sole = Array.isArray(allowed) && allowed.length === 1 ? (allowed[0] ?? null) : null;
  return home ?? sole;
}

/**
 * Internal User Management — admins control which Zoho worker can access which Mytrion.
 * All endpoints require real admin (allDepartmentAccess) on the internal audience, matching
 * /admin/agents. Everything mutating is audit-logged. No table data is exposed here.
 */
/**
 * How many OTHER active workers still resolve to all-Mytrion access. Uses the same batch resolver
 * the admin listing uses, so "who is an admin" is answered by exactly one authority rather than a
 * second, divergent query.
 */
async function countOtherAllAccessUsers(
  ctx: TenantContext,
  excludeZohoUserId: string,
): Promise<number | null> {
  const directory = await listActiveUsersCached();
  const inputs = directory
    .filter((u) => u.zohoUserId !== excludeZohoUserId)
    .map((u) => ({
      tenantId: ctx.tenantId,
      zohoUserId: u.zohoUserId,
      userName: u.name ?? null,
      profileName: u.profile ?? null,
      zohoRole: u.role ?? null,
    }));
  if (inputs.length === 0) return 0;
  const resolved = await mytrionAccessService.resolveBatch(ctx.tenantId, inputs);
  let n = 0;
  for (const r of resolved.values()) if (r.allDepartmentAccess) n += 1;
  return n;
}

export async function mytrionAccessRoutes(app: FastifyInstance): Promise<void> {
  const guard: RouteShorthandOptions = { onRequest: [app.authenticate] };

  /** True-admin gate (Zoho workers all carry an internal role; allDepartmentAccess is the real marker). */
  function requireAdmin(request: Parameters<typeof requireContext>[0]): TenantContext {
    const ctx = requireContext(request);
    if (!ctx.allDepartmentAccess && !ctx.bypassRbac) {
      throw new RBACError('Admin (all-department) access required for user management.');
    }
    return ctx;
  }

  // Active Zoho users + each one's stored override + resolved EFFECTIVE access.
  // Resolves all users' access via resolveBatch (2 bulk queries total) instead of fanning out
  // resolveWorkerAccess per row (2 DB round trips PER user) — that N+1 was the main cause of this
  // endpoint being slow for orgs with more than a handful of workers.
  app.get('/admin/mytrion-access/users', guard, async (request) => {
    const ctx = requireAdmin(request);
    const [users, overrides] = await Promise.all([listActiveUsersCached(), workerMytrionAccessRepo.list(ctx)]);
    const byId = new Map(overrides.map((o) => [o.zohoUserId, o]));
    const effectiveById = await mytrionAccessService.resolveBatch(
      ctx.tenantId,
      users.map((u) => ({
        tenantId: ctx.tenantId,
        zohoUserId: u.zohoUserId,
        profileName: u.profile,
        zohoRole: u.role,
        userName: u.name,
      })),
      overrides,
    );
    const rows = users.map((u) => ({
      zohoUserId: u.zohoUserId,
      name: u.name,
      email: u.email,
      profile: u.profile,
      role: u.role,
      override: byId.get(u.zohoUserId) ?? null,
      effective: effectiveById.get(u.zohoUserId),
    }));
    return { users: rows };
  });

  // Upsert one user's override.
  app.post<{ Params: { zohoUserId: string } }>(
    '/admin/mytrion-access/users/:zohoUserId',
    guard,
    async (request) => {
      const ctx = requireAdmin(request);
      const zohoUserId = request.params.zohoUserId.trim();
      if (!zohoUserId) throw new RBACError('zohoUserId is required');
      const body = userAccessBody.parse(request.body);

      /**
       * Last-admin guard. Profile-"Administrator" users used to be PINNED to all-access by the
       * resolver, which made them impossible to manage — their override was computed and discarded.
       * That floor is gone (see mytrionAccessService), so an override can now genuinely remove
       * someone's admin access, and the lockout risk it was guarding against is real. Refuse the
       * save that would leave the tenant with nobody holding all-access.
       *
       * ADMIN_USERS / BYPASS_USERS are exempt from this check on purpose: they are named in server
       * env, cannot be edited from the app, and are the recovery path if this ever goes wrong.
       */
      // Scoped to the EXPLICIT "remove all-access" action, which is the real lockout vector. A
      // deny-list edit is not checked: denies are overwhelmingly used on ordinary workers, and
      // treating every one as a potential lockout would block routine edits (and cost a directory
      // round-trip each time). A deny that empties the last admin's list remains possible in
      // principle — ADMIN_USERS / BYPASS_USERS is the recovery path for that.
      if (body.allDepartmentAccess === false) {
        // Resolving "who else is an admin" needs the Zoho directory. If that lookup fails we let the
        // save through rather than blocking admin work on an upstream hiccup — this rail is a
        // convenience; ADMIN_USERS / BYPASS_USERS is the actual recovery path.
        let remaining: number | null = null;
        try {
          remaining = await countOtherAllAccessUsers(ctx, zohoUserId);
        } catch (err) {
          request.log.warn({ err }, 'last-admin guard: could not resolve other all-access users');
        }
        if (remaining === 0) {
          throw new AppError(
            'This is the last user with all-Mytrion access — removing it would lock everyone out of Admin. Grant another user all-access first.',
            { statusCode: 409, code: 'LAST_ADMIN', expose: true },
          );
        }
      }

      const saved = await workerMytrionAccessRepo.upsert(ctx, {
        zohoUserId,
        userName: body.userName ?? null,
        email: body.email ?? null,
        profileName: body.profileName ?? null,
        allowedMytrions: body.allowedMytrions === undefined ? null : body.allowedMytrions,
        deniedMytrions: body.deniedMytrions ?? [],
        homeMytrion: normalizedHome(body.homeMytrion, body.allowedMytrions),
        allDepartmentAccess: body.allDepartmentAccess === undefined ? null : body.allDepartmentAccess,
        viewAsUserIds: body.viewAsUserIds ?? [],
        mytrionAccessModes: toMytrionAccessModes(body.mytrionAccessModes ?? {}),
        active: body.active ?? true,
      });
      mytrionAccessService.invalidateUser(ctx.tenantId, zohoUserId);
      await auditFromContext(ctx, {
        action: 'admin.mytrion_access.user.update',
        status: 'ok',
        resourceType: 'worker_mytrion_access',
        resourceId: zohoUserId,
        detail: {
          allowedMytrions: saved.allowedMytrions,
          deniedMytrions: saved.deniedMytrions,
          homeMytrion: saved.homeMytrion,
          allDepartmentAccess: saved.allDepartmentAccess,
          mytrionAccessModes: saved.mytrionAccessModes,
        },
      });
      return { access: saved };
    },
  );

  // Profile defaults (also seeded at boot — bootstrap.ts; this keeps the screen self-healing).
  app.get('/admin/mytrion-access/profiles', guard, async (request) => {
    const ctx = requireAdmin(request);
    return { profiles: await mytrionAccessService.ensureProfileDefaultsSeeded(ctx.tenantId) };
  });

  app.post<{ Params: { profileKey: string } }>(
    '/admin/mytrion-access/profiles/:profileKey',
    guard,
    async (request) => {
      const ctx = requireAdmin(request);
      const body = profileDefaultBody.parse(request.body);
      const saved = await mytrionProfileDefaultsRepo.upsert(ctx, {
        profileName: body.profileName,
        allowedMytrions: body.allowedMytrions,
        homeMytrion: normalizedHome(body.homeMytrion, body.allowedMytrions),
        allDepartmentAccess: body.allDepartmentAccess ?? false,
        active: body.active ?? true,
      });
      // A profile default affects many workers — clear the whole resolver cache.
      mytrionAccessService.invalidateAll();
      await auditFromContext(ctx, {
        action: 'admin.mytrion_access.profile.update',
        status: 'ok',
        resourceType: 'mytrion_profile_defaults',
        resourceId: saved.profileKey,
        detail: {
          allowedMytrions: saved.allowedMytrions,
          homeMytrion: saved.homeMytrion,
          allDepartmentAccess: saved.allDepartmentAccess,
        },
      });
      return { profile: saved };
    },
  );

  /**
   * Role defaults — stored rows plus every distinct Zoho role seen on the roster (so admins can
   * configure a role before/without a prior save). Unsaved roster roles return empty inactive
   * stubs (`configured: false`); they do not affect resolution until saved.
   */
  app.get('/admin/mytrion-access/roles', guard, async (request) => {
    const ctx = requireAdmin(request);
    const [stored, users] = await Promise.all([
      mytrionRoleDefaultsRepo.list(ctx),
      listActiveUsersCached(),
    ]);
    const byKey = new Map(stored.map((r) => [r.roleKey, { ...r, configured: true }]));
    for (const u of users) {
      const name = u.role?.trim();
      if (!name) continue;
      const key = roleKeyOf(name);
      if (byKey.has(key)) continue;
      byKey.set(key, {
        id: '',
        roleName: name,
        roleKey: key,
        allowedMytrions: [],
        homeMytrion: null,
        allDepartmentAccess: false,
        mytrionAccessModes: {},
        active: false,
        createdAt: '',
        updatedAt: '',
        configured: false,
      });
    }
    const roles = [...byKey.values()].sort((a, b) =>
      a.roleName.localeCompare(b.roleName, undefined, { sensitivity: 'base' }),
    );
    return { roles };
  });

  app.post<{ Params: { roleKey: string } }>(
    '/admin/mytrion-access/roles/:roleKey',
    guard,
    async (request) => {
      const ctx = requireAdmin(request);
      const body = roleDefaultBody.parse(request.body);
      const allowed =
        body.allDepartmentAccess === true ? [...MYTRION_IDS] : body.allowedMytrions;
      const saved = await mytrionRoleDefaultsRepo.upsert(ctx, {
        roleName: body.roleName,
        allowedMytrions: allowed,
        homeMytrion: normalizedHome(
          body.homeMytrion,
          body.allDepartmentAccess === true ? null : body.allowedMytrions,
        ),
        allDepartmentAccess: body.allDepartmentAccess ?? false,
        mytrionAccessModes: toMytrionAccessModes(body.mytrionAccessModes ?? {}),
        active: body.active ?? true,
      });
      mytrionAccessService.invalidateAll();
      await auditFromContext(ctx, {
        action: 'admin.mytrion_access.role.update',
        status: 'ok',
        resourceType: 'mytrion_role_defaults',
        resourceId: saved.roleKey,
        detail: {
          allowedMytrions: saved.allowedMytrions,
          homeMytrion: saved.homeMytrion,
          allDepartmentAccess: saved.allDepartmentAccess,
          mytrionAccessModes: saved.mytrionAccessModes,
        },
      });
      return { role: saved };
    },
  );
}
