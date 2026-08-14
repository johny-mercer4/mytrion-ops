import { env } from '../config/env.js';
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

export function isCreditPlatformConfigured(): boolean {
  return Boolean(env.CREDIT_PLATFORM_BASE_URL && env.CREDIT_PLATFORM_API_KEY);
}

async function postJson(
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const url = `${baseUrl()}${path}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
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

function analystHeaders(): Record<string, string> {
  return {
    'X-Api-Key': env.CREDIT_PLATFORM_ANALYST_API_KEY || env.CREDIT_PLATFORM_API_KEY,
    'X-User-Role': 'analyst',
    'X-User-Name': 'verification-mytrion',
  };
}

export async function runDecisionDeskStage(
  requestId: string,
  stageId: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/requests/${encodeURIComponent(requestId)}/decision-desk/stages/${encodeURIComponent(stageId)}/run`,
      {},
      analystHeaders(),
    );
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function approveDecisionDeskStage(
  requestId: string,
  stageId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/requests/${encodeURIComponent(requestId)}/decision-desk/stages/${encodeURIComponent(stageId)}/approve`,
      { note: note ?? '' },
      analystHeaders(),
    );
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function submitManualDecision(
  requestId: string,
  decision: 'APPROVED' | 'REJECTED' | 'REVIEW',
  reason?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!isCreditPlatformConfigured()) return { ok: false, error: 'credit platform not configured' };
  try {
    const res = await postJson(
      `/api/v1/manual-review/${encodeURIComponent(requestId)}/decision`,
      { decision, reason: reason ?? '', note: reason ?? '' },
      analystHeaders(),
    );
    return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
