/**
 * Registered-user gate at the GATEWAY level — zero tokens for anyone not in the mini-app
 * registration table. The mytrion /support-bot/access list is the single source of truth
 * (a mini-app registration IS the grant); we read it live off a SHORT refresh window so a
 * fresh registration / revoke lands almost immediately.
 *
 * Cheap on purpose: this runs only AFTER gate-1 (mention/reply), so it fires per-MENTION, not
 * per-message — a ~30s refresh window just coalesces a rapid mention burst into one fetch.
 *
 * Two independent clocks:
 *  - REFRESH_MS: how stale the cache may get before we refetch (near-instant registration).
 *  - STALE_GRACE_MS: how long we keep serving a cache when the backend is UNREACHABLE before
 *    failing closed (deny all) — a bot that can't verify identity must not answer. Decoupled
 *    from REFRESH_MS so a short refresh window doesn't shorten outage tolerance.
 */
import { config } from './config.js';

const REFRESH_MS = 30_000; // near-instant: a new registration is visible within ~30s
const STALE_GRACE_MS = 30 * 60_000; // backend-down tolerance before fail-closed
const caches = new Map<string, { at: number; users: Set<string> }>();

export async function isRegistered(carrierId: string, userId: number): Promise<boolean> {
  const now = Date.now();
  let cache = caches.get(carrierId) ?? null;
  if (!cache || now - cache.at > REFRESH_MS) {
    try {
      const res = await fetch(
        `${config.octaneBase}/v1/support-bot/access?carrierId=${encodeURIComponent(carrierId)}`,
        { headers: { Authorization: `Bearer ${config.octaneKey}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as { users?: Array<{ telegramUserId: string }> };
        cache = { at: now, users: new Set((data.users ?? []).map((u) => u.telegramUserId)) };
        caches.set(carrierId, cache);
      }
    } catch {
      /* backend blip — keep serving the stale cache until STALE_GRACE_MS */
    }
  }
  if (!cache) return false;
  if (Date.now() - cache.at > STALE_GRACE_MS) return false; // stale beyond grace → fail closed
  return cache.users.has(String(userId));
}
