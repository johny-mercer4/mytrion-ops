/**
 * Zoho CRM writes made as the signed-in worker.
 *
 * These helpers deliberately fail closed. A Sales mutation must never fall back to the shared
 * service credential because that records John Mercer, rather than the human who made the change,
 * in Zoho's Created_By / Modified_By and timeline fields.
 */
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { fetchWithTimeout } from '../lib/http.js';
import { logger } from '../lib/logger.js';
import { workerZohoTokenRepo } from '../repos/workerZohoTokenRepo.js';
import type { TenantContext } from '../types/tenantContext.js';

const EXPIRY_SKEW_MS = 60_000;
const ATTACHMENT_TIMEOUT_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number;
}

interface MutationRow {
  code?: string;
  status?: string;
  details?: { id?: string; [key: string]: unknown };
  message?: string;
  [key: string]: unknown;
}

interface MutationResponse {
  data?: MutationRow[];
  blueprint?: MutationRow[];
  code?: string;
  status?: string;
  message?: string;
  [key: string]: unknown;
}

export interface UserMutationResult {
  code: string;
  id: string;
  message: string;
  row: Record<string, unknown>;
}

const tokenCache = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<string>>();

function cacheKey(tenantId: string, zohoUserId: string): string {
  return `${tenantId}:${zohoUserId}`;
}

function accountsBase(): string {
  return env.ZOHO_ACCOUNTS_DOMAIN.replace(/\/+$/, '');
}

function crmBase(): string {
  return env.ZOHO_CRM_API_DOMAIN.replace(/\/+$/, '');
}

function reauthRequired(cause?: unknown): AppError {
  return new AppError('Reconnect your Zoho account before making CRM changes.', {
    statusCode: 409,
    code: 'ZOHO_REAUTH_REQUIRED',
    expose: true,
    cause,
  });
}

function permissionDenied(cause?: unknown): AppError {
  return new AppError('Your Zoho user does not have permission to make this CRM change.', {
    statusCode: 403,
    code: 'ZOHO_USER_PERMISSION_DENIED',
    expose: true,
    cause,
  });
}

function mutationFailed(operation: string, cause?: unknown): AppError {
  return new AppError(`Zoho could not complete ${operation} as your user.`, {
    statusCode: 502,
    code: 'ZOHO_USER_WRITE_FAILED',
    expose: true,
    cause,
  });
}

/** The real human actor: an impersonating admin, otherwise the signed-in worker. */
export function zohoActorId(ctx: TenantContext): string {
  const principal = ctx.impersonatorUserId ?? ctx.userId;
  const match = /^zoho:(.+)$/.exec(principal);
  const zohoUserId = match?.[1]?.trim();
  if (!zohoUserId || zohoUserId.startsWith('zuid:')) throw reauthRequired();
  return zohoUserId;
}

