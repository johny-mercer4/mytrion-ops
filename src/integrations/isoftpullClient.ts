/**
 * First-party iSoftPull client — protocol copied from verification-mono loans, not CP
 * orchestration. One bureau per call. POST /reports with `api-key` / `api-secret`.
 *
 * State must be the full name (Texas, not TX). SSN/DOB are optional soft-pull fields.
 * 403 is treated like FMCSA: permanent, not retried, body unread.
 *
 * Tests mock `fetch`. This file must not be pointed at app.isoftpull.com from vitest
 * (`ISOFTPULL_BASE_URL` is pinned empty).
 */
import { env } from '../config/env.js';
import { fetchWithTimeout } from '../lib/http.js';

export const ISOFTPULL_BUREAUS = ['equifax', 'transunion', 'experian'] as const;
export type IsoftpullBureau = (typeof ISOFTPULL_BUREAUS)[number];

export const US_STATE_ABBR_TO_FULL: Record<string, string> = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  DC: 'District of Columbia',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
};

export function fullStateName(state: string): string {
  const trimmed = state.trim();
  if (trimmed === '') return trimmed;
  return US_STATE_ABBR_TO_FULL[trimmed.toUpperCase()] ?? trimmed;
}

export interface IsoftpullPullArgs {
  bureau: IsoftpullBureau;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ssn?: string;
  dateOfBirth?: string;
}

export interface IsoftpullPullData {
  bureau: IsoftpullBureau;
  httpStatus: number;
  payload: Record<string, unknown>;
}

const BUREAU_ENV: Record<IsoftpullBureau, { key: string; secret: string }> = {
  equifax: { key: 'ISOFTPULL_EQUIFAX_API_KEY', secret: 'ISOFTPULL_EQUIFAX_API_SECRET' },
  transunion: { key: 'ISOFTPULL_TRANSUNION_API_KEY', secret: 'ISOFTPULL_TRANSUNION_API_SECRET' },
  experian: { key: 'ISOFTPULL_EXPERIAN_API_KEY', secret: 'ISOFTPULL_EXPERIAN_API_SECRET' },
};

export function isoftpullLiveEnabled(): boolean {
  return env.VERIFICATION_PAID_VENDORS_ENABLED || env.ISOFTPULL_LIVE_ENABLED;
}

function envValue(name: keyof typeof env): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function isoftpullBureauMissing(bureau: IsoftpullBureau): string | null {
  const names = BUREAU_ENV[bureau];
  if (!envValue(names.key as keyof typeof env)) return names.key;
  if (!envValue(names.secret as keyof typeof env)) return names.secret;
  return null;
}

export function isoftpullConfiguredMissing(): string | null {
  if (!env.ISOFTPULL_BASE_URL.trim()) return 'ISOFTPULL_BASE_URL';
  for (const bureau of ISOFTPULL_BUREAUS) {
    if (isoftpullBureauMissing(bureau) === null) return null;
  }
  return isoftpullBureauMissing('equifax') ?? 'ISOFTPULL_EQUIFAX_API_KEY';
}

function bureauHeaders(bureau: IsoftpullBureau): { key: string; secret: string } {
  const names = BUREAU_ENV[bureau];
  return {
    key: envValue(names.key as keyof typeof env),
    secret: envValue(names.secret as keyof typeof env),
  };
}

function requestBody(args: IsoftpullPullArgs): Record<string, unknown> {
  const body: Record<string, unknown> = {
    first_name: args.firstName.trim(),
    last_name: args.lastName.trim(),
    address: args.address.trim(),
    city: args.city.trim(),
    state: fullStateName(args.state),
    zip: args.zip.trim(),
    full_feed: true,
  };
  const ssn = (args.ssn ?? '').replace(/\D/g, '');
  if (ssn !== '') body.ssn = ssn;
  const dob = (args.dateOfBirth ?? '').trim();
  if (dob !== '') body.date_of_birth = dob;
  return body;
}

export async function pullIsoftPullReport(args: IsoftpullPullArgs): Promise<IsoftpullPullData> {
  const missing = isoftpullBureauMissing(args.bureau);
  if (missing) throw new Error(`${missing} is not configured`);
  const base = env.ISOFTPULL_BASE_URL.trim().replace(/\/+$/, '');
  if (base === '') throw new Error('ISOFTPULL_BASE_URL is not configured');

  const creds = bureauHeaders(args.bureau);
  const res = await fetchWithTimeout(
    `${base}/reports`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'api-key': creds.key,
        'api-secret': creds.secret,
      },
      body: JSON.stringify(requestBody(args)),
    },
    env.OUTBOUND_HTTP_TIMEOUT_MS,
  );

  // 403 FIRST, body unread — same permanent-deny shape as FMCSA.
  if (res.status === 403) {
    throw new Error('HTTP 403 — this egress IP is denied at the iSoftPull edge; permanent, not retried');
  }

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
    throw new Error(`iSoftPull HTTP ${res.status}`);
  }
  return { bureau: args.bureau, httpStatus: res.status, payload };
}
