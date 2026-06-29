/**
 * Resolves the Mytrion Ops backend config ({ baseUrl, apiKey }).
 *  - Inside CRM: from Zoho org variables (server secrets) via ZOHO.CRM.API.getOrgVariable.
 *  - Local dev (no SDK): from VITE_API_URL / VITE_API_KEY.
 * Cached after the first resolution.
 */
import { getZohoSdk } from '../zoho/embeddedApp';

export const OPS_URL_VAR = 'MYTRION_OPS_API_URL';
export const OPS_KEY_VAR = 'MYTRION_OPS_API_KEY';

export interface ApiConfig {
  baseUrl: string;
  apiKey: string;
}

/** Pull a variable's value out of a getOrgVariable response, tolerant of the shapes Zoho returns. */
function extractOrgVar(resp: unknown, name: string): string {
  if (resp == null || typeof resp !== 'object') return '';
  const r = resp as Record<string, unknown>;
  const candidates: unknown[] = [
    (r.Success as Record<string, unknown> | undefined)?.Content,
    (r.success as Record<string, unknown> | undefined)?.content,
    r.Content,
    r.data,
    r,
  ];
  for (const content of candidates) {
    if (content == null || typeof content !== 'object') continue;
    if (Array.isArray(content)) {
      const hit = content.find(
        (v) => v && typeof v === 'object' && ((v as Record<string, unknown>).api_name === name || (v as Record<string, unknown>).name === name),
      ) as Record<string, unknown> | undefined;
      if (hit?.value != null) return String(hit.value);
      continue;
    }
    const entry = (content as Record<string, unknown>)[name];
    if (entry == null) continue;
    if (typeof entry === 'string') return entry;
    if (typeof entry === 'object' && (entry as Record<string, unknown>).value != null) {
      return String((entry as Record<string, unknown>).value);
    }
  }
  return '';
}

let cached: ApiConfig | null = null;

export async function resolveApiConfig(): Promise<ApiConfig> {
  if (cached) return cached;
  const sdk = await getZohoSdk();
  if (!sdk) {
    // Local dev only. Gated on import.meta.env.DEV so a production build statically resolves this
    // branch away — Vite then never inlines VITE_API_KEY/VITE_API_URL into the shipped bundle. (A
    // CRM build has the SDK, so it never reaches here; a non-CRM prod build gets empty config.)
    if (import.meta.env.DEV) {
      cached = {
        baseUrl: (import.meta.env.VITE_API_URL ?? '').trim(),
        apiKey: (import.meta.env.VITE_API_KEY ?? '').trim(),
      };
      return cached;
    }
    cached = { baseUrl: '', apiKey: '' };
    return cached;
  }
  let baseUrl = '';
  let apiKey = '';
  try {
    const resp = await sdk.CRM.API.getOrgVariable({ apiKeys: [OPS_URL_VAR, OPS_KEY_VAR] });
    baseUrl = extractOrgVar(resp, OPS_URL_VAR);
    apiKey = extractOrgVar(resp, OPS_KEY_VAR);
    if (!baseUrl || !apiKey) {
      // eslint-disable-next-line no-console
      console.warn('[OctaneAssistant] getOrgVariable returned incomplete config — verify the two org variables exist in THIS org.', { gotUrl: !!baseUrl, gotKey: !!apiKey });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[OctaneAssistant] getOrgVariable failed:', e);
  }
  cached = { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() };
  return cached;
}

/** Build a full endpoint URL: ensures exactly one /v1 prefix. */
export function v1Url(base: string, path: string): string {
  const b = base.replace(/\/+$/, '');
  const p = path.startsWith('/') ? path : `/${path}`;
  return /\/v1$/.test(b) ? b + p : `${b}/v1${p}`;
}
