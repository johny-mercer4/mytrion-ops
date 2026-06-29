/**
 * Core request transport for the Mytrion Ops backend. Inside CRM it goes through the Zoho HTTP
 * proxy (no CORS, key injected server-side); in local dev it uses a direct fetch. Both unwrap the
 * response and throw ApiError on a backend `{ error }` body or a 4xx/5xx status.
 */
import { getZohoSdk } from '../zoho/embeddedApp';
import { resolveApiConfig, v1Url } from './config';

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

/** Best-effort HTTP status from the Zoho HTTP wrapper. */
function statusOf(raw: unknown): number | null {
  let cur = raw;
  for (let i = 0; i < 3 && cur && typeof cur === 'object'; i += 1) {
    const o = cur as Record<string, unknown>;
    const s = o.statusCode ?? o.status;
    if (typeof s === 'number') return s;
    if (typeof s === 'string' && /^\d{3}$/.test(s)) return parseInt(s, 10);
    if (o.body && typeof o.body === 'object') {
      cur = o.body;
      continue;
    }
    break;
  }
  return null;
}

/**
 * Look for a backend error at ANY wrapper level (the proxy may carry its own `error` as a sibling of
 * `body`, and the backend's `{ error }` lives inside the stringified `body`). Only a truthy object or
 * string counts — a success body with `error: null` / `false` / `0` / `''` is not an error.
 */
function findError(raw: unknown): { message?: string; code?: string } | null {
  let cur = raw;
  for (let i = 0; i < 6 && cur != null; i += 1) {
    if (typeof cur === 'string') {
      const t = cur.trim();
      if (t && (t[0] === '{' || t[0] === '[')) {
        try {
          cur = JSON.parse(t);
          continue;
        } catch {
          return null;
        }
      }
      return null;
    }
    if (typeof cur !== 'object') return null;
    const o = cur as Record<string, unknown>;
    const err = o.error;
    if (err && typeof err === 'object') return err as { message?: string; code?: string };
    if (typeof err === 'string') return { message: err };
    if (o.body !== undefined) cur = o.body;
    else if (o.data !== undefined) cur = o.data;
    else if (o.response !== undefined) cur = o.response;
    else return null;
  }
  return null;
}

/** Peel the Zoho HTTP wrapper (body/data/response, possibly stringified JSON) to the payload. */
export function unwrap(raw: unknown): unknown {
  let cur = raw;
  for (let i = 0; i < 5; i += 1) {
    if (typeof cur === 'string') {
      const t = cur.trim();
      if (t && (t[0] === '{' || t[0] === '[')) {
        try {
          cur = JSON.parse(t);
          continue;
        } catch {
          return cur;
        }
      }
      return cur;
    }
    if (cur && typeof cur === 'object') {
      const o = cur as Record<string, unknown>;
      if (typeof o.body !== 'undefined') {
        cur = o.body;
        continue;
      }
      if (typeof o.data !== 'undefined') {
        cur = o.data;
        continue;
      }
      if (typeof o.response !== 'undefined') {
        cur = o.response;
        continue;
      }
      return cur;
    }
    return cur;
  }
  return cur;
}

export interface RequestOptions {
  query?: Record<string, string | number | undefined> | undefined;
  body?: unknown;
}

export async function request(method: 'GET' | 'POST', path: string, opts: RequestOptions = {}): Promise<unknown> {
  const cfg = await resolveApiConfig();
  if (!cfg.baseUrl) throw new ApiError(`Backend URL not configured (${path}).`, 'CONFIG_MISSING');
  if (!cfg.apiKey) throw new ApiError('Backend API key not configured.', 'CONFIG_MISSING');

  let url = v1Url(cfg.baseUrl, path);
  if (opts.query) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== '') qs.append(k, String(v));
    }
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  const headers: Record<string, string> = { 'x-api-key': cfg.apiKey };
  const sdk = await getZohoSdk();
  let raw: unknown;
  try {
    if (sdk) {
      if (method === 'GET') {
        raw = await sdk.CRM.HTTP.get({ url, headers });
      } else {
        headers['Content-Type'] = 'application/json';
        raw = await sdk.CRM.HTTP.post({ url, headers, body: JSON.stringify(opts.body ?? {}) });
      }
    } else {
      // Local dev: direct fetch (CORS allows localhost:3000).
      if (method !== 'GET') headers['Content-Type'] = 'application/json';
      const res = await fetch(url, {
        method,
        headers,
        ...(method !== 'GET' ? { body: JSON.stringify(opts.body ?? {}) } : {}),
      });
      raw = { statusCode: res.status, body: await res.text() };
    }
  } catch (e) {
    throw new ApiError(`Could not reach the backend. ${(e as Error)?.message ?? ''}`, 'NETWORK', 0);
  }

  const status = statusOf(raw);
  const err = findError(raw);
  if (err) {
    throw new ApiError(err.message ?? 'Request failed', err.code ?? 'ERROR', status ?? 0);
  }
  if (status && status >= 400) {
    throw new ApiError(`Backend returned HTTP ${status}.`, `HTTP_${status}`, status);
  }
  return unwrap(raw);
}
