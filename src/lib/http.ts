/**
 * fetch with a hard deadline. Outbound integration calls (serverCrm, Zoho, …) must never
 * hang a turn indefinitely — AbortSignal.timeout() aborts the request and any pending body
 * read after `ms`. Callers that pass their own signal keep it (no double-wrapping).
 */
import { env } from '../config/env.js';

export function fetchWithTimeout(
  url: string | URL,
  init: RequestInit = {},
  ms: number = env.OUTBOUND_HTTP_TIMEOUT_MS,
): Promise<Response> {
  return fetch(url, { ...init, signal: init.signal ?? AbortSignal.timeout(ms) });
}
