/**
 * Zoho OAuth (authorization-code) for WORKER sign-in — distinct from integrations/zoho.ts (which
 * refreshes long-lived service tokens for tool calls). Here a human employee logs in with their
 * own Zoho account: we build the authorize URL, exchange the returned code for an access token
 * using the confidential server-app secret, and read their CRM user record (id/name/email/
 * profile/role) to drive RBAC.
 *
 * The redirect URI is registered on the Zoho server app and must byte-match ZOHO_OAUTH_REDIRECT_URI;
 * Zoho sends the browser back there with ?code&state, and the SPA relays it to the callback route.
 */
import { env } from '../config/env.js';
import { AppError, AuthError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

function accountsBase(): string {
  return env.ZOHO_ACCOUNTS_DOMAIN.replace(/\/+$/, '');
}

/**
 * The Zoho authorization URL to send the worker's browser to.
 *
 * We deliberately DON'T send `prompt=consent` or `access_type=offline`:
 *  - We only need a one-shot access token to read the worker's CurrentUser; we never persist Zoho's
 *    refresh token (our own JWT is the session), so offline access is pointless.
 *  - `prompt=consent` forces Zoho's consent + org-picker screen on EVERY login. Omitting it means
 *    Zoho shows it only on the first authorization and then reuses the worker's choice, so returning
 *    workers go straight through. (The org-picker itself only ever appears for accounts that belong
 *    to more than one CRM org; single-org employees never see it — there is no authorize-URL param
 *    to pre-select an org or suppress the picker; it's Zoho-side consent UI.)
 */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: env.ZOHO_SERVER_CLIENT_ID,
    scope: env.ZOHO_OAUTH_SCOPES,
    redirect_uri: env.ZOHO_OAUTH_REDIRECT_URI,
    state,
  });
  return `${accountsBase()}/oauth/v2/auth?${params.toString()}`;
}

interface ZohoTokenResponse {
  access_token?: string;
  error?: string;
}

/** Exchange the one-time authorization code for an access token (confidential-client, server-side). */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.ZOHO_SERVER_CLIENT_ID,
    client_secret: env.ZOHO_SERVER_CLIENT_SECRET,
    redirect_uri: env.ZOHO_OAUTH_REDIRECT_URI,
    code,
  });
  const res = await fetch(`${accountsBase()}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as ZohoTokenResponse;
  if (!res.ok || !json.access_token) {
    logger.warn({ status: res.status, error: json.error }, 'zoho oauth code exchange failed');
    // 'invalid_code' is the common expired/replayed-code case → surface as an auth failure.
    throw new AuthError(`Zoho code exchange failed${json.error ? `: ${json.error}` : ''}`);
  }
  return json.access_token;
}

export interface ZohoWorker {
  zohoUserId: string;
  fullName: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
}

interface CrmUsersResponse {
  users?: Array<{
    id?: string;
    full_name?: string;
    email?: string;
    profile?: { name?: string } | null;
    role?: { name?: string } | null;
  }>;
}

/** Read the signed-in worker's CRM user record (type=CurrentUser) → the RBAC identity fields. */
export async function fetchCurrentUser(accessToken: string): Promise<ZohoWorker> {
  const base = env.ZOHO_CRM_API_DOMAIN.replace(/\/+$/, '');
  const res = await fetch(`${base}/users?type=CurrentUser`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError(`Zoho CurrentUser lookup failed (HTTP ${res.status})`, {
      statusCode: 502,
      code: 'ZOHO_USER_LOOKUP_FAILED',
      cause: text.slice(0, 200),
    });
  }
  const json = (await res.json()) as CrmUsersResponse;
  const u = json.users?.[0];
  if (!u?.id) {
    throw new AuthError('Zoho returned no current-user record (is the ZohoCRM.users.READ scope granted?)');
  }
  return {
    zohoUserId: u.id,
    fullName: u.full_name ?? null,
    email: u.email ?? null,
    profile: u.profile?.name ?? null,
    role: u.role?.name ?? null,
  };
}
