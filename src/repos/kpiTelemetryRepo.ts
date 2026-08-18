import { sql } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  kpiActivityEvents,
  kpiPresenceEvents,
  kpiPresenceSessions,
  type KpiPresenceState,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';

export const KPI_ACTIVITY_EVENT_NAMES = [
  'navigation.tab_open',
  'navigation.view_open',
  'ui.record_open',
  'ui.search_completed',
  'report.export_completed',
  'crm.lead_open',
  'crm.deal_open',
  'crm.call_click',
  'crm.edit_open',
  'crm.edit_save_success',
  'crm.edit_save_failed',
] as const;

export type KpiActivityEventName = (typeof KPI_ACTIVITY_EVENT_NAMES)[number];

export interface PresenceEventInput {
  clientEventId: string;
  state: KpiPresenceState;
  clientOccurredAt?: Date | null;
}

export interface ActivityEventInput {
  clientEventId: string;
  eventName: KpiActivityEventName;
  sessionId?: string | null;
  entityType?:
    | 'lead'
    | 'deal'
    | 'tab'
    | 'view'
    | 'record'
    | 'client'
    | 'rejection_report'
    | 'retention_case'
    | 'task'
    | 'inbox_message'
    | 'call'
    | 'search'
    | 'report'
    | null;
  entityId?: string | null;
  outcome?: 'success' | 'failed' | 'attempted' | null;
  metadata?: Record<string, string | number | boolean | null> | null;
  clientOccurredAt?: Date | null;
}

export interface TelemetrySourceAvailability {
  presenceAvailable: boolean;
  presenceThrough: Date | null;
  activityAvailable: boolean;
  activityThrough: Date | null;
}

async function presenceSecondsForWorkersDay(
  ctx: TenantContext,
  workerIds: string[],
  dayStart: Date,
  dayEnd: Date,
  includeIdle: boolean,
): Promise<Map<string, number>> {
  if (workerIds.length === 0) return new Map();
  const queryStartIso = new Date(dayStart.getTime() - 90_000).toISOString();
  const queryEndIso = new Date(dayEnd.getTime() + 90_000).toISOString();
  const dayStartIso = dayStart.toISOString();
  const dayEndIso = dayEnd.toISOString();
  const rows = await db.execute(sql`
    with workers as (
      select jsonb_array_elements_text(${JSON.stringify(workerIds)}::jsonb) as worker_id
    ),
    ordered as (
      select
        e."worker_id",
        "received_at",
        "state",
        lead("received_at") over (
          partition by e."worker_id", "session_id" order by "received_at", "id"
        ) as next_at
      from "kpi_presence_events" e
      join workers w on w.worker_id = e."worker_id"
      where e."tenant_id" = ${ctx.tenantId}
        and "received_at" >= ${queryStartIso}::timestamptz
        and "received_at" < ${queryEndIso}::timestamptz
    ),
    visible_intervals as (
      select
        "worker_id",
        greatest("received_at", ${dayStartIso}::timestamptz) as start_at,
        least(
          "next_at",
          "received_at" + interval '60 seconds',
          ${dayEndIso}::timestamptz
        ) as end_at
      from ordered
      where ("state" = 'active' or (${includeIdle} and "state" = 'idle'))
        and "next_at" is not null
        and "next_at" - "received_at" <= interval '90 seconds'
        and "received_at" < ${dayEndIso}::timestamptz
        and "next_at" > ${dayStartIso}::timestamptz
    ),
    edges as (
      select worker_id, start_at as point, 1 as delta from visible_intervals
      union all
      select worker_id, end_at as point, -1 as delta from visible_intervals
    ),
    spans as (
      select
        worker_id,
        point,
        lead(point) over (
          partition by worker_id order by point, delta desc
        ) as next_point,
        sum(delta) over (
          partition by worker_id order by point, delta desc
        ) as depth
      from edges
    )
    select
      worker_id,
      coalesce(sum(extract(epoch from (next_point - point))), 0)::int as seconds
    from spans
    where depth > 0 and next_point is not null
    group by worker_id
  `);
  return new Map(rows.map((row) => [
    String(row.worker_id),
    typeof row.seconds === 'number' ? row.seconds : Number(row.seconds ?? 0),
  ]));
}

