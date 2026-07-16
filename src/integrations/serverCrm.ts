/**
 * Server CRM wrapper — our own Node server (servercrm) which already wraps DWH/EFS/CMP/Zoho and
 * exposes an agent API under `/api/agent/*` (auth = static `x-api-key`). This is the "proxy" path:
 * some tools call servercrm rather than re-implementing a vendor here.
 *
 * Auth is a single header (no token flow); requests go through HttpWrapper (fetchWithTimeout).
 */
import { env } from '../config/env.js';
import { HttpWrapper, type HttpMethod } from './core/base.js';

export function serverCrmBaseUrl(): string {
  if (!env.SERVER_CRM_URL) throw new Error('[server-crm] SERVER_CRM_URL is not configured');
  return env.SERVER_CRM_URL.replace(/\/+$/, '');
}

export function serverCrmAuthHeaders(): Record<string, string> {
  if (!env.SERVER_CRM_KEY) throw new Error('[server-crm] SERVER_CRM_KEY is not configured');
  return { 'x-api-key': env.SERVER_CRM_KEY, 'Content-Type': 'application/json' };
}

/**
 * Typed non-2xx failure so proxy layers can map the upstream status (4xx passthrough vs
 * 502). Message format matches the historical plain-Error text — existing catch sites
 * and tests that string-match keep working.
 */
export class ServerCrmHttpError extends Error {
  readonly status: number;
  /** Upstream response body, truncated to 300 chars. */
  readonly bodyText: string;

  constructor(method: HttpMethod, path: string, status: number, bodyText: string) {
    const truncated = bodyText.slice(0, 300);
    super(`[server-crm] ${method} ${path} → HTTP ${status}: ${truncated}`);
    this.name = 'ServerCrmHttpError';
    this.status = status;
    this.bodyText = truncated;
  }
}

export interface ServerCrmRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class ServerCrmWrapper extends HttpWrapper {
  readonly name = 'server_crm';

  isConfigured(): boolean {
    return Boolean(env.SERVER_CRM_URL && env.SERVER_CRM_KEY);
  }

  protected baseUrl(): string {
    return serverCrmBaseUrl();
  }

  protected authHeaders(): Promise<Record<string, string>> {
    return Promise.resolve(serverCrmAuthHeaders());
  }

  /** Preserve the historical `ServerCrmHttpError` shape (string-matched catch sites). */
  protected override httpError(method: HttpMethod, path: string, status: number, bodyText: string): Error {
    return new ServerCrmHttpError(method, path, status, bodyText);
  }

  /** Call a servercrm endpoint with auth. Throws ServerCrmHttpError on non-2xx. */
  call<T = unknown>(method: HttpMethod, path: string, opts: ServerCrmRequestOptions = {}): Promise<T> {
    return this.request<T>(method, path, opts);
  }

  get<T = unknown>(path: string, query?: ServerCrmRequestOptions['query']): Promise<T> {
    return this.call<T>('GET', path, query ? { query } : {});
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, body !== undefined ? { body } : {});
  }
}

export const serverCrm = new ServerCrmWrapper();

/** @deprecated Import { serverCrm } and call the method — kept as facades during migration. */
export const serverCrmRequest = <T = unknown>(
  method: HttpMethod,
  path: string,
  opts: ServerCrmRequestOptions = {},
): Promise<T> => serverCrm.call<T>(method, path, opts);
export const serverCrmGet = <T = unknown>(
  path: string,
  query?: ServerCrmRequestOptions['query'],
): Promise<T> => serverCrm.get<T>(path, query);
export const serverCrmPost = <T = unknown>(path: string, body?: unknown): Promise<T> =>
  serverCrm.post<T>(path, body);
