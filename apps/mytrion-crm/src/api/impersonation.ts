/**
 * Admin "act as agent" impersonation store. An allDepartmentAccess admin can pick a sales rep; while
 * set, the transport attaches x-act-as-* headers on every request so the BACKEND runs as that rep
 * (owner-scoped data becomes theirs). Persisted in localStorage + a module cache so the non-React
 * transport can read it synchronously; the ImpersonationProvider mirrors it into React state for UI.
 *
 * This only requests impersonation — the backend honors it solely for a verified admin session and
 * audits it. A non-admin sending these headers is ignored server-side.
 */
export interface Impersonation {
  zohoUserId: string;
  name: string;
  profile?: string;
  role?: string;
}

const KEY = 'octane.actAs.v1';
let cache: Impersonation | null | undefined; // undefined = not yet read from storage

function read(): Impersonation | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<Impersonation>;
    return v.zohoUserId && v.name ? (v as Impersonation) : null;
  } catch {
    return null;
  }
}

export function getImpersonation(): Impersonation | null {
  if (cache === undefined) cache = read();
  return cache;
}

export function setImpersonation(imp: Impersonation | null): void {
  cache = imp;
  try {
    if (imp) localStorage.setItem(KEY, JSON.stringify(imp));
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore storage errors — the module cache still drives this tab */
  }
}

/** x-act-as-* headers for the current impersonation, or {} when acting as yourself. */
export function actAsHeaders(): Record<string, string> {
  const imp = getImpersonation();
  if (!imp) return {};
  const h: Record<string, string> = {
    'x-act-as-zoho-user-id': imp.zohoUserId,
    'x-act-as-user-name': imp.name,
  };
  if (imp.profile) h['x-act-as-profile'] = imp.profile;
  if (imp.role) h['x-act-as-role'] = imp.role;
  return h;
}
