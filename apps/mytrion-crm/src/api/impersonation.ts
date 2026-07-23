/**
 * Admin "View as" / act-as store — scoped per Mytrion.
 *
 * Selecting an agent in Sales does NOT apply on the main Mytrion picker (`/main`) or inside
 * another Mytrion (CS, Billing, …). Transport reads the slot for the current path only.
 *
 * Persisted in localStorage + a module cache so non-React transport can attach headers
 * synchronously; ImpersonationProvider mirrors the active Mytrion's slot into React state.
 *
 * Backend still only honors x-act-as-* for verified admin (or granted) sessions.
 */
import {
  isMytrionId,
  mytrionIdFromUrlSlug,
  type MytrionId,
} from '../access/mytrions.config';

export interface Impersonation {
  zohoUserId: string;
  name: string;
  profile?: string;
  role?: string;
}

const KEY = 'octane.actAs.byMytrion.v1';
/** Legacy single global key — migrated into the `sales` slot on first read. */
const LEGACY_KEY = 'octane.actAs.v1';

type Store = Partial<Record<MytrionId, Impersonation>>;

let cache: Store | undefined;

function parseImp(v: unknown): Impersonation | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<Impersonation>;
  return o.zohoUserId && o.name ? (o as Impersonation) : null;
}

/** Active Mytrion from `/main/:slug…`, or null on the picker / non-Mytrion routes. */
export function mytrionIdFromPath(
  pathname: string = typeof window !== 'undefined' ? window.location.pathname : '',
): MytrionId | null {
  const main = /^\/main\/([^/]+)/.exec(pathname);
  if (!main?.[1]) return null;
  const slug = main[1];
  return mytrionIdFromUrlSlug(slug) ?? (isMytrionId(slug) ? slug : null);
}

function readStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Store;
      return parsed && typeof parsed === 'object' ? parsed : {};
    }
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (legacyRaw) {
      const imp = parseImp(JSON.parse(legacyRaw));
      if (imp) {
        const migrated: Store = { sales: imp };
        localStorage.setItem(KEY, JSON.stringify(migrated));
        localStorage.removeItem(LEGACY_KEY);
        return migrated;
      }
    }
  } catch {
    /* ignore */
  }
  return {};
}

function ensureCache(): Store {
  if (cache === undefined) cache = readStore();
  return cache;
}

/**
 * Impersonation for a Mytrion. Omitting `mytrionId` uses the current URL.
 * Returns null on `/main` (picker) so View-as never leaks into the wizard.
 */
export function getImpersonation(mytrionId?: MytrionId | null): Impersonation | null {
  const id = mytrionId === undefined ? mytrionIdFromPath() : mytrionId;
  if (!id) return null;
  return ensureCache()[id] ?? null;
}

/**
 * Set or clear View-as for one Mytrion. No-op when outside a Mytrion route
 * (cannot set a global identity from the picker).
 */
export function setImpersonation(
  imp: Impersonation | null,
  mytrionId?: MytrionId | null,
): void {
  const id = mytrionId === undefined ? mytrionIdFromPath() : mytrionId;
  if (!id) return;
  const next: Store = { ...ensureCache() };
  if (imp) next[id] = imp;
  else delete next[id];
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* module cache still drives this tab */
  }
}

/** x-act-as-* for the current Mytrion path only, or {} on picker / unset. */
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
