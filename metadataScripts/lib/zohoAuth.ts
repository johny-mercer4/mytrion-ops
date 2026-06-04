/**
 * Zoho OAuth helper for the metadata analyzers.
 *
 * One self-client app (ZOHO_CLIENT_ID/SECRET) typically backs all Zoho services, but
 * each service needs a refresh token minted with that service's scopes — so tokens are
 * resolved per service, falling back to a shared ZOHO_REFRESH_TOKEN when present.
 *
 * Token exchange: POST {accountsDomain}/oauth/v2/token  (grant_type=refresh_token)
 * API calls authenticate with header `Authorization: Zoho-oauthtoken <access_token>`.
 */
import { env } from '../../src/config/env.js';

export type ZohoService = 'crm' | 'desk' | 'people' | 'projects';

export interface ZohoServiceConfig {
  service: ZohoService;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accountsDomain: string;
}

export interface ZohoToken {
  accessToken: string;
  /** Returned by Zoho on refresh; CRM calls should prefer it over a configured domain. */
  apiDomain: string | undefined;
}

interface TokenResponse {
  access_token?: string;
  api_domain?: string;
  expires_in?: number;
  error?: string;
}

const REFRESH_TOKEN_BY_SERVICE: Record<ZohoService, string> = {
  crm: env.ZOHO_CRM_REFRESH_TOKEN,
  desk: env.ZOHO_DESK_REFRESH_TOKEN,
  people: env.ZOHO_PEOPLE_REFRESH_TOKEN,
  projects: env.ZOHO_PROJECTS_REFRESH_TOKEN,
};

/** Resolve client creds + refresh token for a service, with shared-app fallbacks. */
export function resolveZohoConfig(service: ZohoService): ZohoServiceConfig {
  const clientId = env.ZOHO_CLIENT_ID || env.ZOHO_CRM_CLIENT_ID;
  const clientSecret = env.ZOHO_CLIENT_SECRET || env.ZOHO_CRM_CLIENT_SECRET;
  const refreshToken = REFRESH_TOKEN_BY_SERVICE[service] || env.ZOHO_REFRESH_TOKEN;

  const missing: string[] = [];
  if (!clientId) missing.push('ZOHO_CLIENT_ID');
  if (!clientSecret) missing.push('ZOHO_CLIENT_SECRET');
  if (!refreshToken) missing.push(`ZOHO_${service.toUpperCase()}_REFRESH_TOKEN`);
  if (missing.length > 0) {
    throw new Error(
      `[zoho:${service}] missing env: ${missing.join(', ')} — set them in .env and retry`,
    );
  }

  return {
    service,
    clientId,
    clientSecret,
    refreshToken,
    accountsDomain: env.ZOHO_ACCOUNTS_DOMAIN,
  };
}

/** Exchange a refresh token for a short-lived access token. */
export async function fetchZohoAccessToken(cfg: ZohoServiceConfig): Promise<ZohoToken> {
  const url = new URL('/oauth/v2/token', cfg.accountsDomain);
  url.searchParams.set('refresh_token', cfg.refreshToken);
  url.searchParams.set('client_id', cfg.clientId);
  url.searchParams.set('client_secret', cfg.clientSecret);
  url.searchParams.set('grant_type', 'refresh_token');

  const res = await fetch(url, { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !body.access_token) {
    throw new Error(
      `[zoho:${cfg.service}] token refresh failed (HTTP ${res.status}): ${body.error ?? 'no access_token in response'}`,
    );
  }
  return { accessToken: body.access_token, apiDomain: body.api_domain };
}

/** Authorization header for Zoho API calls. */
export function zohoAuthHeader(token: ZohoToken): Record<string, string> {
  return { Authorization: `Zoho-oauthtoken ${token.accessToken}` };
}
