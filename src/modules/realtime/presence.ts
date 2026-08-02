import { createId } from '@paralleldrive/cuid2';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { agentPresenceRepo, type LeaseUpsert } from '../../repos/agentPresenceRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';

/**
 * Who is online, tracked in memory and flushed to Postgres in batches.
 *
 * The in-memory map is the fast path (a socket opening/closing must not wait on a write); the
 * table is the source of truth that ticket assignment reads in SQL. See
 * src/db/schema/mytrion_agent_presence.ts for why the lease is per-instance.
 */

/** Identifies this web process, so its leases can be invalidated independently of any other. */
export const INSTANCE_ID = `wi_${createId()}`;

/** Emitted when an agent's aggregate liveness flips. Consumers must not block. */
export interface PresenceTransition {
  tenantId: string;
  zohoUserId: string;
  to: 'online' | 'offline';
  at: Date;
  /**
   * `'shutdown'` MUST be ignored by anything that reacts to an agent going offline: on a deploy
   * every agent transitions at once, and treating that as "they abandoned their work" would dump
   * every open ticket back into the queue and page the whole team.
   */
  reason: 'connect' | 'disconnect' | 'reaped' | 'shutdown';
}

/**
 * Composite map key. NUL is the separator because it cannot occur in a tenant id or a Zoho user
 * id, so the key is unambiguous — a printable separator like ':' or ' ' could in principle appear
 * inside an id and make two different agents collide on one key.
 */
type Key = string;
const KEY_SEP = '\u0000';
const keyOf = (tenantId: string, zohoUserId: string): Key => `${tenantId}${KEY_SEP}${zohoUserId}`;
const splitKey = (key: Key): { tenantId: string; zohoUserId: string } => {
  const idx = key.indexOf(KEY_SEP);
  return { tenantId: key.slice(0, idx), zohoUserId: key.slice(idx + KEY_SEP.length) };
};

interface Observed {
  socketCount: number;
  departmentsSnapshot: string | null;
}

/** Live, authoritative-for-this-instance socket counts. */
const observed = new Map<Key, Observed>();
/** What we last wrote, so an unchanged steady state costs no writes. */
const lastFlushed = new Map<Key, { socketCount: number; at: number }>();

const listeners = new Set<(t: PresenceTransition) => void>();

