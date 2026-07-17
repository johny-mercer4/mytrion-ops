import type { FastifyInstance, RouteShorthandOptions } from 'fastify';
import { z } from 'zod';
import { RBACError } from '../../lib/errors.js';
import { DEFAULT_PROFILE_SEED, MYTRION_IDS, type MytrionId } from '../../lib/mytrions.js';
import { listActiveUsersCached } from '../../modules/auth/actAsDirectory.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import { mytrionAccessService } from '../../modules/access/mytrionAccessService.js';
import { mytrionProfileDefaultsRepo, type MytrionProfileDefaultDto } from '../../repos/mytrionProfileDefaultsRepo.js';
import { workerMytrionAccessRepo } from '../../repos/workerMytrionAccessRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext } from './helpers.js';

const mytrionIdSchema = z.enum([...MYTRION_IDS] as [MytrionId, ...MytrionId[]]);

/** Per-user override patch. `allowedMytrions: null` = inherit the profile default; array = replace. */
const userAccessBody = z.object({
  allowedMytrions: z.array(mytrionIdSchema).max(20).nullable().optional(),
  deniedMytrions: z.array(mytrionIdSchema).max(20).optional(),
  homeMytrion: mytrionIdSchema.nullable().optional(),
  allDepartmentAccess: z.boolean().nullable().optional(),
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

/** Seed the known-profile defaults on first use so the Profile Defaults screen is never empty. */
async function seededProfileDefaults(ctx: TenantContext): Promise<MytrionProfileDefaultDto[]> {
  const existing = await mytrionProfileDefaultsRepo.list(ctx);
  if (existing.length > 0) return existing;
  for (const seed of DEFAULT_PROFILE_SEED) {
    await mytrionProfileDefaultsRepo.upsert(ctx, {
      profileName: seed.profileName,
      allowedMytrions: seed.allowedMytrions,
      homeMytrion: seed.homeMytrion,
      allDepartmentAccess: seed.allDepartmentAccess,
    });
  }
  // Seeding changes what every worker resolves — drop any cached (pre-seed legacy-floor) grants.
  mytrionAccessService.invalidateAll();
  return mytrionProfileDefaultsRepo.list(ctx);
}

/**
 * Internal User Management — admins control which Zoho worker can access which Mytrion.
 * All endpoints require real admin (allDepartmentAccess) on the internal audience, matching
 * /admin/agents. Everything mutating is audit-logged. No table data is exposed here.
 */
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
      const saved = await workerMytrionAccessRepo.upsert(ctx, {
        zohoUserId,
        userName: body.userName ?? null,
        email: body.email ?? null,
        profileName: body.profileName ?? null,
        allowedMytrions: body.allowedMytrions === undefined ? null : body.allowedMytrions,
        deniedMytrions: body.deniedMytrions ?? [],
        homeMytrion: body.homeMytrion ?? null,
        allDepartmentAccess: body.allDepartmentAccess === undefined ? null : body.allDepartmentAccess,
        viewAsUserIds: body.viewAsUserIds ?? [],
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
        },
      });
      return { access: saved };
    },
  );

  // Profile defaults (seeded on first read).
  app.get('/admin/mytrion-access/profiles', guard, async (request) => {
    const ctx = requireAdmin(request);
    return { profiles: await seededProfileDefaults(ctx) };
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
        homeMytrion: body.homeMytrion ?? null,
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
}
