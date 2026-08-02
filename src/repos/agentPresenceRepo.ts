import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionAgentAvailability,
  mytrionAgentPresence,
  type AgentAvailability,
  type MytrionAgentAvailability,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrThrow } from './util.js';

/**
 * Agent presence: socket-liveness leases + declared availability.
 *
 * Tenant scoping note. Most functions here take a TenantContext like every other repo. Three do
 * NOT, and are marked INFRA: `flushLeases`, `deleteInstanceLeases` and `sweepStaleLeases` operate
 * on the process's own leases across every tenant, because a single web instance holds sockets for
 * whatever tenants happen to be connected and its shutdown/boot bookkeeping cannot be per-caller.
 * They are called only from the heartbeat plugin and server lifecycle — never from a route — and
 * they are keyed by `instance_id`, which no request can influence.
 */

/** One agent's socket count on THIS instance, as observed by a heartbeat sweep. */
export interface LeaseUpsert {
  tenantId: string;
  zohoUserId: string;
  socketCount: number;
  departmentsSnapshot: string | null;
}

export interface AgentPresenceState {
  zohoUserId: string;
  /** Sockets across every instance. */
  socketCount: number;
  lastSeenAt: string;
}

export interface AvailabilityDto {
  zohoUserId: string;
  availability: AgentAvailability;
  availabilityNote: string | null;
  autoAway: boolean;
  autoAwayReason: string | null;
  changedAt: string;
}

function toAvailabilityDto(row: MytrionAgentAvailability): AvailabilityDto {
  return {
    zohoUserId: row.zohoUserId,
    availability: row.availability,
    availabilityNote: row.availabilityNote ?? null,
    autoAway: row.autoAway,
    autoAwayReason: row.autoAwayReason ?? null,
    changedAt: row.changedAt.toISOString(),
  };
}

/** The default an agent with no row has: connected but never touched the toggle. */
export const DEFAULT_AVAILABILITY: Omit<AvailabilityDto, 'zohoUserId'> = {
  availability: 'available',
  availabilityNote: null,
  autoAway: false,
  autoAwayReason: null,
  changedAt: new Date(0).toISOString(),
};

