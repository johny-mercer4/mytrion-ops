/**
 * First-party Plaid client for Data Center — Link-token mint only.
 *
 * Sandbox `/link/token/create` with `auth` is the connectivity test. It is not the Check
 * billable event. Check report GET is not implemented here: that path needs a
 * persisted Link session and the same spend gate as iSoftPull.
 *
 * `PLAID_ENV` is preferred; `PLAID_ENVIRONMENT` is the loans-box alias.
 */
import { env } from '../config/env.js';
import { fetchWithTimeout } from '../lib/http.js';

export function plaidLiveEnabled(): boolean {
  return env.VERIFICATION_PAID_VENDORS_ENABLED || env.PLAID_LIVE_ENABLED;
}

export function plaidEnvName(): 'sandbox' | 'development' | 'production' {
  const raw = (env.PLAID_ENV.trim() || env.PLAID_ENVIRONMENT.trim() || 'sandbox').toLowerCase();
  if (raw === 'production' || raw === 'development') return raw;
  return 'sandbox';
}

export function plaidHost(): string {
  const mode = plaidEnvName();
  if (mode === 'production') return 'https://production.plaid.com';
  if (mode === 'development') return 'https://development.plaid.com';
  return 'https://sandbox.plaid.com';
}

export function plaidConfiguredMissing(): string | null {
  if (!env.PLAID_CLIENT_ID.trim()) return 'PLAID_CLIENT_ID';
  if (!env.PLAID_SECRET.trim()) return 'PLAID_SECRET';
  return null;
}

export interface PlaidLinkTokenArgs {
  clientUserId?: string;
}

export interface PlaidLinkTokenData {
  env: 'sandbox' | 'development' | 'production';
  billed: false;
  product: 'link_token';
  linkToken: string | null;
  expiration: string | null;
  hostedLinkUrl: string | null;
  requestId: string | null;
  payload: Record<string, unknown>;
}

export async function createPlaidLinkToken(args: PlaidLinkTokenArgs = {}): Promise<PlaidLinkTokenData> {
  const missing = plaidConfiguredMissing();
  if (missing) throw new Error(`${missing} is not configured`);

  const clientUserId = (args.clientUserId ?? '').trim() || `octane-dc-${Date.now()}`;
  const res = await fetchWithTimeout(
    `${plaidHost()}/link/token/create`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        client_id: env.PLAID_CLIENT_ID.trim(),
        secret: env.PLAID_SECRET.trim(),
        client_name: 'Octane Verification',
        language: 'en',
        country_codes: ['US'],
        products: ['auth'],
        user: { client_user_id: clientUserId },
      }),
    },
    env.OUTBOUND_HTTP_TIMEOUT_MS,
  );

  const text = await res.text();
  let payload: Record<string, unknown> = {};
  if (text.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(text);
      payload = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : { raw: parsed };
    } catch {
      payload = { raw: text.slice(0, 2_000) };
    }
  }
  if (!res.ok) {
    const error = typeof payload.error_message === 'string' ? payload.error_message : `Plaid HTTP ${res.status}`;
    throw new Error(error);
  }

  return {
    env: plaidEnvName(),
    billed: false,
    product: 'link_token',
    linkToken: typeof payload.link_token === 'string' ? payload.link_token : null,
    expiration: typeof payload.expiration === 'string' ? payload.expiration : null,
    hostedLinkUrl:
      typeof payload.hosted_link_url === 'string' ? payload.hosted_link_url : null,
    requestId: typeof payload.request_id === 'string' ? payload.request_id : null,
    payload,
  };
}
