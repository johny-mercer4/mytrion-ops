/**
 * Backend config for the external app.
 *  - Production: SAME-ORIGIN. The app is served from the same host as the API, so the base URL is
 *    relative ('') and requests hit '/v1/*' — no CORS, and no API key in the browser.
 *  - Local dev: VITE_API_URL (+ optional VITE_API_KEY) point at a backend on another origin.
 *
 * AUTH NOTE (open decision — see web/ARCHITECTURE.md): in production the browser sends NO x-api-key.
 * The backend must accept same-origin widget requests to /v1 without it (e.g. an Origin/Referer
 * check or a widget-scoped session). The user context in the request body is advisory, not auth.
 */
export interface ApiConfig {
  /** '' = same-origin (production); an absolute origin in dev. */
  baseUrl: string;
}

export function resolveApiConfig(): ApiConfig {
  if (import.meta.env.DEV) return { baseUrl: (import.meta.env.VITE_API_URL ?? '').trim() };
  return { baseUrl: '' };
}

/** Build a full endpoint path: ensures exactly one /v1 prefix. ('' base → relative '/v1/...'). */
export function v1Url(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return /\/v1$/.test(b) ? b + p : `${b}/v1${p}`;
}

/** Dev-only API key for cross-origin local backends; empty in production (same-origin, no key). */
export function devApiKey(): string {
  return import.meta.env.DEV ? (import.meta.env.VITE_API_KEY ?? '').trim() : '';
}