export const agentPresenceRepo = {
  /**
   * INFRA. Upsert this instance's leases in ONE statement.
   *
   * Batched on purpose: a row-per-socket-per-heartbeat would be ~5 writes/s forever for a
   * 130-person org, which is pure WAL churn on a small Postgres. The caller passes only rows
   * whose count changed or whose lease is aging (see `computeFlushBatch`), so the steady idle
   * state is one statement per refresh window.
   */
  async flushLeases(instanceId: string, rows: LeaseUpsert[]): Promise<number> {
    if (rows.length === 0) return 0;
    const now = new Date();
    await db
      .insert(mytrionAgentPresence)
      .values(
        rows.map((r) => ({
          tenantId: r.tenantId,
          zohoUserId: r.zohoUserId,
          instanceId,
          socketCount: r.socketCount,
          departmentsSnapshot: r.departmentsSnapshot,
          connectedAt: now,
          lastSeenAt: now,
          updatedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: [
          mytrionAgentPresence.tenantId,
          mytrionAgentPresence.zohoUserId,
          mytrionAgentPresence.instanceId,
        ],
        set: {
          socketCount: sql`excluded.socket_count`,
          departmentsSnapshot: sql`excluded.departments_snapshot`,
          lastSeenAt: sql`excluded.last_seen_at`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    return rows.length;
  },

  /**
   * INFRA. Drop every lease this instance owns — the graceful-shutdown flush.
   *
   * Render allows ~30s after SIGTERM, so on a normal deploy this leaves zero stale window and
   * nobody is briefly considered online on a process that no longer exists. A hard crash falls
   * back to `sweepStaleLeases` plus the staleness cutoff in the online predicate.
   */
  async deleteInstanceLeases(instanceId: string): Promise<number> {
    const rows = await db
      .delete(mytrionAgentPresence)
      .where(eq(mytrionAgentPresence.instanceId, instanceId))
      .returning({ id: mytrionAgentPresence.id });
    return rows.length;
  },

  /** INFRA. Boot sweep: clear leases nobody could still be holding. Idempotent; any instance may run it. */
  async sweepStaleLeases(olderThan: Date): Promise<number> {
    const rows = await db
      .delete(mytrionAgentPresence)
      .where(lt(mytrionAgentPresence.lastSeenAt, olderThan))
      .returning({ id: mytrionAgentPresence.id });
    return rows.length;
  },

  /**
   * Live socket counts for the given agents, summed across instances.
   *
   * `staleBefore` is the cutoff a lease must beat to count — passing it in (rather than reading
   * env here) keeps the repo free of config and lets tests pin the boundary exactly.
   */
  async presenceFor(
    ctx: TenantContext,
    zohoUserIds: string[],
    staleBefore: Date,
  ): Promise<AgentPresenceState[]> {
    if (zohoUserIds.length === 0) return [];
    const rows = await db
      .select({
        zohoUserId: mytrionAgentPresence.zohoUserId,
        socketCount: sql<number>`sum(${mytrionAgentPresence.socketCount})::int`,
        lastSeenAt: sql<Date>`max(${mytrionAgentPresence.lastSeenAt})`,
      })
      .from(mytrionAgentPresence)
      .where(
        and(
          eq(mytrionAgentPresence.tenantId, ctx.tenantId),
          inArray(mytrionAgentPresence.zohoUserId, zohoUserIds),
          gt(mytrionAgentPresence.lastSeenAt, staleBefore),
          gt(mytrionAgentPresence.socketCount, 0),
        ),
      )
      .groupBy(mytrionAgentPresence.zohoUserId);

    return rows.map((r) => ({
      zohoUserId: r.zohoUserId,
      socketCount: Number(r.socketCount),
      lastSeenAt: new Date(r.lastSeenAt).toISOString(),
    }));
  },

  async getAvailability(ctx: TenantContext, zohoUserId: string): Promise<AvailabilityDto> {
    const [row] = await db
      .select()
      .from(mytrionAgentAvailability)
      .where(
        and(
          eq(mytrionAgentAvailability.tenantId, ctx.tenantId),
          eq(mytrionAgentAvailability.zohoUserId, zohoUserId),
        ),
      )
      .limit(1);
    return row ? toAvailabilityDto(row) : { zohoUserId, ...DEFAULT_AVAILABILITY };
  },

  async listAvailability(ctx: TenantContext, zohoUserIds: string[]): Promise<AvailabilityDto[]> {
    if (zohoUserIds.length === 0) return [];
    const rows = await db
      .select()
      .from(mytrionAgentAvailability)
      .where(
        and(
          eq(mytrionAgentAvailability.tenantId, ctx.tenantId),
          inArray(mytrionAgentAvailability.zohoUserId, zohoUserIds),
        ),
      );
    return rows.map(toAvailabilityDto);
  },

  /**
   * Set an agent's declared availability.
   *
   * `autoAway` is passed explicitly rather than inferred: the agent choosing 'away' and the
   * server parking them are different facts, and the UI must be able to say which happened.
   * A caller-initiated change always clears it — that is the agent opting back in.
   */
  async setAvailability(
    ctx: TenantContext,
    zohoUserId: string,
    patch: {
      availability: AgentAvailability;
      note?: string | null;
      autoAway?: boolean;
      autoAwayReason?: string | null;
    },
  ): Promise<AvailabilityDto> {
    const now = new Date();
    const values = {
      tenantId: ctx.tenantId,
      zohoUserId,
      availability: patch.availability,
      availabilityNote: patch.note ?? null,
      autoAway: patch.autoAway ?? false,
      autoAwayReason: patch.autoAwayReason ?? null,
      changedAt: now,
      updatedAt: now,
    };
    const rows = await db
      .insert(mytrionAgentAvailability)
      .values(values)
      .onConflictDoUpdate({
        target: [mytrionAgentAvailability.tenantId, mytrionAgentAvailability.zohoUserId],
        set: {
          availability: values.availability,
          availabilityNote: values.availabilityNote,
          autoAway: values.autoAway,
          autoAwayReason: values.autoAwayReason,
          changedAt: values.changedAt,
          updatedAt: values.updatedAt,
        },
      })
      .returning();
    return toAvailabilityDto(firstOrThrow(rows, 'availability upsert returned no row'));
  },
};
