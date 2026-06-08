/** Minimal JSON fetch helpers for the metadata analyzers (Node 20+ global fetch). */

/** GET a URL expecting JSON. Throws with a truncated body on non-2xx. */
export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json', ...headers } });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * Like getJson, but returns null instead of throwing — for best-effort metadata calls
 * (e.g. per-module field listings) where one failure shouldn't abort the whole sweep.
 * The reason is logged by the caller.
 */
export async function tryGetJson<T>(
  url: string,
  headers: Record<string, string> = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await getJson<T>(url, headers) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
