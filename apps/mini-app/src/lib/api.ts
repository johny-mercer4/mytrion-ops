/**
 * Public API client — no auth headers. The registration link's id (in the URL) is the
 * capability; the real identity proof is Telegram's initData HMAC, verified server-side on redeem.
 */
import { resolveApiConfig, v1Url } from './config';

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(message: string, code = 'ERROR', status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

async function request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const { baseUrl } = resolveApiConfig();
  const url = v1Url(baseUrl, path);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      ...(method === 'GET' ? {} : { body: JSON.stringify(body ?? {}) }),
    });
  } catch (e) {
    throw new ApiError(`Could not reach Octane. ${(e as Error)?.message ?? ''}`, 'NETWORK', 0);
  }
  const raw = await res.text();
  let json: unknown = null;
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = raw;
    }
  }
  if (!res.ok) {
    const err =
      json && typeof json === 'object' ? (json as { error?: { message?: string; code?: string } }).error : null;
    throw new ApiError(err?.message ?? `Backend returned HTTP ${res.status}.`, err?.code ?? `HTTP_${res.status}`, res.status);
  }
  return json;
}

export type CompanyType = 'owner-operator' | 'fleet-manager';
export type Profile = 'owner' | 'driver';

export interface RegistrationPreview {
  id: string;
  profile: Profile;
  companyName: string | null;
  companyType: CompanyType | null;
  cardCount: number | null;
}

export type PreviewResult =
  | { invite: RegistrationPreview; status: 'pending' }
  | { invite: null; status: 'redeemed'; companyName: string | null };

export async function fetchRegistrationPreview(id: string): Promise<PreviewResult> {
  return (await request('GET', `/carrier-invitations/${encodeURIComponent(id)}/public`)) as PreviewResult;
}

export interface RegistrationView {
  id: string;
  profile: Profile;
  companyName: string | null;
  carrierId: string | null;
  companyType: CompanyType | null;
  cardCount: number | null;
  cardId: string | null;
}

/** Aggregate fleet summary — counts only, deliberately no card numbers or driver identities. */
export interface FleetSummary {
  cardCount: number | null;
  registeredDrivers: number;
}

export type RedeemResult =
  | { registration: RegistrationView; fleet?: FleetSummary }
  | { alreadyRegistered: true; registration: RegistrationView };

export async function redeemRegistration(id: string, initData: string): Promise<RedeemResult> {
  return (await request('POST', `/carrier-invitations/${encodeURIComponent(id)}/redeem`, {
    initData,
  })) as RedeemResult;
}
