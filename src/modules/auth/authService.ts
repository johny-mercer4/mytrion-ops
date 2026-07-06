import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import type { User } from '../../db/schema/index.js';
import { AuthError } from '../../lib/errors.js';
import { normalizeDepartments } from '../../lib/department.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import { userRepo } from '../../repos/userRepo.js';
import type { Audience, Role, TenantContext } from '../../types/tenantContext.js';
import { signAccessToken, signRefreshToken, verifyToken, type TokenClaims } from './jwt.js';
import { verifyPassword } from './password.js';
import { scopesForRole } from './permissions.js';
import { workerRoleFor } from './workerRole.js';
// Type-only (erased at compile): no runtime import cycle — zohoAuthService value-imports nothing here.
import type { PublicWorker, WorkerSession } from './zohoAuthService.js';
import type { ClientSession } from './clientAuthService.js';

export interface PublicUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string | null;
  role: Role;
  audience: Audience;
  status: 'active' | 'disabled';
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
}

export interface LoginResult extends AuthTokens {
  user: PublicUser;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    tenantId: user.tenantId,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    audience: user.audience,
    status: user.status,
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
  };
}

/**
 * Build the request security context from verified token claims. scopes are
 * recomputed from role here (never trusted from the token).
 */
export function contextFromClaims(claims: TokenClaims, requestId: string): TenantContext {
  // Zoho-worker session: identity is VERIFIED (from the signed token). The internal role is
  // RE-DERIVED from the embedded worker identity — never trusted from claims.role — so a role
  // policy change (or a stale pre-fix 'admin' token) takes effect for live sessions on deploy.
  // allDepartmentAccess uses the same predicate, so role and bypass can't diverge. The
  // department VIEW is applied per request in buildCallerContext.
  if (claims.worker) {
    const w = claims.worker;
    const role = workerRoleFor({ userName: w.userName, profile: w.profile, zohoRole: w.zohoRole });
    const ctx: TenantContext = {
      tenantId: claims.tenantId,
      userId: claims.userId,
      audience: claims.audience,
      role,
      scopes: scopesForRole(role),
      departments: [],
      allDepartmentAccess: role === 'admin',
      sessionVerified: true,
      requestId,
    };
    if (w.userName) ctx.userName = w.userName;
    if (w.profile) ctx.profiles = [w.profile];
    if (w.zohoRole) ctx.callerRole = w.zohoRole;
    return ctx;
  }
  // Carrier-client session (login/password from carrier_users): locked down server-side
  // regardless of the token's stored role/audience — audience 'customer' (deny-by-default
  // for tools/agents), viewer role, NO scopes, departments = the company tags only. This
  // mirrors customerContext for unverified Telegram callers; here the tags are VERIFIED
  // (from the signed token, minted off the carrier_users row at login).
  if (claims.client) {
    const c = claims.client;
    const ctx: TenantContext = {
      tenantId: claims.tenantId,
      userId: `client:${c.carrierUserId}`,
      audience: 'customer',
      role: 'viewer',
      scopes: [],
      departments: normalizeDepartments([c.carrierId, ...(c.applicationId ? [c.applicationId] : [])]),
      allDepartmentAccess: false,
      sessionVerified: true,
      requestId,
    };
    if (c.login) ctx.userName = c.login;
    return ctx;
  }
  return {
    tenantId: claims.tenantId,
    userId: claims.userId,
    audience: claims.audience,
    role: claims.role,
    scopes: scopesForRole(claims.role),
    // Department access is supplied per request by the caller (see routes/v1/helpers).
    // Admins are elevated by default ("managers can access almost everything").
    departments: [],
    allDepartmentAccess: claims.role === 'admin',
    requestId,
  };
}

/**
 * The single hardcoded identity used when a request authenticates with the static
 * API_KEY (no users / multi-tenancy). Full tool scopes; department access is least-
 * privilege and supplied per request by the caller (see withDepartmentAccess).
 */
export function systemContext(requestId: string): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'system',
    audience: 'internal',
    role: 'admin',
    scopes: scopesForRole('admin'),
    departments: [],
    allDepartmentAccess: false,
    requestId,
  };
}

async function issueTokens(user: User): Promise<AuthTokens> {
  const claims: TokenClaims = {
    userId: user.id,
    tenantId: user.tenantId,
    audience: user.audience,
    role: user.role,
  };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(claims),
    signRefreshToken(claims),
  ]);
  return { accessToken, refreshToken, tokenType: 'Bearer' };
}

export const authService = {
  async login(
    email: string,
    password: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<LoginResult> {
    const user = await userRepo.findByEmailForAuth(email, tenantId);
    // Always run a verify to keep timing roughly constant whether or not the user exists.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';
    const ok = await verifyPassword(password, hash);
    if (!user || !ok || user.status !== 'active') {
      throw new AuthError('Invalid email or password');
    }
    await userRepo.updateLastLogin(user.id);
    const tokens = await issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  },

  /** Exchange a valid refresh token for a fresh token pair (rotating). */
  async refresh(refreshToken: string): Promise<LoginResult | WorkerSession | ClientSession> {
    const claims = await verifyToken(refreshToken, 'refresh');
    // Worker (Zoho) session: the identity is self-contained in the token, so re-issue directly.
    // There is no users-table row for a `zoho:<id>` principal — a findById would 404.
    // The role is RE-DERIVED before re-signing — never copied from the old token — so rotation
    // migrates stale claims instead of perpetuating them for another refresh-TTL window.
    if (claims.worker) {
      const w = claims.worker;
      const rotated: TokenClaims = {
        ...claims,
        role: workerRoleFor({ userName: w.userName, profile: w.profile, zohoRole: w.zohoRole }),
      };
      const [accessToken, newRefresh] = await Promise.all([
        signAccessToken(rotated),
        signRefreshToken(rotated),
      ]);
      const worker: PublicWorker = {
        zohoUserId: w.zohoUserId,
        userName: w.userName ?? null,
        email: w.email ?? null,
        profile: w.profile ?? null,
        role: w.zohoRole ?? null,
      };
      return { accessToken, refreshToken: newRefresh, tokenType: 'Bearer', worker };
    }
    // Carrier-client session: re-check the account is still active/present before rotating —
    // disabling a carrier user in the admin kills their sessions within one access-token TTL.
    if (claims.client) {
      const row = await carrierUserRepo.findByIdAny(claims.tenantId, claims.client.carrierUserId);
      if (!row || row.status !== 'active') {
        throw new AuthError('Account is no longer active');
      }
      const [accessToken, newRefresh] = await Promise.all([
        signAccessToken(claims),
        signRefreshToken(claims),
      ]);
      return { accessToken, refreshToken: newRefresh, tokenType: 'Bearer', client: claims.client };
    }
    const ctx = contextFromClaims(claims, 'refresh');
    const user = await userRepo.findById(ctx, claims.userId);
    if (!user || user.status !== 'active') {
      throw new AuthError('Account is no longer active');
    }
    const tokens = await issueTokens(user);
    return { ...tokens, user: toPublicUser(user) };
  },

  /** Verify an access token and return the security context for the request. */
  async contextFromAccessToken(token: string, requestId: string): Promise<TenantContext> {
    const claims = await verifyToken(token, 'access');
    return contextFromClaims(claims, requestId);
  },
};