export const kpiTelemetryRepo = {
  async sourceAvailabilityForDay(
    ctx: TenantContext,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<TelemetrySourceAvailability> {
    const start = dayStart.toISOString();
    const end = dayEnd.toISOString();
    const rows = await db.execute(sql`
      select
        (select count(*)::int from "kpi_presence_events"
          where "tenant_id" = ${ctx.tenantId}
            and "received_at" >= ${start}::timestamptz
            and "received_at" < ${end}::timestamptz) as presence_count,
        (select max("received_at") from "kpi_presence_events"
          where "tenant_id" = ${ctx.tenantId}
            and "received_at" >= ${start}::timestamptz
            and "received_at" < ${end}::timestamptz) as presence_through,
        (select count(*)::int from "kpi_activity_events"
          where "tenant_id" = ${ctx.tenantId}
            and "received_at" >= ${start}::timestamptz
            and "received_at" < ${end}::timestamptz) as activity_count,
        (select max("received_at") from "kpi_activity_events"
          where "tenant_id" = ${ctx.tenantId}
            and "received_at" >= ${start}::timestamptz
            and "received_at" < ${end}::timestamptz) as activity_through
    `);
    const row = rows[0];
    return {
      presenceAvailable: Number(row?.presence_count ?? 0) > 0,
      presenceThrough: row?.presence_through ? new Date(String(row.presence_through)) : null,
      activityAvailable: Number(row?.activity_count ?? 0) > 0,
      activityThrough: row?.activity_through ? new Date(String(row.activity_through)) : null,
    };
  },

  async lastTelemetryAtForWorkersDay(
    ctx: TenantContext,
    workerIds: string[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Map<string, Date>> {
    if (workerIds.length === 0) return new Map();
    const start = dayStart.toISOString();
    const end = dayEnd.toISOString();
    const rows = await db.execute(sql`
      with workers as (
        select jsonb_array_elements_text(${JSON.stringify(workerIds)}::jsonb) as worker_id
      ), events as (
        select e."worker_id", e."received_at"
        from "kpi_presence_events" e
        join workers w on w.worker_id = e."worker_id"
        where e."tenant_id" = ${ctx.tenantId}
          and e."received_at" >= ${start}::timestamptz
          and e."received_at" < ${end}::timestamptz
        union all
        select e."worker_id", e."received_at"
        from "kpi_activity_events" e
        join workers w on w.worker_id = e."worker_id"
        where e."tenant_id" = ${ctx.tenantId}
          and e."received_at" >= ${start}::timestamptz
          and e."received_at" < ${end}::timestamptz
      )
      select "worker_id", max("received_at") as last_at
      from events
      group by "worker_id"
    `);
    return new Map(rows.map((row) => [
      String(row.worker_id),
      new Date(String(row.last_at)),
    ]));
  },

  async recordPresence(
    ctx: TenantContext,
    workerId: string,
    sessionId: string,
    userAgent: string | null,
    events: PresenceEventInput[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    const now = new Date();
    const ended = [...events].reverse().find((event) => event.state === 'ended');
    await db
      .insert(kpiPresenceSessions)
      .values({
        id: sessionId,
        tenantId: ctx.tenantId,
        workerId,
        userAgent,
        lastEventAt: now,
        endedAt: ended ? now : null,
      })
      .onConflictDoUpdate({
        target: kpiPresenceSessions.id,
        set: {
          lastEventAt: now,
          ...(ended ? { endedAt: now } : {}),
        },
        setWhere: sql`${kpiPresenceSessions.tenantId} = ${ctx.tenantId}
          and ${kpiPresenceSessions.workerId} = ${workerId}`,
      });
    const inserted = await db
      .insert(kpiPresenceEvents)
      .values(
        events.map((event) => ({
          tenantId: ctx.tenantId,
          sessionId,
          workerId,
          clientEventId: event.clientEventId,
          state: event.state,
          clientOccurredAt: event.clientOccurredAt ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [kpiPresenceEvents.tenantId, kpiPresenceEvents.clientEventId],
      })
      .returning({ id: kpiPresenceEvents.id });
    return inserted.length;
  },

  async recordActivity(
    ctx: TenantContext,
    workerId: string,
    events: ActivityEventInput[],
  ): Promise<number> {
    if (events.length === 0) return 0;
    const inserted = await db
      .insert(kpiActivityEvents)
      .values(
        events.map((event) => ({
          tenantId: ctx.tenantId,
          workerId,
          clientEventId: event.clientEventId,
          eventName: event.eventName,
          sessionId: event.sessionId ?? null,
          entityType: event.entityType ?? null,
          entityId: event.entityId ?? null,
          outcome: event.outcome ?? null,
          metadata: event.metadata ?? null,
          clientOccurredAt: event.clientOccurredAt ?? null,
        })),
      )
      .onConflictDoNothing({
        target: [kpiActivityEvents.tenantId, kpiActivityEvents.clientEventId],
      })
      .returning({ id: kpiActivityEvents.id });
    return inserted.length;
  },

  /** Union active heartbeat intervals across tabs/devices; gaps over 90 seconds contribute nothing. */
  async activeSecondsForDay(
    ctx: TenantContext,
    workerId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<number> {
    const values = await this.activeSecondsForWorkersDay(
      ctx,
      [workerId],
      dayStart,
      dayEnd,
    );
    return values.get(workerId) ?? 0;
  },

  async activeSecondsForWorkersDay(
    ctx: TenantContext,
    workerIds: string[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Map<string, number>> {
    return presenceSecondsForWorkersDay(ctx, workerIds, dayStart, dayEnd, false);
  },

  /** Union active + idle visible intervals across overlapping tabs/devices. */
  async visibleSecondsForWorkersDay(
    ctx: TenantContext,
    workerIds: string[],
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Map<string, number>> {
    return presenceSecondsForWorkersDay(ctx, workerIds, dayStart, dayEnd, true);
  },
};
