/**
 * Backend config — Vite dev server talks cross-origin to the API (VITE_API_URL).
 * Vendored / Telegram builds are served at /mini-app/ on the API host — same-origin,
 * baseUrl must stay empty. Never bake localhost into `app/` (a shell with
 * NODE_ENV=development used to flip import.meta.env.DEV during `vite build`).
 */
export function resolveApiConfig(): { baseUrl: string } {
  if (import.meta.env.MODE === 'development') {
    return { baseUrl: (import.meta.env.VITE_API_URL ?? '').trim() };
  }
  return { baseUrl: '' };
}

export function v1Url(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return /\/v1$/.test(b) ? b + p : `${b}/v1${p}`;
}
