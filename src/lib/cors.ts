/**
 * CORS origin policy, shared by the @fastify/cors plugin and the SSE path. We reflect the
 * caller's Origin (never a bare "*") when it is either an exact configured origin or matches an
 * allowed suffix (e.g. Zoho widgets on `*.zappsusercontent.com`).
 */
import { corsOrigins, corsOriginSuffixes } from '../config/env.js';

export function isAllowedOrigin(origin: string | undefined): boolean {
  // No Origin header = non-browser caller (server-to-server, curl) — allow.
  if (!origin) return true;
  // No configured origins at all = allow-all (local dev convenience).
  if (corsOrigins.length === 0 && corsOriginSuffixes.length === 0) return true;
  if (corsOrigins.includes(origin)) return true;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return corsOriginSuffixes.some((s) => host === s || host.endsWith(`.${s}`));
  } catch {
    return false;
  }
}

/**
 * CORS headers to write directly onto a hijacked (SSE) response. The streaming route bypasses
 * Fastify's reply (reply.hijack + res.writeHead), so the cors plugin's headers don't apply —
 * we echo the allowed Origin here instead.
 */
export function sseCorsHeaders(origin: string | undefined): Record<string, string> {
  if (origin && isAllowedOrigin(origin)) {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Credentials': 'true',
      Vary: 'Origin',
    };
  }
  return {};
}
