/**
 * Wrapper core — the base classes every vendor integration ("wrapper") builds on.
 *
 * A wrapper is one class per vendor (Zoho Desk, Server CRM, DWH, …) exporting a lazy
 * singleton: constructors touch no env and open no sockets, so any module may import a
 * wrapper freely (tests included); env is read and connections are made inside methods.
 *
 * To add a NEW integration ("Custom Wrapper"): extend HttpWrapper (or SqlWrapper /
 * BaseWrapper for non-HTTP vendors), implement `name` / `isConfigured` / `baseUrl` /
 * `authHeaders`, export a singleton, add its env vars to config/env.ts, and register it in
 * core/registerAll.ts so /v1/health/integrations can see it. RingCentral
 * (integrations/ringcentral.ts) is the reference example.
 */
import { fetchWithTimeout } from '../../lib/http.js';

export type WrapperKind = 'http' | 'sql' | 'sdk';

export interface WrapperHealth {
  name: string;
  kind: WrapperKind;
  /** Required env present? When false, no probe is attempted. */
  configured: boolean;
  /** Configured (and, in live mode, the probe passed). */
  ok: boolean;
  /** Probe duration — only set when a live probe ran. */
  latencyMs?: number;
  detail?: string;
}

export abstract class BaseWrapper {
  /** Stable id, e.g. 'zoho_desk', 'server_crm', 'dwh'. */
  abstract readonly name: string;
  abstract readonly kind: WrapperKind;
  /** True when the env this vendor needs is present. Must not throw or open connections. */
  abstract isConfigured(): boolean;
  /**
   * Cheap live connectivity check (SELECT 1, a ping endpoint, …). Only run when health()
   * is asked for a live probe. Default: no-op (configured-only wrappers).
   */
  protected probe(): Promise<void> {
    return Promise.resolve();
  }

  /** Health report. Never throws — failures land in `ok: false` + `detail`. */
  async health(opts: { live?: boolean } = {}): Promise<WrapperHealth> {
    let configured = false;
    try {
      configured = this.isConfigured();
    } catch (err) {
      return this.report(false, false, { detail: errText(err) });
    }
    if (!configured) return this.report(false, false, { detail: 'unconfigured' });
    if (!opts.live) return this.report(true, true);
    const started = Date.now();
    try {
      await this.probe();
      return this.report(true, true, { latencyMs: Date.now() - started });
    } catch (err) {
      return this.report(true, false, { latencyMs: Date.now() - started, detail: errText(err) });
    }
  }

  private report(
    configured: boolean,
    ok: boolean,
    extra: { latencyMs?: number; detail?: string } = {},
  ): WrapperHealth {
    return {
      name: this.name,
      kind: this.kind,
      configured,
      ok,
      ...(extra.latencyMs !== undefined ? { latencyMs: extra.latencyMs } : {}),
      ...(extra.detail !== undefined ? { detail: extra.detail } : {}),
    };
  }
}

function errText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Typed non-2xx failure with the upstream status, for 4xx-passthrough vs 502 decisions. */
export class WrapperHttpError extends Error {
  constructor(
    readonly wrapper: string,
    readonly method: HttpMethod,
    readonly path: string,
    readonly status: number,
    /** Upstream response body, truncated to 300 chars. */
    readonly bodyText: string,
    message?: string,
  ) {
    super(message ?? `[${wrapper}] ${method} ${path} → HTTP ${status}: ${bodyText}`);
    this.name = 'WrapperHttpError';
  }
}

export interface HttpRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  /** FormData passes through as-is (multipart); anything else is JSON-encoded. */
  body?: unknown;
  /** Extra headers, merged over authHeaders(). */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * HTTP vendor base: auth-header hook + fetchWithTimeout (no outbound call may hang a turn)
 * + optional retry-once-after-401 hook + JSON body handling.
 */
export abstract class HttpWrapper extends BaseWrapper {
  readonly kind = 'http' as const;

  protected abstract baseUrl(): string;
  protected abstract authHeaders(): Promise<Record<string, string>>;

  /** After a 401: invalidate cached credentials; return true to retry exactly once. */
  protected onUnauthorized(): Promise<boolean> {
    return Promise.resolve(false);
  }

  /**
   * Non-2xx error factory. Override to keep a vendor's historical error shape (catch sites
   * and tests string-match on some of these).
   */
  protected httpError(method: HttpMethod, path: string, status: number, bodyText: string): Error {
    return new WrapperHttpError(this.name, method, path, status, bodyText.slice(0, 300));
  }

  /** Auth'd request returning the raw Response (attachment bytes, custom body handling). */
  protected async requestRaw(
    method: HttpMethod,
    path: string,
    opts: HttpRequestOptions = {},
  ): Promise<Response> {
    return this.send(method, path, opts, true);
  }

  /** Auth'd JSON request. Non-2xx → httpError(); empty body → {}. */
  protected async request<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: HttpRequestOptions = {},
  ): Promise<T> {
    const res = await this.send(method, path, opts, true);
    const text = await res.text();
    if (!res.ok) throw this.httpError(method, path, res.status, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  private async send(
    method: HttpMethod,
    path: string,
    opts: HttpRequestOptions,
    mayRetry: boolean,
  ): Promise<Response> {
    const base = this.baseUrl().replace(/\/+$/, '');
    const url = new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`);
    if (opts.query) {
      for (const [key, value] of Object.entries(opts.query)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
    }
    const headers: Record<string, string> = { ...(await this.authHeaders()), ...(opts.headers ?? {}) };
    const init: RequestInit = { method, headers };
    if (opts.body !== undefined) {
      if (opts.body instanceof FormData) {
        init.body = opts.body; // fetch sets the multipart boundary — don't force a content-type
      } else {
        if (!('Content-Type' in headers)) headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(opts.body);
      }
    }
    const res =
      opts.timeoutMs !== undefined
        ? await fetchWithTimeout(url, init, opts.timeoutMs)
        : await fetchWithTimeout(url, init);
    if (res.status === 401 && mayRetry && (await this.onUnauthorized())) {
      return this.send(method, path, opts, false);
    }
    return res;
  }
}
