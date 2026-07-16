import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../lib/errors.js';
import { audit } from '../../modules/audit/auditLogger.js';
import { authService, toPublicUser } from '../../modules/auth/authService.js';
import { mytrionAccessService } from '../../modules/access/mytrionAccessService.js';
import { resolveActAsTarget } from '../../modules/auth/actAsDirectory.js';
import { zohoAuthService } from '../../modules/auth/zohoAuthService.js';
import { userRepo } from '../../repos/userRepo.js';
import { requireContext } from './helpers.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(200),
  tenantId: z.string().min(1).max(100).optional(),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(10),
});

const zohoCallbackSchema = z.object({
  code: z.string().min(1).max(2000),
  state: z.string().min(1).max(4000),
});

/** Resolve the display identity of a worker's "view as" targets (for the SPA picker; CRM-cached). */
async function viewAsTargets(ids: string[]): Promise<Array<{ zohoUserId: string; name: string | null }>> {
  const out: Array<{ zohoUserId: string; name: string | null }> = [];
  for (const id of ids) {
    const t = await resolveActAsTarget(id);
    if (t) out.push({ zohoUserId: t.zohoUserId, name: t.name });
  }
  return out;
}

function requireZohoOauth(): void {
  if (!env.FF_ZOHO_OAUTH_ENABLED) {
    throw new AppError('Zoho OAuth login is disabled (set FF_ZOHO_OAUTH_ENABLED).', {
      statusCode: 503,
      code: 'FEATURE_DISABLED',
    });
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', async (request) => {
    const body = loginSchema.parse(request.body);
    const tenantId = body.tenantId ?? DEFAULT_TENANT_ID;
    try {
      const result = await authService.login(body.email, body.password, tenantId);
      await audit({
        tenantId: result.user.tenantId,
        audience: result.user.audience,
        userId: result.user.id,
        userName: result.user.fullName ?? result.user.email,
        role: result.user.role,
        action: 'auth.login',
        status: 'ok',
        requestId: request.requestId,
        ip: request.ip,
      });
      return result;
    } catch (err) {
      await audit({
        tenantId,
        action: 'auth.login',
        status: 'denied',
        requestId: request.requestId,
        ip: request.ip,
        detail: { email: body.email },
      });
      throw err;
    }
  });

  app.post('/auth/refresh', async (request) => {
    const body = refreshSchema.parse(request.body);
    return authService.refresh(body.refreshToken);
  });

  // ── Retired carrier-client password sign-in ───────────────────────────────────────────────────
  app.post('/auth/client/login', async () => {
    throw new AppError('Client login/password is retired. Use the Telegram registration flow.', {
      statusCode: 410,
      code: 'FEATURE_DISABLED',
      expose: true,
    });
  });

  // ── Zoho OAuth worker sign-in (authorization-code) ───────────────────────────────────────────
  // Step 1: the SPA fetches the authorize URL + state, stashes state, and redirects the browser.
  app.get('/auth/zoho/login', async () => {
    requireZohoOauth();
    return zohoAuthService.startLogin();
  });

  // Step 2: Zoho redirects back to the SPA with ?code&state; the SPA relays them here. We verify
  // state, exchange the code, read the worker's Zoho identity, and return a Bearer session.
  app.post('/auth/zoho/callback', async (request) => {
    requireZohoOauth();
    const body = zohoCallbackSchema.parse(request.body);
    try {
      const session = await zohoAuthService.completeLogin(body.code, body.state);
      // Resolve the worker's DB-backed Mytrion access so the SPA can route immediately (home)
      // and render only the granted Mytrions — the same resolution backend RBAC uses.
      const access = await mytrionAccessService.resolveWorkerAccess({
        tenantId: DEFAULT_TENANT_ID,
        zohoUserId: session.worker.zohoUserId,
        profileName: session.worker.profile,
        zohoRole: session.worker.role,
        userName: session.worker.userName,
      });
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        audience: 'internal',
        userId: `zoho:${session.worker.zohoUserId}`,
        ...(session.worker.userName ? { userName: session.worker.userName } : {}),
        ...(session.worker.profile ? { profile: session.worker.profile } : {}),
        ...(session.worker.role ? { callerRole: session.worker.role } : {}),
        action: 'auth.zoho.login',
        status: 'ok',
        requestId: request.requestId,
        ip: request.ip,
        detail: { profile: session.worker.profile, role: session.worker.role },
      });
      return {
        ...session,
        worker: {
          ...session.worker,
          accessibleMytrions: access.accessibleMytrions,
          homeMytrion: access.homeMytrion,
          allDepartmentAccess: access.allDepartmentAccess,
          viewAsUserIds: access.viewAsUserIds,
          viewAsTargets: await viewAsTargets(access.viewAsUserIds),
        },
      };
    } catch (err) {
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        action: 'auth.zoho.login',
        status: 'denied',
        requestId: request.requestId,
        ip: request.ip,
      });
      throw err;
    }
  });

  // Current identity for a session. Worker (Zoho) sessions return the verified Zoho identity from
  // the context; the dormant email/password path returns the users-table record.
  app.get('/auth/me', { onRequest: [app.authenticate] }, async (request) => {
    const ctx = requireContext(request);
    // Zoho-worker session (userId `zoho:<id>`). The email/password path is also sessionVerified now,
    // but it's a users-table principal — it falls through to the userRepo lookup below.
    if (ctx.sessionVerified && ctx.userId.startsWith('zoho:')) {
      const zohoUserId = ctx.userId.replace(/^zoho:/, '');
      const access = await mytrionAccessService.resolveWorkerAccess({
        tenantId: ctx.tenantId,
        zohoUserId,
        profileName: ctx.profiles?.[0] ?? null,
        zohoRole: ctx.callerRole ?? null,
        userName: ctx.userName ?? null,
      });
      return {
        worker: {
          zohoUserId,
          userName: ctx.userName ?? null,
          profile: ctx.profiles?.[0] ?? null,
          role: ctx.callerRole ?? null,
          allDepartmentAccess: access.allDepartmentAccess,
          accessibleMytrions: access.accessibleMytrions,
          homeMytrion: access.homeMytrion,
          viewAsUserIds: access.viewAsUserIds,
          viewAsTargets: await viewAsTargets(access.viewAsUserIds),
        },
      };
    }
    const user = await userRepo.findById(ctx, ctx.userId);
    if (!user) throw new NotFoundError('User not found');
    return { user: toPublicUser(user) };
  });
}
