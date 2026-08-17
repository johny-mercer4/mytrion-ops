import { env } from '../config/env.js';
import { VERIFICATION_LEGACY_DESK_ENABLED } from '../modules/verification/killSwitches.js';
import { logger } from '../lib/logger.js';

const TIMEOUT_MS = 8_000;

export interface CreditPlatformCreateInput {
  requestId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  dateOfBirth: string;
  carrierId?: string;
  applicationDate?: string;
  payload: Record<string, unknown>;
}

export interface CreditPlatformCreateResult {
  ok: boolean;
  requestId: string;
  status?: string;
  error?: string;
}

function baseUrl(): string {
  return env.CREDIT_PLATFORM_BASE_URL.replace(/\/+$/, '');
}

/** Quarantined by `VERIFICATION_LEGACY_DESK_ENABLED` — see killSwitches.ts. */
export function isCreditPlatformConfigured(): boolean {
  if (!VERIFICATION_LEGACY_DESK_ENABLED) return false;
  return Boolean(env.CREDIT_PLATFORM_BASE_URL && env.CREDIT_PLATFORM_API_KEY);
}

async function requestJson(
  method: 'GET' | 'POST',
  path: string,
  headers: Record<string, string>,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    if (text) {
      try {
        json = JSON.parse(text) as Record<string, unknown>;
      } catch {
        json = { raw: text.slice(0, 300) };
      }
    }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  return requestJson('POST', path, headers, body);
}

/** Fire-and-forget create+start. Does not wait for bureau completion. */
export async function createAndStartRequest(
  input: CreditPlatformCreateInput,
): Promise<CreditPlatformCreateResult> {
  if (!isCreditPlatformConfigured()) {
    return { ok: false, requestId: input.requestId, error: 'CREDIT_PLATFORM_BASE_URL/API_KEY unset' };
  }
  const firstName = input.firstName || 'Unknown';
  const lastName = input.lastName || 'Applicant';
  try {
    const res = await postJson(
      '/api/v1/requests',
      {
        request_id: input.requestId,
        firstName,
        lastName,
        email: input.email || 'unknown@invalid.local',
        phone: input.phone || '0000000000',
        address: input.address || 'Unknown',
        city: input.city || 'Unknown',
        state: input.state || 'NA',
        zipCode: input.zipCode || '00000',
        dateOfBirth: input.dateOfBirth || '1990-01-01',
        orchestration_mode: 'custom',
        ...(input.carrierId ? { carrierId: input.carrierId } : {}),
        ...(input.applicationDate ? { applicationDate: input.applicationDate } : {}),
        payload: input.payload,
      },
      { 'X-Api-Key': env.CREDIT_PLATFORM_API_KEY },
    );
    const requestId = String(res.json.request_id ?? input.requestId);
    if (!res.ok) {
      return {
        ok: false,
        requestId,
        error: `HTTP ${res.status}: ${String(res.json.detail ?? res.json.error ?? res.json.raw ?? '')}`.slice(
          0,
          400,
        ),
      };
    }
    const result = res.json.result;
    const status =
      result && typeof result === 'object' ? String((result as { status?: unknown }).status ?? '') : '';
    if (status) return { ok: true, requestId, status };
    return { ok: true, requestId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err: message, requestId: input.requestId }, 'credit-platform create failed');
    return { ok: false, requestId: input.requestId, error: message };
  }
}

function analystHeaders(actor?: string): Record<string, string> {
  const name = (actor ?? '').trim() || 'verification-mytrion';
  return {
    'X-Api-Key': env.CREDIT_PLATFORM_ANALYST_API_KEY || env.CREDIT_PLATFORM_API_KEY,
    'X-User-Role': 'analyst',
    'X-User-Name': name.slice(0, 80),
  };
}

function cpError(res: { status: number; json: Record<string, unknown> }): string {
  return `HTTP ${res.status}: ${String(res.json.detail ?? res.json.error ?? res.json.raw ?? '')}`.slice(0, 400);
}

export async function runDecisionDeskStage(
  requestId: string,
  stageId: string,
  opts: { actor?: string; bureauProvider?: string } = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/requests/${encodeURIComponent(requestId)}/decision-desk/stages/${encodeURIComponent(stageId)}/run`,
      opts.bureauProvider ? { bureau_provider: opts.bureauProvider } : {},
      analystHeaders(opts.actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function runIsoftpullAll(
  requestId: string,
  actor?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/requests/${encodeURIComponent(requestId)}/decision-desk/stages/isoftpull/run-all`,
      {},
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function claimManualReview(
  requestId: string,
  actor: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/manual-review/${encodeURIComponent(requestId)}/claim`,
      { note: note ?? '' },
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function releaseManualReview(
  requestId: string,
  actor: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/manual-review/${encodeURIComponent(requestId)}/release`,
      { note: note ?? '' },
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function parseBankStatements(
  requestId: string,
  attachmentIds: number[],
  actor?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/manual-review/${encodeURIComponent(requestId)}/decision-desk/plaid-bs/parse`,
      { attachment_ids: attachmentIds },
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function approveDecisionDeskStage(
  requestId: string,
  stageId: string,
  note?: string,
  actor?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/requests/${encodeURIComponent(requestId)}/decision-desk/stages/${encodeURIComponent(stageId)}/approve`,
      { note: note ?? '' },
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function resetDecisionDeskStage(
  requestId: string,
  stageId: string,
  actor?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/requests/${encodeURIComponent(requestId)}/decision-desk/stages/${encodeURIComponent(stageId)}/reset`,
      {},
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface StageReadinessEntry {
  ready: boolean;
  missing: string[];
  paid: boolean;
  alreadyPaid?: boolean;
  circuitOpen?: boolean;
}

export interface StageReadiness {
  requestId: string;
  stages: Record<string, StageReadinessEntry>;
}

function asReadinessEntry(value: unknown): StageReadinessEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const missing = Array.isArray(rec.missing)
    ? rec.missing.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    ready: rec.ready !== false,
    missing,
    paid: rec.paid === true,
    ...(rec.already_paid === true || rec.alreadyPaid === true ? { alreadyPaid: true } : {}),
    ...(rec.circuit_open === true || rec.circuitOpen === true ? { circuitOpen: true } : {}),
  };
}

export async function getStageReadiness(requestId: string): Promise<StageReadiness | null> {
  if (!isCreditPlatformConfigured()) return null;
  try {
    const res = await requestJson(
      'GET',
      `/api/v1/manual-review/${encodeURIComponent(requestId)}/stage-readiness`,
      analystHeaders(),
    );
    if (!res.ok) return null;
    const rawStages = res.json.stages;
    const stages: Record<string, StageReadinessEntry> = {};
    if (rawStages && typeof rawStages === 'object' && !Array.isArray(rawStages)) {
      for (const [key, value] of Object.entries(rawStages as Record<string, unknown>)) {
        const entry = asReadinessEntry(value);
        if (entry) stages[key] = entry;
      }
    }
    return { requestId: String(res.json.request_id ?? requestId), stages };
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : String(err), requestId }, 'stage-readiness failed');
    return null;
  }
}

export async function submitManualDecision(
  requestId: string,
  decision: 'APPROVED' | 'REJECTED' | 'REVIEW',
  reason?: string,
  actor?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/manual-review/${encodeURIComponent(requestId)}/decision`,
      { decision, reason: reason ?? '', note: reason ?? '' },
      analystHeaders(actor),
    );
    return res.ok ? { ok: true } : { ok: false, error: cpError(res) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
