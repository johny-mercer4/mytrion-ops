/**
 * Worker session storage. The portal's identity now comes from a Zoho OAuth session (a Bearer JWT
 * minted by the backend after the worker signs in), NOT from spoofable URL params. We persist the
 * token pair + the verified worker identity in localStorage so a reload keeps the session; the
 * backend is the real authority (it re-derives RBAC from the signed token on every request).
 */

/** Verified worker identity, as returned by the backend's Zoho callback/refresh. */
export interface SessionWorker {
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
  /** Present on /auth/me; whether the Zoho profile grants see-everything access. */
  allDepartmentAccess?: boolean;
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
