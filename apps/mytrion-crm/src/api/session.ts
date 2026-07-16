/**
 * Worker session storage. The portal's identity now comes from a Zoho OAuth session (a Bearer JWT
 * minted by the backend after the worker signs in), NOT from spoofable URL params. We persist the
 * token pair + the verified worker identity in localStorage so a reload keeps the session; the
 * backend is the real authority (it re-derives RBAC from the signed token on every request).
 */

import type { MytrionId } from '../access/mytrions.config';

/** Verified worker identity, as returned by the backend's Zoho callback / /auth/me. */
export interface SessionWorker {
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
  /** Whether the worker has see-everything access (DB-resolved by the backend). */
  allDepartmentAccess?: boolean;
  /** The Mytrions this worker may enter — DB-resolved server-side (authoritative). */
  accessibleMytrions?: MytrionId[];
  /** Auto-route landing target (e.g. Sales Agent → 'sales'); null → the picker. */
  homeMytrion?: MytrionId | null;
  /** Zoho user ids this worker may "View as" (targeted impersonation grant). */
  viewAsUserIds?: string[];
  /** Resolved identities for the view-as targets, for the picker (non-admins get a scoped list). */
  viewAsTargets?: Array<{ zohoUserId: string; name: string | null }>;
}

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  worker: SessionWorker;
}

const KEY = 'octane.session.v1';

export function getSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Partial<StoredSession>;
    if (!s.accessToken || !s.refreshToken || !s.worker?.zohoUserId) return null;
    return s as StoredSession;
  } catch {
    return null;
  }
}

export function setSession(session: StoredSession): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    /* storage full / disabled — the in-memory flow still works for this tab */
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
