/**
 * Home boot preload — fetches the Home page's data DURING the Mytrion entry loader (MytrionGuard's
 * Suspense) so Home reveals fully populated instead of flashing skeletons after the shell mounts.
 *
 * `HomeBootGate` (rendered once, above the shell) fires the preload during boot WITHOUT blocking the
 * entry loader — the shell paints immediately while Home data warms in the background. HomeTab
 * consumes the warm promises on its first render; remount / refresh / View-as fall back to normal
 * per-block loading.
 */
import { getSession } from '@/api/session';
import { getImpersonation } from '@/api/impersonation';
import { getAppStats } from '@/api/dataCenter';
import { loadSnapshot, loadAnnouncements, loadActivity, loadInbox } from './live';

/** Promises filled by the boot preload, consumed once by HomeTab's first render. */
const warm = new Map<string, Promise<unknown>>();

/** Fill the warm cache (boot preload side). */
function fill(ck: string, run: () => Promise<unknown>): Promise<unknown> {
  const p = run();
  warm.set(ck, p);
  return p;
}

/** Consume the warm promise if present (instant, one-shot), else fetch. `fresh` always bypasses. */
function consumeOrRun<T>(ck: string, run: () => Promise<T>, fresh: boolean): Promise<T> {
  if (!fresh) {
    const hit = warm.get(ck) as Promise<T> | undefined;
    if (hit) {
      warm.delete(ck); // one-shot → later remounts / refresh fetch fresh (unchanged behavior)
      return hit;
    }
  }
  return run();
}

// Per-block fetchers shared by the preload and HomeTab so the cache keys line up exactly.
export const homeSnapshot = (key: string, fresh: boolean) =>
  consumeOrRun(`snapshot:${key}`, () => loadSnapshot(fresh), fresh);
export const homeActivityToday = (key: string, fresh: boolean) =>
  consumeOrRun(`activityToday:${key}`, () => loadActivity('today'), fresh);
export const homeAnnouncements = (key: string, fresh: boolean) =>
  consumeOrRun(`announcements:${key}`, () => loadAnnouncements(), fresh);
export const homeInbox = (key: string, fresh: boolean) =>
  consumeOrRun(`inbox:${key}`, () => loadInbox(fresh), fresh);
export const homeAppStats = (key: string, uid: string, fresh: boolean) =>
  consumeOrRun(`appStats:${key}`, () => getAppStats(uid || undefined), fresh);

/** The effective subject (View-as agent, else the signed-in worker) — matches HomeTab's key/uid. */
function bootSubject(): { key: string; uid: string } {
  const impersonated = getImpersonation()?.zohoUserId;
  return { key: impersonated ?? 'self', uid: String(impersonated ?? getSession()?.worker.zohoUserId ?? '') };
}

/** Kick off every Home block for `key`; resolves when all settle (errors don't hang the loader). */
function preloadHome(key: string, uid: string): Promise<unknown> {
  return Promise.allSettled([
    fill(`snapshot:${key}`, () => loadSnapshot(false)),
    fill(`activityToday:${key}`, () => loadActivity('today')),
    fill(`announcements:${key}`, () => loadAnnouncements()),
    fill(`inbox:${key}`, () => loadInbox(false)),
    fill(`appStats:${key}`, () => getAppStats(uid || undefined)),
  ]);
}

let started = false;

/**
 * Renders nothing. Fires the Home preload ONCE during boot (fire-and-forget) so the data is already
 * in flight by the time HomeTab mounts — WITHOUT blocking the entry loader. The shell paints
 * immediately; Home fills in as the warm promises resolve. (An earlier version suspended the whole
 * boot on all five fetches, which made the loader feel too slow.)
 */
export function HomeBootGate(): null {
  if (started) return null;
  started = true;
  const { key, uid } = bootSubject();
  void preloadHome(key, uid);
  return null;
}
