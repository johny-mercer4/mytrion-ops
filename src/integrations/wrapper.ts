/**
 * Wrapper — the parent auth layer for all outbound platform integrations.
 *
 * One place to ask "give me the auth headers for platform X". It hides each platform's
 * auth mechanism (Zoho OAuth refresh, CMP API key, …) and caches short-lived tokens so
 * callers (tools, services) never deal with refresh logic. Add new platforms by extending
 * the Platform union and registering a provider below.
 *
 * Usage:
 *   const headers = await wrapper.authHeaders('zoho_crm');
 *   const res = await fetch(`${base}/settings/modules`, { headers });
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
export type Platform = ZohoPlatform | 'cmp';

/** Refresh a token this many ms before it actually expires, to avoid edge-of-expiry 401s. */
const EXPIRY_SKEW_MS = 60_000;

interface CachedZohoToken {
  token: ZohoToken;
  /** epoch ms when the cached token should be considered stale. */
  expiresAt: number;
}

const zohoTokenCache = new Map<ZohoService, CachedZohoToken>();

function isZohoPlatform(p: Platform): p is ZohoPlatform {
  return p.startsWith('zoho_');
}

function zohoServiceOf(p: ZohoPlatform): ZohoService {
  return p.slice('zoho_'.length) as ZohoService;
}

/**
 * Get a valid Zoho access token for a service, refreshing + caching as needed.
 * `now` is injectable for tests.
 */
export async function getZohoToken(service: ZohoService, now: number = Date.now()): Promise<ZohoToken> {
  const cached = zohoTokenCache.get(service);
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > now) {
    return cached.token;
  }
  const cfg = resolveZohoConfig(service);
  const token = await fetchZohoAccessToken(cfg);
  zohoTokenCache.set(service, { token, expiresAt: now + token.expiresInSec * 1000 });
  logger.debug({ service, expiresInSec: token.expiresInSec }, 'zoho token refreshed');
  return token;
}

/** CMP (our custom Node server) auth headers from a static API key. */
function cmpAuthHeaders(): Record<string, string> {
  if (!env.CMP_API_KEY) {
    throw new Error('[cmp] CMP_API_KEY is not configured');
  }
  const headerName = env.CMP_AUTH_HEADER || 'Authorization';
  const value = headerName === 'Authorization' ? `Bearer ${env.CMP_API_KEY}` : env.CMP_API_KEY;
  return { [headerName]: value };
}

/** The base URL configured for a platform (where its API lives). */
export function baseUrl(platform: Platform): string {
  switch (platform) {
    case 'zoho_crm':
      return env.ZOHO_CRM_API_DOMAIN;
    case 'zoho_desk':
      return env.ZOHO_DESK_BASE_URL;
    case 'zoho_people':
      return env.ZOHO_PEOPLE_BASE_URL;
    case 'zoho_projects':
      return env.ZOHO_PROJECTS_BASE_URL;
    case 'cmp':
      return env.CMP_BASE_URL;
  }
}

/** Auth headers to attach to an outbound request for the given platform. */
export async function authHeaders(platform: Platform): Promise<Record<string, string>> {
  if (isZohoPlatform(platform)) {
    const token = await getZohoToken(zohoServiceOf(platform));
    const headers = zohoAuthHeader(token);
    // Zoho Desk also needs the org id on every call.
    if (platform === 'zoho_desk' && env.ZOHO_DESK_ORG_ID) {
      headers.orgId = env.ZOHO_DESK_ORG_ID;
    }
    return headers;
  }
  if (platform === 'cmp') {
    return cmpAuthHeaders();
  }
  // Exhaustiveness guard — unreachable while Platform is fully handled above.
  throw new Error(`[wrapper] no auth provider for platform: ${String(platform)}`);
}

/** Clear cached tokens (tests / forced re-auth). */
export function resetAuthCache(): void {
  zohoTokenCache.clear();
}

export const wrapper = { authHeaders, baseUrl, getZohoToken, resetAuthCache };
