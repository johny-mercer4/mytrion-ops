/** Tenant-wide, single-flight registration snapshot for up to 800 mapped groups. */
import { config } from './config.js';
import { incrementCounter } from './metrics.js';
import { supportBotHeaders } from './octaneClient.js';
import type { GatewayRole } from './skillRegistry.js';

type RegisteredRole = Exclude<GatewayRole, 'guest'>;
let cache: { at: number; users: Map<string, RegisteredRole> } | null = null;
let refreshInFlight: Promise<void> | null = null;
let lastMissRefresh = 0;
const MISS_REFRESH_MS = 15_000;

function normalizeRole(profile: unknown): RegisteredRole | null {
  if (profile === 'driver') return 'driver';
  if (profile === 'owner' || profile === 'manager') return 'owner';
  return null;
}

function accessKey(carrierId: string, telegramUserId: string): string {
  return `${carrierId}\u0000${telegramUserId}`;
}

async function refreshSnapshot(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const response = await fetch(`${config.octaneBase}/v1/support-bot/access-snapshot`, {
        headers: supportBotHeaders(),
        signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error(`support access HTTP ${response.status}`);
      const payload = (await response.json()) as {
        users?: Array<{
          carrierId?: unknown;
          telegramUserId?: unknown;
          profile?: unknown;
        }>;
      };
      const rows = payload.users ?? [];
      if (rows.length > config.accessSnapshotMaxUsers) {
        throw new Error('support access snapshot exceeds the gateway safety cap');
      }
      const users = new Map<string, RegisteredRole>();
      for (const row of rows) {
        if (typeof row.carrierId !== 'string' || typeof row.telegramUserId !== 'string') continue;
        const role = normalizeRole(row.profile);
        if (role) users.set(accessKey(row.carrierId, row.telegramUserId), role);
      }
      cache = { at: Date.now(), users };
    } catch (error) {
      incrementCounter('role_resolution_error_total');
      console.warn(
        '[access] snapshot refresh failed; retaining bounded stale cache',
        error instanceof Error ? error.message : String(error),
      );
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

export async function registeredRole(
  carrierId: string,
  userId: number,
): Promise<RegisteredRole | null> {
  const now = Date.now();
  let refreshed = false;
  if (!cache || now - cache.at > config.accessSnapshotRefreshMs) {
    await refreshSnapshot();
    refreshed = true;
  }
  if (!cache || Date.now() - cache.at > config.accessSnapshotStaleGraceMs) {
    incrementCounter('role_guest_total');
    return null;
  }
  let role = cache.users.get(accessKey(carrierId, String(userId))) ?? null;
  // A user may have completed mini-app registration seconds after the last scheduled snapshot.
  // Refresh a miss promptly, but globally bounded, so onboarding works without turning unknown
  // group traffic into a backend hot loop.
  if (!role && !refreshed && now - lastMissRefresh >= MISS_REFRESH_MS) {
    lastMissRefresh = now;
    await refreshSnapshot();
    role = cache?.users.get(accessKey(carrierId, String(userId))) ?? null;
  } else if (!role && refreshed) {
    lastMissRefresh = now;
  }
  incrementCounter(role ? 'role_resolution_total' : 'role_guest_total');
  return role;
}

export async function isRegistered(carrierId: string, userId: number): Promise<boolean> {
  return (await registeredRole(carrierId, userId)) !== null;
}

export function accessSnapshotStats(): { ageMs: number | null; users: number } {
  return { ageMs: cache ? Date.now() - cache.at : null, users: cache?.users.size ?? 0 };
}
