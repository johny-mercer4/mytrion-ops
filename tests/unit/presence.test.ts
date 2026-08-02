/**
 * Agent presence. Coverage: the write-damping rule that keeps the heartbeat from hammering
 * Postgres, multi-socket connect/disconnect counting (one agent with three tabs is online once),
 * which identities may hold a lease at all, and the shutdown reason that reassignment must ignore.
 *
 * All pure or in-memory — the repo is mocked, so there is no DB dependency.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/repos/agentPresenceRepo.js', () => ({
  agentPresenceRepo: {
    flushLeases: vi.fn(async () => 0),
    deleteInstanceLeases: vi.fn(async () => 0),
    sweepStaleLeases: vi.fn(async () => 0),
  },
}));

import { agentPresenceRepo } from '../../src/repos/agentPresenceRepo.js';
import {
  INSTANCE_ID,
  computeFlushBatch,
  flushPresence,
  onPresenceTransition,
  presenceIdentityOf,
  presenceKeyForTests,
  presenceSnapshotForTests,
  recordConnect,
  recordDisconnect,
  releasePresenceOnShutdown,
  resetPresenceForTests,
  type PresenceTransition,
} from '../../src/modules/realtime/presence.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

const repo = vi.mocked(agentPresenceRepo);

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 't1',
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['customer-service'],
    allDepartmentAccess: false,
    requestId: 'req_1',
    ...over,
  } as TenantContext;
}

beforeEach(() => {
  resetPresenceForTests();
  vi.clearAllMocks();
});
afterEach(() => {
  resetPresenceForTests();
});

describe('presence — computeFlushBatch (write damping)', () => {
  const obs = (socketCount: number) => ({ socketCount, departmentsSnapshot: 'billing' });
  const K = presenceKeyForTests;

  it('writes a row the first time it sees an agent', () => {
    const current = new Map([[K('t1', '42'), obs(1)]]);
    const batch = computeFlushBatch(current, new Map(), 1_000, 30_000);
    expect(batch).toEqual([
      { tenantId: 't1', zohoUserId: '42', socketCount: 1, departmentsSnapshot: 'billing' },
    ]);
  });

  it('writes nothing when the count is unchanged and the lease is fresh', () => {
    const current = new Map([[K('t1', '42'), obs(1)]]);
    const flushed = new Map([[K('t1', '42'), { socketCount: 1, at: 1_000 }]]);
    expect(computeFlushBatch(current, flushed, 1_500, 30_000)).toEqual([]);
  });

  it('writes when the count changed even if the lease is fresh', () => {
    const current = new Map([[K('t1', '42'), obs(2)]]);
    const flushed = new Map([[K('t1', '42'), { socketCount: 1, at: 1_000 }]]);
    expect(computeFlushBatch(current, flushed, 1_500, 30_000)).toHaveLength(1);
  });

  it('refreshes an aging lease so a connected agent never drifts past the staleness cutoff', () => {
    const current = new Map([[K('t1', '42'), obs(1)]]);
    const flushed = new Map([[K('t1', '42'), { socketCount: 1, at: 1_000 }]]);
    expect(computeFlushBatch(current, flushed, 1_000 + 29_999, 30_000)).toEqual([]);
    expect(computeFlushBatch(current, flushed, 1_000 + 30_000, 30_000)).toHaveLength(1);
  });

  it('an idle org of 130 agents costs zero writes between refresh windows', () => {
    const current = new Map<string, ReturnType<typeof obs>>();
    const flushed = new Map<string, { socketCount: number; at: number }>();
    for (let i = 0; i < 130; i += 1) {
      current.set(K('t1', String(i)), obs(1));
      flushed.set(K('t1', String(i)), { socketCount: 1, at: 1_000 });
    }
    // This is the whole point of the damping rule: a naive per-socket-per-heartbeat write would
    // be ~5 statements/second forever for this org.
    expect(computeFlushBatch(current, flushed, 2_000, 30_000)).toEqual([]);
    expect(computeFlushBatch(current, flushed, 31_000, 30_000)).toHaveLength(130);
  });

  it('round-trips a composite key whose ids contain printable separators', () => {
    const current = new Map([[K('tenant-a', 'zoho_user:99'), obs(1)]]);
    const [row] = computeFlushBatch(current, new Map(), 0, 30_000);
    expect(row).toMatchObject({ tenantId: 'tenant-a', zohoUserId: 'zoho_user:99' });
  });
});

describe('presence — identity', () => {
  it('only an internal zoho session can hold a lease', () => {
    expect(presenceIdentityOf(ctxOf())).toEqual({ tenantId: 't1', zohoUserId: '42' });
    // A carrier/driver is never assignable work, so it never occupies a lease row.
    expect(
      presenceIdentityOf(ctxOf({ audience: 'customer', userId: 'client:cu_9', role: 'viewer' })),
    ).toBeNull();
    // API-key / system identities.
    expect(presenceIdentityOf(ctxOf({ userId: 'system' }))).toBeNull();
    // A blank id would make every unlinked employee share one row.
    expect(presenceIdentityOf(ctxOf({ userId: 'zoho:' }))).toBeNull();
  });
});

describe('presence — connect/disconnect counting', () => {
  it('three tabs make one agent online once, and offline only when the last closes', () => {
    const seen: PresenceTransition[] = [];
    onPresenceTransition((t) => seen.push(t));
    const ctx = ctxOf();

    expect(recordConnect(ctx)).toBe(true); // newly online
    expect(recordConnect(ctx)).toBe(false);
    expect(recordConnect(ctx)).toBe(false);
    expect(seen.filter((t) => t.to === 'online')).toHaveLength(1);

    expect(recordDisconnect(ctx)).toBe(false);
    expect(recordDisconnect(ctx)).toBe(false);
    expect(recordDisconnect(ctx)).toBe(true); // last socket
    expect(seen.filter((t) => t.to === 'offline')).toHaveLength(1);
  });

  it('never counts below zero, so a duplicate close cannot fake an extra agent', () => {
    const ctx = ctxOf();
    recordConnect(ctx);
    recordDisconnect(ctx);
    recordDisconnect(ctx);
    expect(presenceSnapshotForTests()).toEqual([
      { tenantId: 't1', zohoUserId: '42', socketCount: 0 },
    ]);
  });

  it('carries the reap reason through, so it is distinguishable from a clean close', () => {
    const seen: PresenceTransition[] = [];
    onPresenceTransition((t) => seen.push(t));
    const ctx = ctxOf();
    recordConnect(ctx);
    recordDisconnect(ctx, 'reaped');
    expect(seen.at(-1)).toMatchObject({ to: 'offline', reason: 'reaped' });
  });

  it('a throwing subscriber cannot break socket bookkeeping', () => {
    onPresenceTransition(() => {
      throw new Error('handler blew up');
    });
    const ctx = ctxOf();
    expect(() => recordConnect(ctx)).not.toThrow();
    expect(presenceSnapshotForTests()).toEqual([
      { tenantId: 't1', zohoUserId: '42', socketCount: 1 },
    ]);
  });
});

describe('presence — flush and shutdown', () => {
  it('flushes pending rows once, then goes quiet until something changes', async () => {
    recordConnect(ctxOf());
    expect(await flushPresence(1_000)).toBe(1);
    expect(repo.flushLeases).toHaveBeenCalledWith(INSTANCE_ID, [
      {
        tenantId: 't1',
        zohoUserId: '42',
        socketCount: 1,
        departmentsSnapshot: 'customer-service',
      },
    ]);
    expect(await flushPresence(1_500)).toBe(0);
  });

  it('a failed flush is swallowed and retried, never thrown at the heartbeat', async () => {
    repo.flushLeases.mockRejectedValueOnce(new Error('db down'));
    recordConnect(ctxOf());
    await expect(flushPresence(1_000)).resolves.toBe(0);
    // Still pending, so the next sweep tries again rather than losing the change.
    repo.flushLeases.mockResolvedValueOnce(1);
    expect(await flushPresence(1_100)).toBe(1);
  });

  it('drops a zero-socket entry from memory once persisted', async () => {
    const ctx = ctxOf();
    recordConnect(ctx);
    await flushPresence(1_000);
    recordDisconnect(ctx);
    await flushPresence(1_100);
    expect(presenceSnapshotForTests()).toEqual([]);
  });

  it("shutdown releases this instance's leases and reports reason 'shutdown'", async () => {
    const seen: PresenceTransition[] = [];
    onPresenceTransition((t) => seen.push(t));
    recordConnect(ctxOf());
    recordConnect(ctxOf({ userId: 'zoho:77' }));

    await releasePresenceOnShutdown();

    expect(repo.deleteInstanceLeases).toHaveBeenCalledWith(INSTANCE_ID);
    expect(presenceSnapshotForTests()).toEqual([]);
    // On a deploy EVERY agent transitions at once. Reassignment must be able to tell this apart
    // from an abandoned ticket, or one deploy dumps the whole queue back.
    expect(seen.filter((t) => t.reason === 'shutdown')).toHaveLength(2);
    expect(seen.every((t) => t.to === 'offline' || t.to === 'online')).toBe(true);
  });

  it('shutdown still clears memory when the delete fails', async () => {
    repo.deleteInstanceLeases.mockRejectedValueOnce(new Error('db down'));
    recordConnect(ctxOf());
    await expect(releasePresenceOnShutdown()).resolves.toBeUndefined();
    expect(presenceSnapshotForTests()).toEqual([]);
  });
});
