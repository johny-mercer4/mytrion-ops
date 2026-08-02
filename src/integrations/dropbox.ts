import { createTokenProvider } from './tokenCache.js';
import { env } from '../config/env.js';
import { AppError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Dropbox HTTP API v2 — the storage behind comms chat attachments.
 *
 * Auth is the refresh-token grant, not a long-lived access token. Dropbox access tokens expire in ~4 hours,
 * so a stored access token would break silently in production; the refresh token is the durable credential
 * and lives in `DROPBOX_REFRESH_TOKEN`. Access tokens are held in memory by `createTokenProvider` (the same
 * pattern EFS and CMP use) and coalesced, so a burst of uploads triggers one token call rather than N.
 *
 * NOTE ON ROTATION: Dropbox refresh tokens do not expire unless revoked, which is what makes an env var
 * viable here. If Dropbox is ever configured to rotate them, this module has nowhere to persist a new one —
 * there is no token column in this schema — and the app would keep using a dead credential until the env is
 * updated. That trade is deliberate and matches every other vendor credential in the repo.
 *
 * Two hosts, and they are not interchangeable:
 *   api.dropboxapi.com      JSON-in / JSON-out (metadata, links, session finish)
 *   content.dropboxapi.com  bytes, with the JSON arguments in a `Dropbox-API-Arg` HEADER
 */

const AUTH_URL = 'https://api.dropbox.com/oauth2/token';
const API_HOST = 'https://api.dropboxapi.com/2';
const CONTENT_HOST = 'https://content.dropboxapi.com/2';

/**
 * Dropbox refuses a single-shot upload above 150 MB. We switch well below that: the chunked path is
 * strictly more robust, and sitting near a hard vendor limit means the first oversized file in production
 * is the thing that discovers it.
 */
const SINGLE_SHOT_LIMIT = 120 * 1024 * 1024;
/** Per-append chunk. 8 MB balances request count against memory held per in-flight upload. */
const CHUNK_BYTES = 8 * 1024 * 1024;

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000;
/** Refresh 5 minutes early: an access token that expires mid-upload-session fails the whole session. */
const TOKEN_SKEW_MS = 5 * 60 * 1000;

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_RETRIES = 3;

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

function dropboxError(message: string, status: number, body?: string): AppError {
  return new AppError(`Dropbox: ${message}`, {
    statusCode: status === 429 || status >= 500 ? 502 : 400,
    code: 'DROPBOX_ERROR',
    // Exposed because the caller is an authenticated worker uploading a file and the actionable cases
    // (too large, quota, bad path) are all things they can respond to.
    expose: true,
    ...(body ? { details: { dropbox: body.slice(0, 500) } } : {}),
  });
}

/**
 * Access token from the refresh grant.
 *
 * Form-urlencoded body with Basic auth on the app key/secret — NOT the search-param shape the Zoho
 * wrapper uses. Getting those two confused yields an opaque 400 from Dropbox.
 */
const tokenProvider = createTokenProvider<string>({
  ttlMs: TOKEN_TTL_MS,
  skewMs: TOKEN_SKEW_MS,
  fetch: async () => {
    const key = env.DROPBOX_APP_KEY;
    const secret = env.DROPBOX_APP_SECRET;
    const refresh = env.DROPBOX_REFRESH_TOKEN;
    if (!key || !secret || !refresh) {
      throw new AppError(
        'Dropbox is not configured (DROPBOX_APP_KEY / DROPBOX_APP_SECRET / DROPBOX_REFRESH_TOKEN).',
        { statusCode: 500, code: 'DROPBOX_NOT_CONFIGURED' },
      );
    }
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refresh });
    const res = await fetch(AUTH_URL, {
      method: 'POST',
      headers: {
        // Basic auth rather than client_id/client_secret in the body: both work, this keeps the secret
        // out of anything that logs a request body.
        authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString('base64')}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) throw dropboxError('token refresh failed', res.status, text);
    const json = JSON.parse(text) as TokenResponse;
    if (!json.access_token) throw dropboxError('token refresh returned no access_token', 502, text);
    return json.access_token;
  },
});

/** Exposed for the boot check and for tests — never call it to "warm" a token on a hot path. */
export async function dropboxAccessToken(force = false): Promise<string> {
  return force ? tokenProvider.forceRefresh() : tokenProvider.get();
}

export function dropboxConfigured(): boolean {
  return Boolean(env.DROPBOX_APP_KEY && env.DROPBOX_APP_SECRET && env.DROPBOX_REFRESH_TOKEN);
}

