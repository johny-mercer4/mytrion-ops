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
  retryAfterMs: number | null;
  constructor(message: string, code = 'ERROR', status = 0, retryAfterMs: number | null = null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
  /** Set false to send AS the real admin (no act-as headers) — e.g. listing agents to impersonate. */
  impersonate?: boolean;
  /** Extra request headers (e.g. `x-department-access` to assert the caller's department scope). */
  headers?: Record<string, string> | undefined;
  /** Abort an in-flight request — for search-as-you-type, where a stale reply must not win. An
   * aborted fetch surfaces as an ApiError('NETWORK'), so callers check `signal.aborted` before
   * treating the rejection as a real failure. */
  signal?: AbortSignal | undefined;
  /** Per-request timeout. Defaults to 20s; expensive exports should opt into a larger value. */
  timeoutMs?: number | undefined;
  /** Disable the one controlled retry for idempotent GET requests. */
  retry?: boolean | undefined;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const READ_RETRY_STATUSES = new Set([429, 502, 503, 504]);
const getInflight = new Map<string, Promise<unknown>>();

function retryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : null;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const onAbort = (): void => controller.abort(externalSignal?.reason);
  if (externalSignal?.aborted) onAbort();
  else externalSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw new ApiError('The backend took too long to respond.', 'TIMEOUT', 0);
    throw error;
  } finally {
    window.clearTimeout(timer);
    externalSignal?.removeEventListener('abort', onAbort);
  }
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
        // Refresh responses intentionally carry only the verified Zoho identity. Preserve the
        // DB-resolved access fields already held by the session until /auth/me refreshes them.
        worker: json.worker ? { ...s.worker, ...json.worker } : s.worker,
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
      // Keep numeric 0 (Desk search pages with from=0). Only skip null/undefined/''.
      if (v === undefined || v === null) continue;
      if (typeof v === 'string' && v === '') continue;
      qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }
  return url;
}

/**
 * POST a multipart/form-data body (fields + optional file). Same auth + 401-refresh + ApiError
 * handling as `request`, but the browser sets the multipart Content-Type (with boundary) itself —
 * so we must NOT set it. Used for ticket / escalation creation with an attachment.
 */
export async function requestMultipart(
  path: string,
  form: FormData,
  opts: {
    headers?: Record<string, string>;
    impersonate?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const url = buildUrl(path);
  const doFetch = (): Promise<Response> =>
    fetchWithTimeout(url, {
      method: 'POST',
      headers: { ...authHeaders(opts.impersonate !== false), ...(opts.headers ?? {}) },
      credentials: 'same-origin',
      body: form,
    }, opts.timeoutMs ?? 45_000, opts.signal);
  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && getSession() && (await refreshBearer())) res = await doFetch();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    ) {
      throw e;
    }
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
    const err = json && typeof json === 'object' ? (json as { error?: { message?: string; code?: string } }).error : null;
    throw new ApiError(
      err?.message ?? `Backend returned HTTP ${res.status}.`,
      err?.code ?? `HTTP_${res.status}`,
      res.status,
      retryAfterMs(res),
    );
  }
  return json;
}

/** GET a binary response (attachment download) as a Blob, with the same auth + 401-refresh. */
export async function requestBlob(
  path: string,
  opts: {
    headers?: Record<string, string>;
    signal?: AbortSignal;
    timeoutMs?: number;
    query?: RequestOptions['query'];
  } = {},
): Promise<Blob> {
  const url = buildUrl(path, opts.query);
  const doFetch = (): Promise<Response> =>
    fetchWithTimeout(
      url,
      { headers: { ...authHeaders(true), ...(opts.headers ?? {}) }, credentials: 'same-origin' },
      opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      opts.signal,
    );
  let res: Response;
  try {
    res = await doFetch();
    if (res.status === 401 && getSession() && (await refreshBearer())) res = await doFetch();
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    ) {
      throw e;
    }
    throw new ApiError(`Could not reach the backend. ${(e as Error)?.message ?? ''}`, 'NETWORK', 0);
  }
  if (!res.ok) {
    throw new ApiError(
      `Download failed (HTTP ${res.status}).`,
      `HTTP_${res.status}`,
      res.status,
      retryAfterMs(res),
    );
  }
  return res.blob();
}

export async function request(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: RequestOptions = {},
): Promise<unknown> {
  const url = buildUrl(path, opts.query);

  // Join identical GETs across shell badges and tabs. Requests with caller-owned AbortSignals stay
  // independent so cancelling a search never cancels another consumer's valid read.
  if (method === 'GET' && !opts.signal) {
    const identityHeaders = authHeaders(opts.impersonate !== false);
    const identity = Object.entries(identityHeaders)
      .filter(([key]) => key !== 'Authorization' && key !== 'x-api-key')
      .sort(([a], [b]) => a.localeCompare(b));
    const principal = getSession()?.worker.zohoUserId ?? 'anonymous';
    const key = `${principal}:${url}:${JSON.stringify(identity)}:${JSON.stringify(opts.headers ?? {})}`;
    const running = getInflight.get(key);
    if (running) return running;
    const promise = requestOnce(method, path, opts).finally(() => {
      if (getInflight.get(key) === promise) getInflight.delete(key);
    });
    getInflight.set(key, promise);
    return promise;
  }
  return requestOnce(method, path, opts);
}

async function requestOnce(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: RequestOptions,
): Promise<unknown> {
  const url = buildUrl(path, opts.query);

  const doFetch = async (): Promise<Response> => {
    const headers: Record<string, string> = { ...authHeaders(opts.impersonate !== false), ...(opts.headers ?? {}) };
    if (method !== 'GET') headers['Content-Type'] = 'application/json';
    return fetchWithTimeout(url, {
      method,
      headers,
      credentials: 'same-origin',
      ...(method !== 'GET' ? { body: JSON.stringify(opts.body ?? {}) } : {}),
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  };

  let res: Response;
  try {
    res = await doFetch();
    // Session expired mid-use: refresh once and retry (only when we actually hold a session).
    if (res.status === 401 && getSession() && (await refreshBearer())) {
      res = await doFetch();
    }
    if (
      method === 'GET' &&
      opts.retry !== false &&
      !opts.signal &&
      READ_RETRY_STATUSES.has(res.status)
    ) {
      const vendorDelay = retryAfterMs(res);
      await wait(Math.min(5_000, vendorDelay ?? 450 + Math.floor(Math.random() * 250)));
      res = await doFetch();
    }
  } catch (e) {
    if (e instanceof ApiError) throw e;
    // Preserve abort so callers (search-as-you-type) can ignore cancelled requests.
    if (
      (e instanceof DOMException && e.name === 'AbortError') ||
      (e instanceof Error && e.name === 'AbortError')
    ) {
      throw e;
    }
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
      retryAfterMs(res),
    );
  }
  return json;
}
