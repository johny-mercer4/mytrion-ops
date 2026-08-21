/**
 * Per-user Zoho CRM auth and write helpers.
 *
 * Workers authenticate via Zoho OAuth as their own registered Zoho user. By storing their
 * refresh token (written during login by zohoAuthService) we can make CRM write calls as that
 * specific user so that Zoho's "Created By" / "Modified By" fields reflect the real agent rather
 * than the shared service account (John Mercer).
 *
 * Falls back gracefully: if no token is stored (pre-existing worker, token expired past recovery,
 * or Zoho refresh failure) every function returns null and the caller falls back to the service
 * account path. Failures are logged but never thrown.
 */
import { env } from '../config/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { workerZohoTokenRepo } from '../repos/workerZohoTokenRepo.js';

const EXPIRY_SKEW_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

/** In-process access-token cache. Key: `${tenantId}:${zohoUserId}`. */
const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string | null>>();

function cacheKey(tenantId: string, zohoUserId: string): string {
  return `${tenantId}:${zohoUserId}`;
}

function accountsBase(): string {
  return env.ZOHO_ACCOUNTS_DOMAIN.replace(/\/+$/, '');
}

async function refreshViaStoredToken(
  tenantId: string,
  zohoUserId: string,
  now: number,
): Promise<string | null> {
  const refreshToken = await workerZohoTokenRepo.find(tenantId, zohoUserId);
  if (!refreshToken) return null;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.ZOHO_SERVER_CLIENT_ID,
    client_secret: env.ZOHO_SERVER_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  try {
    const res = await fetchWithTimeout(`${accountsBase()}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      logger.warn({ zohoUserId, status: res.status, error: json.error }, 'zoho user token refresh failed');
      return null;
    }
    const expiresInMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
    tokenCache.set(cacheKey(tenantId, zohoUserId), {
      accessToken: json.access_token,
      expiresAt: now + expiresInMs,
    });
    return json.access_token;
  } catch (err) {
    logger.warn({ err, zohoUserId }, 'zoho user token refresh network error');
    return null;
  }
}

/** Get a valid Zoho access token for a worker. Returns null if none is available. */
export async function getUserAccessToken(
  tenantId: string,
  zohoUserId: string,
  now: number = Date.now(),
): Promise<string | null> {
  const key = cacheKey(tenantId, zohoUserId);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > now) return cached.accessToken;

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = refreshViaStoredToken(tenantId, zohoUserId, now).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, work);
  return work;
}

/** Drop a user's cached access token (call after a 401 to force re-read on next request). */
export function invalidateUserToken(tenantId: string, zohoUserId: string): void {
  tokenCache.delete(cacheKey(tenantId, zohoUserId));
}

interface MutationRow {
  code?: string;
  status?: string;
  details?: { id?: string };
  message?: string;
}

/**
 * Insert a Zoho CRM Notes record using the agent's own access token so that "Created By"
 * reflects the real agent. Returns the new note id, or null if the user token is unavailable
 * or the call fails (caller falls back to the service-account path).
 */
export async function insertNoteAsUser(
  tenantId: string,
  zohoUserId: string,
  noteData: Record<string, unknown>,
): Promise<string | null> {
  const accessToken = await getUserAccessToken(tenantId, zohoUserId);
  if (!accessToken) return null;

  const base = env.ZOHO_CRM_API_DOMAIN.replace(/\/+$/, '');
  try {
    const res = await fetchWithTimeout(`${base}/Notes`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: [noteData] }),
    });
    if (res.status === 401) {
      invalidateUserToken(tenantId, zohoUserId);
      return null;
    }
    const json = (await res.json().catch(() => ({}))) as { data?: MutationRow[] };
    const row = json.data?.[0];
    if (!row || row.status !== 'success' || !row.details?.id) {
      logger.warn({ zohoUserId, code: row?.code, message: row?.message }, 'zoho user note insert non-success');
      return null;
    }
    return row.details.id;
  } catch (err) {
    logger.warn({ err, zohoUserId }, 'zoho user note insert error');
    return null;
  }
}