export function onPresenceTransition(handler: (t: PresenceTransition) => void): () => void {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

function emit(t: PresenceTransition): void {
  for (const handler of listeners) {
    try {
      handler(t);
    } catch (err) {
      // A subscriber must never be able to break socket bookkeeping.
      logger.warn({ err, zohoUserId: t.zohoUserId }, 'presence transition handler failed');
    }
  }
}

/** The agent identity a presence lease is keyed on, or null for identities that have none. */
export function presenceIdentityOf(
  ctx: TenantContext,
): { tenantId: string; zohoUserId: string } | null {
  if (ctx.audience !== 'internal') return null;
  if (!ctx.userId.startsWith('zoho:')) return null;
  const zohoUserId = ctx.userId.slice('zoho:'.length);
  // A blank id would make every unlinked employee share one lease row.
  if (zohoUserId.length === 0) return null;
  return { tenantId: ctx.tenantId, zohoUserId };
}

/** Record a socket opening. Returns true when this made the agent newly online. */
export function recordConnect(ctx: TenantContext): boolean {
  const id = presenceIdentityOf(ctx);
  if (!id) return false;
  const key = keyOf(id.tenantId, id.zohoUserId);
  const prev = observed.get(key);
  const socketCount = (prev?.socketCount ?? 0) + 1;
  observed.set(key, {
    socketCount,
    departmentsSnapshot: ctx.departments.length > 0 ? ctx.departments.join(',') : null,
  });
  const cameOnline = socketCount === 1;
  if (cameOnline) {
    emit({ ...id, to: 'online', at: new Date(), reason: 'connect' });
  }
  return cameOnline;
}

/** Record a socket closing. Returns true when this made the agent offline on this instance. */
export function recordDisconnect(
  ctx: TenantContext,
  reason: 'disconnect' | 'reaped' = 'disconnect',
): boolean {
  const id = presenceIdentityOf(ctx);
  if (!id) return false;
  const key = keyOf(id.tenantId, id.zohoUserId);
  const prev = observed.get(key);
  if (!prev) return false;
  const socketCount = Math.max(0, prev.socketCount - 1);
  observed.set(key, { ...prev, socketCount });
  const wentOffline = socketCount === 0;
  if (wentOffline) {
    emit({ ...id, to: 'offline', at: new Date(), reason });
  }
  return wentOffline;
}

/**
 * Decide which leases to write this tick. Pure, so the damping rule is testable without a DB.
 *
 * A row is included when its socket count changed since the last write, or when its lease is old
 * enough that it would otherwise drift past the staleness cutoff and the agent would look offline
 * while actually connected.
 */
export function computeFlushBatch(
  current: Map<Key, Observed>,
  flushed: Map<Key, { socketCount: number; at: number }>,
  now: number,
  refreshMs: number,
): LeaseUpsert[] {
  const batch: LeaseUpsert[] = [];
  for (const [key, obs] of current) {
    const prev = flushed.get(key);
    const changed = prev === undefined || prev.socketCount !== obs.socketCount;
    const aging = prev !== undefined && now - prev.at >= refreshMs;
    if (!changed && !aging) continue;
    const { tenantId, zohoUserId } = splitKey(key);
    batch.push({
      tenantId,
      zohoUserId,
      socketCount: obs.socketCount,
      departmentsSnapshot: obs.departmentsSnapshot,
    });
  }
  return batch;
}

/**
 * Write any pending lease changes. Called from the heartbeat sweep, so it must never throw —
 * a presence write failing is not a reason to stop pinging sockets or to fail a request.
 */
export async function flushPresence(now = Date.now()): Promise<number> {
  const batch = computeFlushBatch(observed, lastFlushed, now, env.PRESENCE_REFRESH_MS);
  if (batch.length === 0) return 0;
  try {
    await agentPresenceRepo.flushLeases(INSTANCE_ID, batch);
    for (const row of batch) {
      lastFlushed.set(keyOf(row.tenantId, row.zohoUserId), {
        socketCount: row.socketCount,
        at: now,
      });
    }
    // Zero-socket entries have been persisted as zero; stop carrying them in memory.
    for (const row of batch) {
      if (row.socketCount === 0) {
        const key = keyOf(row.tenantId, row.zohoUserId);
        observed.delete(key);
        lastFlushed.delete(key);
      }
    }
    return batch.length;
  } catch (err) {
    logger.warn({ err, rows: batch.length }, 'presence flush failed; will retry next sweep');
    return 0;
  }
}

/** The cutoff a lease's `last_seen_at` must beat to count as live. */
export function presenceStaleBefore(now = Date.now()): Date {
  return new Date(now - env.PRESENCE_STALE_MS);
}

/** Boot: clear leases no live process could still own (covers a hard crash). */
export async function sweepStalePresenceOnBoot(): Promise<void> {
  try {
    const removed = await agentPresenceRepo.sweepStaleLeases(presenceStaleBefore());
    if (removed > 0) logger.info({ removed }, 'presence: swept stale leases on boot');
  } catch (err) {
    // Fail open, matching seedMytrionAccessOnBoot: the staleness cutoff in the online predicate
    // already makes stale rows harmless, so this is a latency optimisation, not correctness.
    logger.warn({ err }, 'presence: boot sweep failed (stale leases will age out instead)');
  }
}

/** Graceful shutdown: drop this instance's leases so nobody looks online on a dead process. */
export async function releasePresenceOnShutdown(): Promise<void> {
  const pending = [...observed.entries()].filter(([, o]) => o.socketCount > 0);
  try {
    await agentPresenceRepo.deleteInstanceLeases(INSTANCE_ID);
  } catch (err) {
    logger.warn({ err }, 'presence: shutdown release failed (leases will age out instead)');
  }
  observed.clear();
  lastFlushed.clear();
  // Reason 'shutdown' so reassignment logic can distinguish a deploy from an abandoned ticket.
  const at = new Date();
  for (const [key] of pending) {
    emit({ ...splitKey(key), to: 'offline', at, reason: 'shutdown' });
  }
}

/** Test seam: presence state is module-level, so a suite must be able to reset it. */
export function resetPresenceForTests(): void {
  observed.clear();
  lastFlushed.clear();
  listeners.clear();
}

/**
 * Test/diagnostic view of the in-memory counts. Returns the identity decomposed rather than the
 * raw map key, so tests never encode an assumption about the key separator.
 */
export function presenceSnapshotForTests(): Array<{
  tenantId: string;
  zohoUserId: string;
  socketCount: number;
}> {
  return [...observed.entries()].map(([key, o]) => ({
    ...splitKey(key),
    socketCount: o.socketCount,
  }));
}

/** Test seam: build the internal composite key without depending on its encoding. */
export function presenceKeyForTests(tenantId: string, zohoUserId: string): string {
  return keyOf(tenantId, zohoUserId);
}
