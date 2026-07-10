/**
 * Backend config — dev talks cross-origin to the octane-assistant backend (VITE_API_URL);
 * production is same-origin once the mini-app is deployed behind the same host.
 */
export function resolveApiConfig(): { baseUrl: string } {
  if (import.meta.env.DEV) return { baseUrl: (import.meta.env.VITE_API_URL ?? '').trim() };
  return { baseUrl: '' };
}

export function v1Url(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return /\/v1$/.test(b) ? b + p : `${b}/v1${p}`;
}
