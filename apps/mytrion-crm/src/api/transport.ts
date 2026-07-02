/**
 * Core request transport for the Mytrion Ops backend. The app is same-origin with the API now, so
 * this is a plain fetch to '/v1/*' (no Zoho HTTP proxy, no wrapper-peeling). The backend returns the
 * payload directly on success and `{ error: { message, code } }` with a 4xx/5xx on failure.
 */
import { devApiKey, resolveApiConfig, v1Url } from './config';

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
}

/** Auth headers: a dev key only when talking to a cross-origin dev backend; empty in prod. */
export function authHeaders(): Record<string, string> {
  const key = devApiKey();
  return key ? { 'x-api-key': key } : {};
}

export async function request(
  method: 'GET' | 'POST',
  path: string,
  opts: RequestOptions = {},
): Promise<unknown> {
  const { baseUrl } = resolveApiConfig();
  let url = v1Url(baseUrl, path);
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = { ...authHeaders() };
  if (method !== 'GET') headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      credentials: 'same-origin',
      ...(method !== 'GET' ? { body: JSON.stringify(opts.body ?? {}) } : {}),
    });
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
    throw new ApiError(err?.message ?? `Backend returned HTTP ${res.status}.`, err?.code ?? `HTTP_${res.status}`, res.status);
  }
  return json;
}
