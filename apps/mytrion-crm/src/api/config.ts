/**
 * Backend config for the external app.
 *  - Production / any deployed host: SAME-ORIGIN. Served with the API, so base URL is '' and
 *    requests hit '/v1/*' — no CORS, no API key in the browser.
 *  - Local dev (localhost only): VITE_API_URL (+ optional VITE_API_KEY) may point at a backend
 *    on another origin (e.g. :3001).
 *
 * AUTH NOTE (open decision — see ARCHITECTURE.md): in production the browser sends NO x-api-key.
 * The backend must accept same-origin widget requests to /v1 without it (e.g. an Origin/Referer
 * check or a widget-scoped session). The user context in the request body is advisory, not auth.
 */
export interface ApiConfig {
  /** '' = same-origin (production); an absolute origin in local dev. */
  baseUrl: string;
}

function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

export function resolveApiConfig(): ApiConfig {
  // Runtime host wins over anything Vite inlined. A `vite build` run under NODE_ENV=development
  // can bake DEV=true + VITE_API_URL=http://localhost:3001 into the shipped portal — which then
  // CORS-fails Zoho sign-in on Render. Never use a cross-origin API on a public hostname.
  if (!isLocalDevHost()) {
    return { baseUrl: '' };
  }
  if (import.meta.env.PROD) {
    return { baseUrl: '' };
  }
  return { baseUrl: (import.meta.env.VITE_API_URL ?? '').trim() };
}

/** Build a full endpoint path: ensures exactly one /v1 prefix. ('' base → relative '/v1/...'). */
export function v1Url(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return /\/v1$/.test(b) ? b + p : `${b}/v1${p}`;
}

/** Dev-only API key for cross-origin local backends; empty on deployed hosts (same-origin). */
export function devApiKey(): string {
  if (!isLocalDevHost() || import.meta.env.PROD) return '';
  return (import.meta.env.VITE_API_KEY ?? '').trim();
}