/** Retry-After in ms, or a bounded exponential backoff. Dropbox sends whole seconds. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? Number.parseInt(header, 10) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  return Math.min(500 * 2 ** attempt, 8_000);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * One authenticated request, with a 401 refresh and 429/5xx retries.
 *
 * The 401 path force-refreshes ONCE. Dropbox also answers 401 for a revoked refresh token, so retrying
 * indefinitely would hammer the auth endpoint with a credential that will never work.
 */
async function call(
  url: string,
  // Narrowed to what this module actually sends (a JSON string, or a Buffer for file content) rather
  // than the DOM `BodyInit` union: that global is not in scope under `lib: ES2022` + @types/node once
  // undici's DOM shims stopped being pulled in transitively (Fastify 5 upgrade), and nothing here
  // needs Blob/FormData/streams anyway.
  init: { method: string; headers?: Record<string, string>; body?: string | Uint8Array | undefined },
): Promise<Response> {
  let refreshed = false;
  for (let attempt = 0; ; attempt += 1) {
    const token = await tokenProvider.get();
    const res = await fetch(url, {
      method: init.method,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      await tokenProvider.forceRefresh();
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const delay = retryDelayMs(res, attempt);
      logger.warn({ url, status: res.status, delay, attempt }, 'dropbox retrying');
      await sleep(delay);
      continue;
    }
    return res;
  }
}

/** JSON-in / JSON-out endpoint on the api host. */
async function rpc<T>(path: string, arg: unknown): Promise<T> {
  const res = await call(`${API_HOST}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(arg),
  });
  const text = await res.text();
  if (!res.ok) throw dropboxError(`${path} failed`, res.status, text);
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * `Dropbox-API-Arg` must be HTTP-header safe.
 *
 * Dropbox requires non-ASCII escaped as \uXXXX, and a filename is user-supplied — a Cyrillic or emoji name
 * would otherwise produce an invalid header and a confusing 400. This is the documented escaping.
 */
function apiArg(arg: unknown): string {
  return JSON.stringify(arg).replace(/[\u007f-\uffff]/g, (c) =>
    `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}

export interface DropboxFile {
  /** Dropbox path, e.g. '/comms/octane/mth_x/mta_y-report.pdf'. This is our storage key. */
  pathLower: string;
  id: string;
  size: number;
  contentHash?: string;
}

/** Upload bytes, choosing single-shot or a chunked session by size. Overwrites a colliding path. */
export async function dropboxUpload(
  path: string,
  body: Buffer,
  opts: { mode?: 'add' | 'overwrite' } = {},
): Promise<DropboxFile> {
  return body.length > SINGLE_SHOT_LIMIT
    ? uploadSession(path, body, opts.mode ?? 'overwrite')
    : uploadSingle(path, body, opts.mode ?? 'overwrite');
}

async function uploadSingle(path: string, body: Buffer, mode: string): Promise<DropboxFile> {
  const res = await call(`${CONTENT_HOST}/files/upload`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({ path, mode, autorename: false, mute: true }),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw dropboxError('upload failed', res.status, text);
  return toFile(JSON.parse(text) as Record<string, unknown>);
}

/**
 * Chunked upload for anything past the single-shot limit: start → append_v2 × N → finish.
 *
 * Sequential on purpose. Dropbox sessions are offset-ordered, so concurrent appends would need
 * `close`/offset bookkeeping for a path that is already the rare case.
 */
async function uploadSession(path: string, body: Buffer, mode: string): Promise<DropboxFile> {
  const first = body.subarray(0, CHUNK_BYTES);
  const startRes = await call(`${CONTENT_HOST}/files/upload_session/start`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({ close: false }),
    },
    body: first,
  });
  const startText = await startRes.text();
  if (!startRes.ok) throw dropboxError('upload_session/start failed', startRes.status, startText);
  const sessionId = (JSON.parse(startText) as { session_id?: string }).session_id;
  if (!sessionId) throw dropboxError('upload_session/start returned no session_id', 502, startText);

  let offset = first.length;
  while (offset < body.length) {
    const chunk = body.subarray(offset, Math.min(offset + CHUNK_BYTES, body.length));
    const res = await call(`${CONTENT_HOST}/files/upload_session/append_v2`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'Dropbox-API-Arg': apiArg({ cursor: { session_id: sessionId, offset }, close: false }),
      },
      body: chunk,
    });
    if (!res.ok) {
      throw dropboxError(`upload_session/append_v2 failed at offset ${offset}`, res.status, await res.text());
    }
    offset += chunk.length;
  }

  const finishRes = await call(`${CONTENT_HOST}/files/upload_session/finish`, {
    method: 'POST',
    headers: {
      'content-type': 'application/octet-stream',
      'Dropbox-API-Arg': apiArg({
        cursor: { session_id: sessionId, offset },
        commit: { path, mode, autorename: false, mute: true },
      }),
    },
    // finish takes no additional bytes; every byte already went through start/append.
    body: Buffer.alloc(0),
  });
  const finishText = await finishRes.text();
  if (!finishRes.ok) throw dropboxError('upload_session/finish failed', finishRes.status, finishText);
  return toFile(JSON.parse(finishText) as Record<string, unknown>);
}

