import { SignJWT, jwtVerify } from 'jose';
import { env, isProduction } from '../../config/env.js';
import { AuthError } from '../../lib/errors.js';
import { isAudience, isRole, type Audience, type Role } from '../../types/tenantContext.js';

const ISSUER = 'octane-assistant';
const DEV_FALLBACK_SECRET = 'dev-insecure-jwt-secret-do-not-use-in-prod';

type TokenType = 'access' | 'refresh';

/**
 * Verified worker identity embedded in a session token (from Zoho OAuth). Once a worker is logged
 * in, this is the SOURCE OF TRUTH for RBAC — the backend derives the context from these claims and
 * ignores client-supplied identity in the request body (no id spoofing / self-escalation).
 */
export interface WorkerIdentity {
  zohoUserId: string;
  userName?: string;
  email?: string;
  profile?: string;
  zohoRole?: string;
}

export interface TokenClaims {
  userId: string;
  tenantId: string;
  audience: Audience;
  role: Role;
  /** Present for Zoho-worker sessions; absent on the dormant email/password + system paths. */
  worker?: WorkerIdentity;
}

function parseWorker(raw: unknown): WorkerIdentity | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const r = raw as Record<string, unknown>;
  if (typeof r['zohoUserId'] !== 'string' || r['zohoUserId'].length === 0) return undefined;
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);
  const w: WorkerIdentity = { zohoUserId: r['zohoUserId'] };
  const userName = str(r['userName']);
  const email = str(r['email']);
  const profile = str(r['profile']);
  const zohoRole = str(r['zohoRole']);
  if (userName) w.userName = userName;
  if (email) w.email = email;
  if (profile) w.profile = profile;
  if (zohoRole) w.zohoRole = zohoRole;
  return w;
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
    ...(claims.worker ? { worker: claims.worker } : {}),
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

  const worker = parseWorker(payload['worker']);
  return { userId: sub, tenantId, audience: audienceKind, role, ...(worker ? { worker } : {}) };
}

// ── Short-lived signed OAuth state (CSRF for the Zoho login redirect) ────────────────────────
const OAUTH_STATE_TTL = '10m';

/** Sign an opaque, tamper-proof state value the SPA echoes back through the Zoho redirect. */
export async function signOauthState(nonce: string): Promise<string> {
  return new SignJWT({ nonce, use: 'zoho-oauth-state' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(OAUTH_STATE_TTL)
    .sign(secretKey());
}

/** Verify the state came from us and hasn't expired. Throws AuthError otherwise. */
export async function verifyOauthState(state: string): Promise<void> {
  try {
    const { payload } = await jwtVerify(state, secretKey(), { issuer: ISSUER });
    if (payload['use'] !== 'zoho-oauth-state') throw new Error('wrong state use');
  } catch (err) {
    throw new AuthError('Invalid or expired OAuth state', { cause: err });
  }
}
