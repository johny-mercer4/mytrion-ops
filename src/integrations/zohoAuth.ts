/**
 * ZohoAuthService — the shared Zoho auth layer (formerly integrations/wrapper.ts).
 *
 * One place to ask "give me the auth headers for Zoho service X". It hides the per-service
 * OAuth refresh (one self-client app, per-service refresh tokens — see zoho.ts) and caches
 * short-lived access tokens with in-flight dedup, so wrappers/tools never deal with refresh
 * logic. The worker SIGN-IN flow (authorization-code, zohoOAuth.ts) is deliberately separate:
 * that is user-facing OAuth, not vendor API auth.
 *
 * Usage (vendor wrappers go through ZohoWrapper in zohoBase.ts; direct use):
 *   const headers = await authHeaders('zoho_crm');
 *   const res = await fetch(`${baseUrl('zoho_crm')}/settings/modules`, { headers });
 */
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import {
  fetchZohoAccessToken,
  resolveZohoConfig,
  zohoAuthHeader,
  type ZohoService,
  type ZohoToken,
} from './zoho.js';

export type ZohoPlatform = `zoho_${ZohoService}`;
// CMP / EFS / Server CRM own their auth in their wrapper classes (cmp.ts, efs.ts,
// serverCrm.ts) — this layer is Zoho-only.
export type Platform = ZohoPlatform;

/** Refresh a token this many ms before it actually expires, to avoid edge-of-expiry 401s. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedZohoToken {
  token: ZohoToken;
  /** epoch ms when the cached token should be considered stale. */
  expiresAt: number;
}

export class ZohoAuthService {
  private readonly cache = new Map<ZohoService, CachedZohoToken>();
  /** Concurrent refreshes for one service share a single in-flight fetch. */
  private readonly inflight = new Map<ZohoService, Promise<ZohoToken>>();

  /** A valid access token for a service, refreshing + caching as needed. `now` is injectable for tests. */
  async getToken(service: ZohoService, now: number = Date.now()): Promise<ZohoToken> {
    const cached = this.cache.get(service);
    if (cached && cached.expiresAt - EXPIRY_SKEW_MS > now) {
      return cached.token;
    }
    const existing = this.inflight.get(service);
    if (existing) return existing;
    const refresh = (async () => {
      try {
        const cfg = resolveZohoConfig(service);
        const token = await fetchZohoAccessToken(cfg);
        this.cache.set(service, { token, expiresAt: now + token.expiresInSec * 1000 });
        logger.debug({ service, expiresInSec: token.expiresInSec }, 'zoho token refreshed');
        return token;
      } finally {
        this.inflight.delete(service);
      }
    })();
    this.inflight.set(service, refresh);
    return refresh;
  }

  /** Drop ONE service's cached token (post-401 forced refresh without nuking the others). */
  invalidate(service: ZohoService): void {
    this.cache.delete(service);
  }

  /** Clear all cached tokens (tests / forced re-auth). */
  reset(): void {
    this.cache.clear();
    this.inflight.clear();
  }
}

export const zohoAuth = new ZohoAuthService();

export function zohoServiceOf(p: ZohoPlatform): ZohoService {
  return p.slice('zoho_'.length) as ZohoService;
}

/** Get a valid Zoho access token for a service, refreshing + caching as needed. */
export function getZohoToken(service: ZohoService, now: number = Date.now()): Promise<ZohoToken> {
  return zohoAuth.getToken(service, now);
}

/** The base URL configured for a platform (where its API lives). */
export function baseUrl(platform: Platform): string {
  switch (platform) {
    case 'zoho_crm':
      return env.ZOHO_CRM_API_DOMAIN;
    case 'zoho_crm_sandbox':
      // Sandbox REST root derives from the sandbox functions root's origin.
      return `${new URL(env.ZOHO_FUNCTIONS_SANDBOX_BASE_URL).origin}/crm/v8`;
    case 'zoho_desk':
      return env.ZOHO_DESK_BASE_URL;
    case 'zoho_people':
      return env.ZOHO_PEOPLE_BASE_URL;
    case 'zoho_projects':
      return env.ZOHO_PROJECTS_BASE_URL;
  }
}

/** Auth headers to attach to an outbound request for the given platform. */
export async function authHeaders(platform: Platform): Promise<Record<string, string>> {
  const token = await zohoAuth.getToken(zohoServiceOf(platform));
  const headers = zohoAuthHeader(token);
  // Zoho Desk also needs the org id on every call.
  if (platform === 'zoho_desk' && env.ZOHO_DESK_ORG_ID) {
    headers.orgId = env.ZOHO_DESK_ORG_ID;
  }
  return headers;
}

/** Clear cached tokens (tests / forced re-auth). */
export function resetAuthCache(): void {
  zohoAuth.reset();
}

/** Drop ONE service's cached token (post-401 forced refresh without nuking the others). */
export function invalidateZohoToken(service: ZohoService): void {
  zohoAuth.invalidate(service);
}

export const wrapper = { authHeaders, baseUrl, getZohoToken, invalidateZohoToken, resetAuthCache };
