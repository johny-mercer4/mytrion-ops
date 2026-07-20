/**
 * Browser-automation microservice wrapper — the dedicated Playwright service the
 * self-service widget calls for BOCA / Close Application (POST /wex/boca/:appId and
 * POST /wex/application/:appId/close). Auth = static `x-api-key`. Long timeout: these
 * runs drive a real browser and routinely take 1–3 minutes.
 */
import { env } from '../config/env.js';
import { HttpWrapper, type HttpMethod } from './core/base.js';

export function browserAutomationBaseUrl(): string {
  if (!env.BROWSER_AUTOMATION_URL) {
    throw new Error('[browser-automation] BROWSER_AUTOMATION_URL is not configured');
  }
  return env.BROWSER_AUTOMATION_URL.replace(/\/+$/, '');
}

export function browserAutomationAuthHeaders(): Record<string, string> {
  if (!env.BROWSER_AUTOMATION_KEY) {
    throw new Error('[browser-automation] BROWSER_AUTOMATION_KEY is not configured');
  }
  return { 'x-api-key': env.BROWSER_AUTOMATION_KEY, 'Content-Type': 'application/json' };
}

export class BrowserAutomationHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(method: HttpMethod, path: string, status: number, bodyText: string) {
    const truncated = bodyText.slice(0, 300);
    super(`[browser-automation] ${method} ${path} → HTTP ${status}: ${truncated}`);
    this.name = 'BrowserAutomationHttpError';
    this.status = status;
    this.bodyText = truncated;
  }
}

export interface BrowserAutomationRequestOptions {
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
}

export class BrowserAutomationWrapper extends HttpWrapper {
  readonly name = 'browser_automation';

  isConfigured(): boolean {
    return Boolean(env.BROWSER_AUTOMATION_URL && env.BROWSER_AUTOMATION_KEY);
  }

  protected baseUrl(): string {
    return browserAutomationBaseUrl();
  }

  protected authHeaders(): Promise<Record<string, string>> {
    return Promise.resolve(browserAutomationAuthHeaders());
  }

  protected override httpError(method: HttpMethod, path: string, status: number, bodyText: string): Error {
    return new BrowserAutomationHttpError(method, path, status, bodyText);
  }

  call<T = unknown>(
    method: HttpMethod,
    path: string,
    opts: BrowserAutomationRequestOptions = {},
  ): Promise<T> {
    return this.request<T>(method, path, {
      ...opts,
      timeoutMs: env.BROWSER_AUTOMATION_TIMEOUT_MS,
    });
  }

  post<T = unknown>(path: string, body?: unknown): Promise<T> {
    return this.call<T>('POST', path, body !== undefined ? { body } : {});
  }
}

export const browserAutomation = new BrowserAutomationWrapper();

export const browserAutomationRequest = <T = unknown>(
  method: HttpMethod,
  path: string,
  opts: BrowserAutomationRequestOptions = {},
): Promise<T> => browserAutomation.call<T>(method, path, opts);
