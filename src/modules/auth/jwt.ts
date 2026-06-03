import { SignJWT, jwtVerify } from 'jose';
import { env, isProduction } from '../../config/env.js';
import { AuthError } from '../../lib/errors.js';
import { isAudience, isRole, type Audience, type Role } from '../../types/tenantContext.js';

const ISSUER = 'octane-assistant';
const DEV_FALLBACK_SECRET = 'dev-insecure-jwt-secret-do-not-use-in-prod';

type TokenType = 'access' | 'refresh';

export interface TokenClaims {
  userId: string;
  tenantId: string;
  audience: Audience;
  role: Role;
}

function secretKey(): Uint8Array {
  const secret = env.JWT_SECRET || (isProduction ? '' : DEV_FALLBACK_SECRET);
  if (!secret) throw new AuthError('JWT_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

async function sign(claims: TokenClaims, type: TokenType, ttl: string): Promise<string> {
  return new SignJWT({
    tenantId: claims.tenantId,
    audienceKind: claims.audience,
    role: claims.role,
    tokenType: type,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(secretKey());
}

export function signAccessToken(claims: TokenClaims): Promise<string> {
  return sign(claims, 'access', env.JWT_ACCESS_TTL);
}

export function signRefreshToken(claims: TokenClaims): Promise<string> {
  return sign(claims, 'refresh', env.JWT_REFRESH_TTL);
}

/** Verify a token's signature, issuer, expiry, and shape. Throws AuthError otherwise. */
export async function verifyToken(token: string, expectedType: TokenType): Promise<TokenClaims> {
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(token, secretKey(), { issuer: ISSUER });
    payload = result.payload as Record<string, unknown>;
  } catch (err) {
    throw new AuthError('Invalid or expired token', { cause: err });
  }

  const { sub, tenantId, audienceKind, role, tokenType } = payload;
  if (tokenType !== expectedType) {
    throw new AuthError(`Expected a ${expectedType} token`);
  }
  if (
    typeof sub !== 'string' ||
    typeof tenantId !== 'string' ||
    !isAudience(audienceKind) ||
    !isRole(role)
  ) {
    throw new AuthError('Malformed token claims');
  }

  return { userId: sub, tenantId, audience: audienceKind, role };
}
