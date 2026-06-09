/**
 * Server CRM wrapper — our own Node server (servercrm) which already wraps DWH/EFS/CMP/Zoho and
 * exposes an agent API under `/api/agent/*` (auth = static `x-api-key`). This is the "proxy" path:
 * some tools call servercrm rather than re-implementing a vendor here.
 *
 * Auth is a single header (no token flow), so this wrapper also provides thin request helpers
 * (get/post) that tools build on.
 */
import { env } from '../config/env.js';

export function serverCrmBaseUrl(): string {
  if (!env.SERVER_CRM_URL) throw new Error('[server-crm] SERVER_CRM_URL is not configured');
  return env.SERVER_CRM_URL.replace(/\/+$/, '');
}

export function serverCrmAuthHeaders(): Record<string, string> {
  if (!env.SERVER_CRM_KEY) throw new Error('[server-crm] SERVER_CRM_KEY is not configured');
  return { 'x-api-key': env.SERVER_CRM_KEY, 'Content-Type': 'application/json' };
}

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface ServerCrmRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

/** Call a servercrm endpoint with auth. Throws with a truncated body on non-2xx. */
export async function serverCrmRequest<T = unknown>(
  method: HttpMethod,
  path: string,
  opts: ServerCrmRequestOptions = {},
): Promise<T> {
  const url = new URL(`${serverCrmBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`);
  if (opts.query) {
    for (const [key, value] of Object.entries(opts.query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  const init: RequestInit = { method, headers: serverCrmAuthHeaders() };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`[server-crm] ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export function serverCrmGet<T = unknown>(
  path: string,
  query?: ServerCrmRequestOptions['query'],
): Promise<T> {
  return serverCrmRequest<T>('GET', path, query ? { query } : {});
}

export function serverCrmPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return serverCrmRequest<T>('POST', path, body !== undefined ? { body } : {});
}
