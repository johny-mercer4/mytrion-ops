/**
 * CMP wrapper — auth only (for now). CMP is our custom Node server (SMP/fuel manager) with a
 * simple login: POST {baseUrl}/api/authenticate {username,password} -> bearer token. Token is
 * cached per environment with TTL + in-flight dedup (see tokenCache); force-refresh after a 401.
 *
 * Pattern borrowed from servercrm/services/cmpAuth.js. Defaults to the SANDBOX environment.
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createTokenProvider, type TokenProvider } from './tokenCache.js';

export type CmpEnvironment = 'sandbox' | 'production';

// CMP tokens are short-lived JWTs (~60 min). Refresh proactively at ~50 min.
const CMP_TOKEN_TTL_MS = 50 * 60 * 1000;

interface CmpCredentials {
  baseUrl: string;
  username: string;
  password: string;
}

interface CmpAuthResponse {
  token?: string;
  id_token?: string;
  access_token?: string;
}

/** The environment the wrapper uses unless one is passed explicitly. */
export function activeCmpEnvironment(): CmpEnvironment {
  return env.CMP_ENV === 'production' ? 'production' : 'sandbox';
}

function resolveCmpCredentials(environment: CmpEnvironment): CmpCredentials {
  const raw =
    environment === 'production'
      ? { baseUrl: env.CMP_PRODUCTION_URL, username: env.CMP_PRODUCTION_LOGIN, password: env.CMP_PRODUCTION_PASSWORD }
      : { baseUrl: env.CMP_SANDBOX_URL, username: env.CMP_SANDBOX_LOGIN, password: env.CMP_SANDBOX_PASSWORD };

  const prefix = environment === 'production' ? 'CMP_PRODUCTION' : 'CMP_SANDBOX';
  const missing: string[] = [];
  if (!raw.baseUrl) missing.push(`${prefix}_URL`);
  if (!raw.username) missing.push(`${prefix}_LOGIN`);
  if (!raw.password) missing.push(`${prefix}_PASSWORD`);
  if (missing.length > 0) {
    throw new Error(`[cmp:${environment}] missing env: ${missing.join(', ')}`);
  }
  return { baseUrl: raw.baseUrl.replace(/\/+$/, ''), username: raw.username, password: raw.password };
}

/** Base URL (trailing slash stripped) for the given/active environment. */
export function cmpBaseUrl(environment: CmpEnvironment = activeCmpEnvironment()): string {
  return resolveCmpCredentials(environment).baseUrl;
}

async function authenticate(environment: CmpEnvironment): Promise<string> {
  const { baseUrl, username, password } = resolveCmpCredentials(environment);
  const url = `${baseUrl}/api/authenticate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const body = (await res.json().catch(() => ({}))) as CmpAuthResponse;
  if (!res.ok) {
    throw new Error(`[cmp:${environment}] authentication failed (HTTP ${res.status})`);
  }
  const token = body.token ?? body.id_token ?? body.access_token;
  if (!token) {
    throw new Error(`[cmp:${environment}] authentication returned no token`);
  }
  logger.debug({ environment }, 'cmp token refreshed');
  return token;
}

const providers = new Map<CmpEnvironment, TokenProvider<string>>();

function providerFor(environment: CmpEnvironment): TokenProvider<string> {
  let provider = providers.get(environment);
  if (!provider) {
    provider = createTokenProvider({
      ttlMs: CMP_TOKEN_TTL_MS,
      skewMs: 60_000,
      fetch: () => authenticate(environment),
    });
    providers.set(environment, provider);
  }
  return provider;
}

/** A valid CMP bearer token (cached). */
export function getCmpToken(environment: CmpEnvironment = activeCmpEnvironment()): Promise<string> {
  return providerFor(environment).get();
}

/** Auth + content-type headers for CMP API calls. */
export async function cmpAuthHeaders(
  environment: CmpEnvironment = activeCmpEnvironment(),
): Promise<Record<string, string>> {
  const token = await getCmpToken(environment);
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

/** Re-authenticate immediately (use after a downstream 401). */
export function forceRefreshCmpToken(
  environment: CmpEnvironment = activeCmpEnvironment(),
): Promise<string> {
  return providerFor(environment).forceRefresh();
}

/** Drop all cached CMP tokens (tests / forced re-auth). */
export function clearCmpTokenCache(): void {
  for (const provider of providers.values()) provider.clear();
  providers.clear();
}
