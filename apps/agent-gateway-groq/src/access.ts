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
import { incrementCounter } from './metrics.js';
import type { GatewayRole } from './skillRegistry.js';

const REFRESH_MS = 30_000; // near-instant: a new registration is visible within ~30s
const STALE_GRACE_MS = 30 * 60_000; // backend-down tolerance before fail-closed
type RegisteredRole = Exclude<GatewayRole, 'guest'>;
const caches = new Map<
  string,
  { at: number; users: Map<string, RegisteredRole> }
>();
const refreshes = new Map<string, Promise<void>>();

function normalizeRole(profile: unknown): RegisteredRole | null {
  if (profile === 'driver') return 'driver';
  if (profile === 'owner' || profile === 'manager') return 'owner';
  return null;
}

async function refreshCarrier(carrierId: string, now: number): Promise<void> {
  const existing = refreshes.get(carrierId);
  if (existing) return existing;
  const refresh = (async () => {
    try {
      const res = await fetch(
        `${config.octaneBase}/v1/support-bot/access?carrierId=${encodeURIComponent(carrierId)}`,
        { headers: { Authorization: `Bearer ${config.octaneKey}` }, signal: AbortSignal.timeout(15_000) },
      );
      if (res.ok) {
        const data = (await res.json()) as {
          users?: Array<{ telegramUserId: string; profile?: unknown }>;
        };
        const users = new Map<string, RegisteredRole>();
        for (const user of data.users ?? []) {
          const role = normalizeRole(user.profile);
          if (role) users.set(user.telegramUserId, role);
        }
        caches.set(carrierId, {
          at: now,
          users,
        });
      }
    } catch {
      incrementCounter('role_resolution_error_total');
      /* backend blip — keep serving the stale cache until STALE_GRACE_MS */
    }
  })().finally(() => refreshes.delete(carrierId));
  refreshes.set(carrierId, refresh);
  return refresh;
}

export async function registeredRole(
  carrierId: string,
  userId: number,
): Promise<RegisteredRole | null> {
  const now = Date.now();
  let cache = caches.get(carrierId) ?? null;
  if (!cache || now - cache.at > REFRESH_MS) {
    await refreshCarrier(carrierId, now);
    cache = caches.get(carrierId) ?? cache;
  }
  if (!cache || Date.now() - cache.at > STALE_GRACE_MS) {
    incrementCounter('role_guest_total');
    return null;
  }
  const role = cache.users.get(String(userId)) ?? null;
  incrementCounter(role ? 'role_resolution_total' : 'role_guest_total');
  return role;
}

export async function isRegistered(
  carrierId: string,
  userId: number,
): Promise<boolean> {
  return (await registeredRole(carrierId, userId)) !== null;
}
