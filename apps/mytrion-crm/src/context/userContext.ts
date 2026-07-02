/**
 * User context for the external Mytrion app. The Zoho side is now a THIN shim: it reads the CRM
 * user and redirects here, passing identity as URL VALUES (no Embedded App SDK on our side).
 * This module parses + validates that context once, on load.
 *
 * URL contract (the Zoho shim targets this):
 *   /m/:mytrion?uid=<userId>&profile=<profile>&role=<role>&uname=<userName>[&ts=<ms>&sig=<hmac>]
 *
 * TRUST MODEL (decided: "advisory now"): these params drive UI/routing ONLY. They are spoofable —
 * the real security boundary is the backend (x-api-key + server-side department_access RBAC). We
 * still capture optional ts/sig so the backend can later verify them; the browser never holds the
 * HMAC secret, so `trusted` here just records whether a signature rode along, not that it's valid.
 */

export interface UserContext {
  userId: string;
  profile: string;
  role: string;
  userName: string;
  /** Epoch-ms freshness stamp from the shim, if signed. Forwarded to the backend, not verified here. */
  ts?: string;
  /** HMAC from the shim, if signed. Forwarded to the backend (x-octane-sig), not verified here. */
  sig?: string;
  /** True only if the redirect carried sig+ts. Advisory: the backend decides if it's actually valid. */
  trusted: boolean;
}

export type UserContextResult = { ok: true; context: UserContext } | { ok: false; error: string };

/** URL query keys (short, to keep the redirect tidy). */
export const CONTEXT_PARAMS = ['uid', 'profile', 'role', 'uname', 'ts', 'sig'] as const;

/** Mirrors the old MOCK_USER so `vite dev` works standalone (admin, sees everything). */
const DEV_MOCK: UserContext = {
  userId: 'dev-user',
  profile: 'Administrator',
  role: 'CEO',
  userName: 'Dev User',
  trusted: false,
};

/** Parse + validate the four required context values from a query string. */
export function readUserContext(search: string = window.location.search): UserContextResult {
  const q = new URLSearchParams(search);
  const userId = (q.get('uid') ?? '').trim();
  const profile = (q.get('profile') ?? '').trim();
  const role = (q.get('role') ?? '').trim();
  const userName = (q.get('uname') ?? '').trim();
  const ts = (q.get('ts') ?? '').trim();
  const sig = (q.get('sig') ?? '').trim();

  if (!userId || !profile || !role || !userName) {
    if (import.meta.env.DEV) return { ok: true, context: { ...DEV_MOCK } };
    return {
      ok: false,
      error: 'Missing user context — open Mytrion from inside Zoho CRM (it passes who you are).',
    };
  }

  const context: UserContext = { userId, profile, role, userName, trusted: Boolean(sig && ts) };
  if (ts) context.ts = ts;
  if (sig) context.sig = sig;
  return { ok: true, context };
}