async function refreshViaStoredToken(
  tenantId: string,
  zohoUserId: string,
  now: number,
): Promise<string> {
  const refreshToken = await workerZohoTokenRepo.find(tenantId, zohoUserId);
  if (!refreshToken) throw reauthRequired();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.ZOHO_SERVER_CLIENT_ID,
    client_secret: env.ZOHO_SERVER_CLIENT_SECRET,
    refresh_token: refreshToken,
  });
  try {
    const res = await fetchWithTimeout(`${accountsBase()}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      logger.warn(
        { zohoUserId, status: res.status, error: json.error },
        'zoho user token refresh failed',
      );
      if (res.status === 400 || res.status === 401 || json.error === 'invalid_code') {
        throw reauthRequired(json.error);
      }
      throw mutationFailed('the CRM authorization refresh', json.error);
    }
    const expiresInMs = (typeof json.expires_in === 'number' ? json.expires_in : 3600) * 1000;
    tokenCache.set(cacheKey(tenantId, zohoUserId), {
      accessToken: json.access_token,
      expiresAt: now + expiresInMs,
    });
    return json.access_token;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn({ err, zohoUserId }, 'zoho user token refresh network error');
    throw mutationFailed('the CRM authorization refresh', err);
  }
}

/** Resolve a usable access token or throw; writes are never retried with the service account. */
export async function getUserAccessToken(
  tenantId: string,
  zohoUserId: string,
  now: number = Date.now(),
): Promise<string> {
  const key = cacheKey(tenantId, zohoUserId);
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - EXPIRY_SKEW_MS > now) return cached.accessToken;

  const existing = inflight.get(key);
  if (existing) return existing;

  const work = refreshViaStoredToken(tenantId, zohoUserId, now).finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, work);
  return work;
}

export function invalidateUserToken(tenantId: string, zohoUserId: string): void {
  tokenCache.delete(cacheKey(tenantId, zohoUserId));
}

/** Test/reauthorization hook: clear cached access tokens after test isolation or account reconnect. */
export function clearUserTokenCache(): void {
  tokenCache.clear();
  inflight.clear();
}

async function parseMutationResponse(
  res: Response,
): Promise<{ json: MutationResponse; text: string }> {
  const text = await res.text().catch(() => '');
  if (!text) return { json: {}, text };
  try {
    return { json: JSON.parse(text) as MutationResponse, text };
  } catch {
    return { json: {}, text };
  }
}

async function requestAsUser(
  tenantId: string,
  zohoUserId: string,
  method: 'DELETE' | 'PATCH' | 'POST' | 'PUT',
  path: string,
  body?: NonNullable<RequestInit['body']>,
  contentType?: string,
  timeoutMs?: number,
): Promise<{ res: Response; json: MutationResponse; text: string }> {
  const accessToken = await getUserAccessToken(tenantId, zohoUserId);
  let res: Response;
  try {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Zoho-oauthtoken ${accessToken}`,
        ...(contentType ? { 'Content-Type': contentType } : {}),
      },
      ...(body === undefined ? {} : { body }),
    };
    res = await fetchWithTimeout(`${crmBase()}${path}`, init, timeoutMs);
  } catch (err) {
    logger.warn({ err, zohoUserId, method, path }, 'zoho user CRM request network error');
    throw mutationFailed('the CRM change', err);
  }

  const parsed = await parseMutationResponse(res);
  const vendorCode = String(parsed.json.data?.[0]?.code ?? parsed.json.code ?? '');
  if (
    res.status === 401 ||
    vendorCode === 'OAUTH_SCOPE_MISMATCH' ||
    vendorCode === 'INVALID_TOKEN'
  ) {
    invalidateUserToken(tenantId, zohoUserId);
    throw reauthRequired(parsed.text.slice(0, 200));
  }
  if (res.status === 403 || vendorCode === 'NO_PERMISSION') {
    throw permissionDenied(parsed.text.slice(0, 200));
  }
  return { res, ...parsed };
}

function firstMutationRow(json: MutationResponse): MutationRow | undefined {
  return json.data?.[0] ?? json.blueprint?.[0];
}

function assertMutationSuccess(
  operation: string,
  res: Response,
  json: MutationResponse,
  text: string,
): string {
  const row: MutationRow = firstMutationRow(json) ?? json;
  const success = row.code === 'SUCCESS' || row.status === 'success';
  if (!res.ok || !success) {
    const detail = `${String(row.code ?? res.status)}: ${String(row.message ?? text.slice(0, 200))}`;
    throw mutationFailed(operation, detail);
  }
  return String(row.details?.id ?? '');
}

export async function insertRecordAsUserDetailed(
  tenantId: string,
  zohoUserId: string,
  module: string,
  data: Record<string, unknown>,
  trigger?: readonly string[],
): Promise<UserMutationResult> {
  const path = `/${encodeURIComponent(module)}`;
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'POST',
    path,
    JSON.stringify({ data: [data], ...(trigger ? { trigger } : {}) }),
    'application/json',
  );
  const row = firstMutationRow(result.json);
  if (!row && !result.res.ok)
    throw mutationFailed(`inserting ${module}`, result.text.slice(0, 200));
  const raw: MutationRow = row ?? result.json;
  return {
    code: String(raw.code ?? ''),
    id: String(raw.details?.id ?? ''),
    message: String(raw.message ?? ''),
    row: raw,
  };
}

