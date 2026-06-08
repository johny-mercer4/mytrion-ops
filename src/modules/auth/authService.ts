import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import type { User } from '../../db/schema/index.js';
import { AuthError } from '../../lib/errors.js';
import { userRepo } from '../../repos/userRepo.js';
import type { Audience, Role, TenantContext } from '../../types/tenantContext.js';
import { signAccessToken, signRefreshToken, verifyToken, type TokenClaims } from './jwt.js';
import { verifyPassword } from './password.js';
import { scopesForRole } from './permissions.js';

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
  async refresh(refreshToken: string): Promise<LoginResult> {
    const claims = await verifyToken(refreshToken, 'refresh');
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
