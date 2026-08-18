/**
 * Global "View as" (RBAC preview) store.
 *
 * ONE identity for the whole app: picking a user applies in every section and persists across
 * navigation — a testing lens for admins. (This replaced a per-Mytrion store; callers that passed a
 * `mytrionId` still compile — the argument is now ignored — and `getImpersonation()` with no argument,
 * which is how every live caller already reads it, returns the single global identity.)
 *
 * Persisted in localStorage + a module cache so the non-React transport can attach `x-act-as-*`
 * headers synchronously; ImpersonationProvider mirrors it into React, and the EFFECTIVE UserContext is
 * re-resolved from the target (see api/viewAs.ts) so the whole UI renders as them.
 *
 * The backend still only honors `x-act-as-*` for a verified admin (or a granted target) and re-derives
 * the target's context server-side — so this preview can never widen what the target may actually do.
 */
import type { MytrionId } from '../access/mytrions.config';

export interface Impersonation {
  zohoUserId: string;
  name: string;
  profile?: string;
  role?: string;
}

/** Single global slot. */
const KEY = 'octane.actAs.global.v1';
/** Prior stores migrated on first read: a per-Mytrion map, then the original single value. */
const LEGACY_MAP_KEY = 'octane.actAs.byMytrion.v1';
const LEGACY_SINGLE_KEY = 'octane.actAs.v1';

let cache: Impersonation | null | undefined;

function parseImp(v: unknown): Impersonation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<Impersonation>;
  return o.zohoUserId && o.name ? (o as Impersonation) : null;
}

function readStore(): Impersonation | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return parseImp(JSON.parse(raw));
    // Migrate a per-Mytrion map (take whichever slot was set) or the original single value.
    const mapRaw = localStorage.getItem(LEGACY_MAP_KEY);
    if (mapRaw) {
      const map = JSON.parse(mapRaw) as Record<string, unknown>;
      const first = map && typeof map === 'object' ? Object.values(map).map(parseImp).find(Boolean) : null;
      localStorage.removeItem(LEGACY_MAP_KEY);
      if (first) {
        localStorage.setItem(KEY, JSON.stringify(first));
        return first;
      }
    }
    const singleRaw = localStorage.getItem(LEGACY_SINGLE_KEY);
    if (singleRaw) {
      const imp = parseImp(JSON.parse(singleRaw));
      localStorage.removeItem(LEGACY_SINGLE_KEY);
      if (imp) {
        localStorage.setItem(KEY, JSON.stringify(imp));
        return imp;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function ensureCache(): Impersonation | null {
  if (cache === undefined) cache = readStore();
  return cache;
}

/**
 * The active View-as identity, or null. `_mytrionId` is accepted and ignored for back-compat with the
 * former per-Mytrion store — there is one global identity now.
 */
export function getImpersonation(_mytrionId?: MytrionId | null): Impersonation | null {
  return ensureCache();
}

/** Set or clear the global View-as identity. `_mytrionId` is accepted and ignored (see getImpersonation). */
export function setImpersonation(imp: Impersonation | null, _mytrionId?: MytrionId | null): void {
  cache = imp;
  try {
    if (imp) localStorage.setItem(KEY, JSON.stringify(imp));
    else localStorage.removeItem(KEY);
  } catch {
    /* module cache still drives this tab */
  }
}

/** x-act-as-* for the active identity, or {} when acting as self. */
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