export async function insertRecordAsUser(
  tenantId: string,
  zohoUserId: string,
  module: string,
  data: Record<string, unknown>,
  trigger?: readonly string[],
): Promise<string> {
  const path = `/${encodeURIComponent(module)}`;
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'POST',
    path,
    JSON.stringify({ data: [data], ...(trigger ? { trigger } : {}) }),
    'application/json',
  );
  return assertMutationSuccess(`inserting ${module}`, result.res, result.json, result.text);
}

export async function updateRecordAsUser(
  tenantId: string,
  zohoUserId: string,
  module: string,
  id: string,
  data: Record<string, unknown>,
): Promise<string> {
  const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}`;
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'PUT',
    path,
    JSON.stringify({ data: [{ ...data, id }] }),
    'application/json',
  );
  return assertMutationSuccess(`updating ${module}`, result.res, result.json, result.text);
}

/** Partially update one CRM record as the signed-in worker. */
export async function patchRecordAsUser(
  tenantId: string,
  zohoUserId: string,
  module: string,
  id: string,
  data: Record<string, unknown>,
): Promise<string> {
  const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}`;
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'PATCH',
    path,
    JSON.stringify({ data: [{ ...data, id }] }),
    'application/json',
  );
  return assertMutationSuccess(`updating ${module}`, result.res, result.json, result.text);
}

/** Delete one CRM record as the signed-in worker. */
export async function deleteRecordAsUser(
  tenantId: string,
  zohoUserId: string,
  module: string,
  id: string,
): Promise<void> {
  const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}`;
  const result = await requestAsUser(tenantId, zohoUserId, 'DELETE', path);
  if (result.res.status === 204) return;
  assertMutationSuccess(`deleting ${module}`, result.res, result.json, result.text);
}

export async function executeBlueprintTransitionAsUser(
  tenantId: string,
  zohoUserId: string,
  module: string,
  id: string,
  transitionId: string,
  data: Record<string, unknown> = {},
): Promise<void> {
  const path = `/${encodeURIComponent(module)}/${encodeURIComponent(id)}/actions/blueprint`;
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'PUT',
    path,
    JSON.stringify({ blueprint: [{ transition_id: transitionId, data }] }),
    'application/json',
  );
  const row = firstMutationRow(result.json) ?? result.json;
  if (!result.res.ok || (row.code && row.code !== 'SUCCESS')) {
    throw mutationFailed(
      `updating the ${module} Blueprint`,
      row.message ?? result.text.slice(0, 200),
    );
  }
}

export async function attachFileAsUser(
  tenantId: string,
  zohoUserId: string,
  module: string,
  recordId: string,
  fileName: string,
  buffer: Buffer,
  contentType = 'application/octet-stream',
): Promise<string> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: contentType }), fileName);
  const path = `/${encodeURIComponent(module)}/${encodeURIComponent(recordId)}/Attachments`;
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'POST',
    path,
    form,
    undefined,
    ATTACHMENT_TIMEOUT_MS,
  );
  const id = assertMutationSuccess(
    `attaching a file to ${module}`,
    result.res,
    result.json,
    result.text,
  );
  if (!id) throw mutationFailed(`attaching a file to ${module}`, 'Zoho returned no attachment id');
  return id;
}

export async function insertNoteAsUser(
  tenantId: string,
  zohoUserId: string,
  noteData: Record<string, unknown>,
): Promise<string> {
  const result = await requestAsUser(
    tenantId,
    zohoUserId,
    'POST',
    '/Notes',
    JSON.stringify({ data: [noteData] }),
    'application/json',
  );
  const noteId = assertMutationSuccess('creating the note', result.res, result.json, result.text);
  const createdBy = firstMutationRow(result.json)?.details?.Created_By;
  const createdById =
    createdBy && typeof createdBy === 'object'
      ? String((createdBy as { id?: unknown }).id ?? '')
      : '';
  if (createdById && createdById !== zohoUserId) {
    logger.error({ zohoUserId, createdById, noteId }, 'zoho note Created_By mismatch');
    throw new AppError('Zoho did not attribute the note to your user.', {
      statusCode: 502,
      code: 'ZOHO_USER_ATTRIBUTION_MISMATCH',
      expose: true,
      details: { noteId },
    });
  }
  return noteId;
}
