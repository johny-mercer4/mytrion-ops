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
import { fetchWithTimeout } from '../lib/http.js';
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
  const res = await fetchWithTimeout(`${accountsBase()}/oauth/v2/token`, {
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

/** Zoho's accounts-level identity endpoint — the signed-in human, independent of any CRM permission. */
interface ZohoAccountsUserInfo {
  Email?: string;
  Display_Name?: string;
  First_Name?: string;
  Last_Name?: string;
  ZUID?: number;
}

/**
 * Read the worker's CRM user record with THEIR OWN token. Returns null when Zoho refuses on
 * permission/scope grounds so the caller can fall back — any other failure still throws.
 *
 * `GET /users` is gated twice: by the OAuth scope AND by the caller's CRM profile permission on the
 * Users module. Administrator profiles hold that permission, ordinary ones (Sales agents et al) very
 * often do not, so this call succeeds for admins and 403s for everyone else — which is exactly how
 * the outage presented.
 */
async function fetchCrmCurrentUser(accessToken: string): Promise<ZohoWorker | null> {
  const base = env.ZOHO_CRM_API_DOMAIN.replace(/\/+$/, '');
  const res = await fetchWithTimeout(`${base}/users?type=CurrentUser`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // 401 = INVALID_TOKEN / OAUTH_SCOPE_MISMATCH, 403 = NO_PERMISSION. Both mean "this human may not
    // read the Users module", which is recoverable; a 5xx or a network fault is not.
    if (res.status === 401 || res.status === 403) {
      logger.warn(
        { status: res.status, body: text.slice(0, 300) },
        'zoho oauth: CurrentUser denied for this worker — falling back to accounts identity + service-token roster',
      );
      return null;
    }
    throw new AppError(`Zoho CurrentUser lookup failed (HTTP ${res.status})`, {
      statusCode: 502,
      code: 'ZOHO_USER_LOOKUP_FAILED',
      cause: text.slice(0, 200),
      // The Zoho reason is the whole diagnosis; a bare "Internal server error" sent a real outage
      // back as an unactionable 500.
      expose: true,
      details: { zohoStatus: res.status, zohoBody: text.slice(0, 200) },
    });
  }
  const json = (await res.json()) as CrmUsersResponse;
  const u = json.users?.[0];
  if (!u?.id) return null;
  return {
    zohoUserId: u.id,
    fullName: u.full_name ?? null,
    email: u.email ?? null,
    profile: u.profile?.name ?? null,
    role: u.role?.name ?? null,
  };
}

/**
 * Identify the worker without touching the Users module as them, then read their CRM profile/role
 * with the SERVICE token (the same admin-privileged credential Admin → User Management already uses).
 *
 * Split deliberately: the human's token proves WHO signed in, the service token supplies the RBAC
 * facts they are not permitted to read about themselves. Their own token is never used for the roster,
 * so an ordinary profile no longer decides whether login works.
 */
async function fetchWorkerViaAccountsIdentity(accessToken: string): Promise<ZohoWorker> {
  const res = await fetchWithTimeout(`${accountsBase()}/oauth/user/info`, {
    headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new AppError(`Zoho identity lookup failed (HTTP ${res.status})`, {
      statusCode: 502,
      code: 'ZOHO_USER_LOOKUP_FAILED',
      cause: text.slice(0, 200),
      expose: true,
      details: {
        zohoStatus: res.status,
        zohoBody: text.slice(0, 200),
        hint: 'ZOHO_OAUTH_SCOPES must include AaaServer.profile.READ for this fallback; existing workers re-consent on next sign-in.',
      },
    });
  }
  const info = (await res.json().catch(() => ({}))) as ZohoAccountsUserInfo;
  const email = (info.Email ?? '').trim().toLowerCase();
  if (!email) {
    throw new AuthError('Zoho returned no email for the signed-in user, so their CRM record cannot be matched');
  }

  // Imported lazily: the service-token client pulls in the whole Zoho wrapper, and the sign-in path
  // should not carry that cost (or its boot-time config assertions) unless this fallback is reached.
  const { zohoCrm } = await import('./zohoCrm.js');
  const roster = await zohoCrm.listActiveUsers();
  const match = roster.find((u) => (u.email ?? '').trim().toLowerCase() === email);
  if (!match) {
    /**
     * Authenticated with Zoho but not an active CRM user. Sign-in is deliberately still ALLOWED:
     * authentication answers "who are you", and which Mytrion anyone may enter is Mytrion Admin's
     * decision alone — refusing here would put an access rule back in the login path.
     *
     * Keyed `zuid:<id>` because a ZUID is a different id space from a CRM user id. Left bare, it
     * could be mistaken for one by owner-scoped lookups (DWH `agent_zoho_user_id`, act-as targets);
     * prefixed, those simply find nothing and fail closed, which is right for a non-CRM account.
     * `profile`/`role` are null, so with nothing configured this resolves to no Mytrions and the
     * portal shows its "no Mytrion is assigned" screen — signed in, but granted nothing yet.
     */
    if (info.ZUID == null) {
      throw new AuthError('Zoho returned neither a CRM user nor a ZUID, so this sign-in cannot be identified');
    }
    const displayName = info.Display_Name ?? [info.First_Name, info.Last_Name].filter(Boolean).join(' ');
    logger.warn(
      { email, zuid: info.ZUID },
      'zoho oauth: signed-in Zoho account is not an active CRM user — session granted with no profile/role; grant access in Mytrion Admin',
    );
    return {
      zohoUserId: `zuid:${info.ZUID}`,
      fullName: displayName || null,
      email: info.Email ?? null,
      profile: null,
      role: null,
    };
  }
  logger.info(
    { email, profile: match.profile, role: match.role },
    'zoho oauth: identity resolved via accounts userinfo + service-token roster',
  );
  return {
    zohoUserId: match.zohoUserId,
    fullName: match.name,
    email: match.email,
    profile: match.profile,
    role: match.role,
  };
}

/**
 * The signed-in worker's Zoho identity → the RBAC fields (id / name / email / profile / role).
 *
 * Tries the worker's own token first (one call, and it is authoritative when permitted), then falls
 * back to accounts identity + the service-token roster for the majority of profiles that may not read
 * the Users module.
 */
export async function fetchCurrentUser(accessToken: string): Promise<ZohoWorker> {
  const direct = await fetchCrmCurrentUser(accessToken);
  if (direct) return direct;
  return fetchWorkerViaAccountsIdentity(accessToken);
}
