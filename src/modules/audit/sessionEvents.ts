/**
 * Session-scoped audit events — "this happened once, in this session", not "this happened again".
 *
 * Three events are answers to a *when did X start* question rather than a per-request fact:
 * impersonation (`auth.act_as`), a carrier opening the Telegram mini app, and an internal user
 * entering a Mytrion. Written naively they fire on every API call the session makes: `auth.act_as`
 * alone had 9,178 `ok` rows in 30 days against 116 real logins, which is what made the Logins view
 * unreadable — the same fact, restated, drowning the events an admin was looking for.
 *
 * So each is collapsed to one row per (actor, target) per window. A `denied` outcome is NEVER
 * throttled: a refusal is a distinct security event every single time it happens.
 *
 * The gate is two-stage on purpose. An in-process TTL map answers the common case with no I/O; a
 * miss (cold process, second instance, evicted key) falls through to one indexed lookback query
 * before writing. Worst case that is one extra read per key per window per process — and the
 * failure mode is a duplicate row, never a missing one.
 */
import { auditRepo } from '../../repos/auditRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { auditFromContext, type AuditStatus } from './auditLogger.js';

/** Default collapse window. Long enough to cover a working session's request burst. */
export const SESSION_EVENT_WINDOW_MS = 30 * 60_000;

/** Bound the map so a long-lived process can't accumulate a key per actor forever. */
const MAX_KEYS = 5_000;

/** key → epoch ms when the throttle expires. */
const recent = new Map<string, number>();

function sweep(now: number): void {
  for (const [key, expiry] of recent) {
    if (expiry <= now) recent.delete(key);
  }
  // Still oversized after dropping the expired keys: evict oldest-first (Map keeps insertion order).
  if (recent.size > MAX_KEYS) {
    const excess = recent.size - MAX_KEYS;
    let dropped = 0;
    for (const key of recent.keys()) {
      recent.delete(key);
      if (++dropped >= excess) break;
    }
  }
}

/** Visible for tests — clears the in-process gate so cases don't leak into each other. */
export function resetSessionEventCache(): void {
  recent.clear();
}

export interface SessionEventInput {
  action: string;
  status: AuditStatus;
  resourceType?: string;
  resourceId?: string;
  detail?: Record<string, unknown>;
  /** Override the collapse window (ms). */
  windowMs?: number;
}

/**
 * Write an audit row unless an equivalent one was already written for this actor inside the window.
 * Returns true when a row was actually written.
 */
export async function auditSessionEvent(
  ctx: TenantContext,
  input: SessionEventInput,
): Promise<boolean> {
  const { action, status, resourceType, resourceId, detail } = input;
  // A refusal is always its own event — every attempt matters, and they are rare by nature.
  if (status !== 'ok') {
    await auditFromContext(ctx, {
      action,
      status,
      ...(resourceType ? { resourceType } : {}),
      ...(resourceId ? { resourceId } : {}),
      ...(detail ? { detail } : {}),
    });
    return true;
  }

  const windowMs = input.windowMs ?? SESSION_EVENT_WINDOW_MS;
  const now = Date.now();
  const key = `${ctx.tenantId}|${action}|${ctx.userId}|${resourceId ?? ''}`;

  const seen = recent.get(key);
  if (seen !== undefined && seen > now) return false;

  // Cold key: confirm against the table before writing, so a restart or a second instance does not
  // reopen the flood this module exists to close.
  try {
    const already = await auditRepo.existsSince(ctx, {
      action,
      userId: ctx.userId,
      ...(resourceId ? { resourceId } : {}),
      since: new Date(now - windowMs),
    });
    if (already) {
      recent.set(key, now + windowMs);
      return false;
    }
  } catch {
    // The lookback is an optimisation, not the gate. If it fails, prefer writing the row: a
    // duplicate audit entry is recoverable, a silently dropped one is not.
  }

  recent.set(key, now + windowMs);
  sweep(now);
  await auditFromContext(ctx, {
    action,
    status,
    ...(resourceType ? { resourceType } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(detail ? { detail } : {}),
  });
  return true;
}