function toFile(meta: Record<string, unknown>): DropboxFile {
  const pathLower = typeof meta.path_lower === 'string' ? meta.path_lower : '';
  const id = typeof meta.id === 'string' ? meta.id : '';
  const size = typeof meta.size === 'number' ? meta.size : 0;
  if (!pathLower || !id) {
    throw dropboxError('upload response had no path/id', 502, JSON.stringify(meta));
  }
  return {
    pathLower,
    id,
    size,
    ...(typeof meta.content_hash === 'string' ? { contentHash: meta.content_hash } : {}),
  };
}

/** Download bytes. `maxBytes` is checked against metadata FIRST, so an oversized file is never buffered. */
export async function dropboxDownload(
  path: string,
  maxBytes?: number,
): Promise<{ body: Buffer; size: number }> {
  if (maxBytes !== undefined) {
    const meta = await dropboxMetadata(path);
    if (meta.size > maxBytes) {
      throw new AppError(`File is larger than the ${maxBytes}-byte limit for this operation.`, {
        statusCode: 413,
        code: 'FILE_TOO_LARGE',
        expose: true,
      });
    }
  }
  const res = await call(`${CONTENT_HOST}/files/download`, {
    method: 'POST',
    headers: { 'Dropbox-API-Arg': apiArg({ path }) },
  });
  if (!res.ok) throw dropboxError('download failed', res.status, await res.text());
  const buf = Buffer.from(await res.arrayBuffer());
  return { body: buf, size: buf.length };
}

/** Streaming download, for serving bytes without buffering the whole file. */
export async function dropboxDownloadStream(
  path: string,
): Promise<{ body: ReadableStream<Uint8Array>; size: number | undefined }> {
  const res = await call(`${CONTENT_HOST}/files/download`, {
    method: 'POST',
    headers: { 'Dropbox-API-Arg': apiArg({ path }) },
  });
  if (!res.ok) throw dropboxError('download failed', res.status, await res.text());
  if (!res.body) throw dropboxError('download returned no body', 502);
  const len = res.headers.get('content-length');
  return {
    body: res.body,
    size: len ? Number.parseInt(len, 10) : undefined,
  };
}

export async function dropboxMetadata(path: string): Promise<{ size: number; id: string }> {
  const meta = await rpc<Record<string, unknown>>('/files/get_metadata', { path });
  return {
    size: typeof meta.size === 'number' ? meta.size : 0,
    id: typeof meta.id === 'string' ? meta.id : '',
  };
}

/**
 * A short-lived direct download URL (~4 hours, Dropbox's own expiry).
 *
 * Preferred over a shared link for attachments: `get_temporary_link` returns a URL that serves the BYTES,
 * whereas `sharing/create_shared_link_with_settings` returns an HTML preview page unless `?dl=1` is
 * appended — and it also creates a durable public link, which is the wrong default for a client's document.
 */
export async function dropboxTemporaryLink(path: string): Promise<{ url: string; expiresAt: Date }> {
  const res = await rpc<{ link?: string }>('/files/get_temporary_link', { path });
  if (!res.link) throw dropboxError('get_temporary_link returned no link', 502);
  return { url: res.link, expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000) };
}

/** Delete. A missing path is treated as success — delete must be idempotent for a retried cleanup. */
export async function dropboxDelete(path: string): Promise<void> {
  const res = await call(`${API_HOST}/files/delete_v2`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (res.ok) return;
  const text = await res.text();
  if (/path_lookup\/not_found|not_found/.test(text)) {
    logger.debug({ path }, 'dropbox delete: already gone');
    return;
  }
  throw dropboxError('delete failed', res.status, text);
}

/** Exported for tests and the boot check. */
export const dropboxInternals = {
  SINGLE_SHOT_LIMIT,
  CHUNK_BYTES,
  apiArg,
  retryDelayMs,
  clearToken: () => tokenProvider.clear(),
};
