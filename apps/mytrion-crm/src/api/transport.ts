/**
 * Core request transport for the Mytrion Ops backend. The app is same-origin with the API in
 * production (plain fetch to '/v1/*'); in dev it talks to a cross-origin backend.
 *
 * Auth: a signed-in worker sends `Authorization: Bearer <accessToken>` from the Zoho OAuth session.
 * Absent a session we fall back to the dev API key (cross-origin local backend) — production
 * same-origin sends neither and relies on the session. On a 401 we transparently refresh the token
 * once and retry, so a 15-minute access-token expiry never surfaces to the user mid-session.
 */
import { devApiKey, resolveApiConfig, v1Url } from './config';
import { clearSession, getSession, setSession, type SessionWorker } from './session';
import { actAsHeaders } from './impersonation';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
  /** Set false to send AS the real admin (no act-as headers) — e.g. listing agents to impersonate. */
  impersonate?: boolean;
  /** Extra request headers (e.g. `x-department-access` to assert the caller's department scope). */
  headers?: Record<string, string> | undefined;
}

/** Session Bearer (else dev API key). No impersonation headers — the base principal. */
function principalHeaders(): Record<string, string> {
  const token = getSession()?.accessToken;
  if (token) return { Authorization: `Bearer ${token}` };
  const key = devApiKey();
  return key ? { 'x-api-key': key } : {};
}

/**
 * Auth headers for a request: the principal (Bearer/key) plus, when impersonating, the x-act-as-*
 * headers so the backend runs as the picked agent. Pass `impersonate:false` to omit act-as.
 */
export function authHeaders(impersonate = true): Record<string, string> {
  return impersonate ? { ...principalHeaders(), ...actAsHeaders() } : principalHeaders();
}

// De-duplicate concurrent refreshes: many in-flight requests hitting 401 at once share one refresh.
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotate the access token using the stored refresh token. Returns true if a fresh token was stored.
 * Uses a bare fetch (not `request`) so it never recurses through the 401-refresh path. On any
 * failure the session is cleared so the app falls back to the login gate.
 */
export async function refreshBearer(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const s = getSession();
    if (!s?.refreshToken) return false;
    const { baseUrl } = resolveApiConfig();
    try {
      const res = await fetch(v1Url(baseUrl, '/auth/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: s.refreshToken }),
        credentials: 'same-origin',
      });
      if (!res.ok) {
        // Only a definitive auth rejection (expired/invalid/malformed refresh token) ends the
        // session. Transient failures — 5xx, a deploy in progress, a proxy hiccup — must NOT log
        // the worker out; keep the session so the next attempt can succeed once the backend is back.
        if (res.status === 400 || res.status === 401 || res.status === 403) clearSession();
        return false;
      }
      const json = (await res.json()) as {
        accessToken?: string;
        refreshToken?: string;
        worker?: SessionWorker;
      };
      if (!json.accessToken || !json.refreshToken) {
        clearSession();
        return false;
      }
      setSession({
        accessToken: json.accessToken,
        refreshToken: json.refreshToken,
        worker: json.worker ?? s.worker,
      });
      return true;
    } catch {
      return false; // network blip — keep the session, let the caller surface the error
    }
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const { baseUrl } = resolveApiConfig();
  let url = v1Url(baseUrl, path);
  if (query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

export async function request(
  method: 'GET' | 'POST',
  path: string,
  opts: RequestOptions = {},
): Promise<unknown> {
  const url = buildUrl(path, opts.query);

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...authHeaders(opts.impersonate !== false), ...(opts.headers ?? {}) };
    if (method !== 'GET') headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      ...(method !== 'GET' ? { body: JSON.stringify(opts.body ?? {}) } : {}),
    });
  };

  let res: Response;
  try {
    res = await doFetch();
    // Session expired mid-use: refresh once and retry (only when we actually hold a session).
    if (res.status === 401 && getSession() && (await refreshBearer())) {
      res = await doFetch();
    }
  } catch (e) {
    throw new ApiError(`Could not reach the backend. ${(e as Error)?.message ?? ''}`, 'NETWORK', 0);
  }

  const raw = await res.text();
  let json: unknown = null;
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
  }

  if (!res.ok) {
    const err =
      json && typeof json === 'object' ? (json as { error?: { message?: string; code?: string } }).error : null;
    throw new ApiError(
      err?.message ?? `Backend returned HTTP ${res.status}.`,
      err?.code ?? `HTTP_${res.status}`,
      res.status,
    );
  }
  return json;
}
