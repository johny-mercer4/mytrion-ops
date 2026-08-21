import { and, eq, gte, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionThreads,
  mytrionTickets,
  type CommsTicketKind,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { commsThreadReaderFilter } from './commsThreadRepo.js';

/**
 * Read-only aggregates for the Desk Analytics & SLA dashboard.
 *
 * The gate is the SAME `commsThreadReaderFilter` every ticket read uses, applied through the identical
 * ticket ⋈ thread join. That is deliberate and load-bearing: a CS agent's dashboard must count exactly the
 * tickets their queue can see and no others, so the numbers can never disagree with the list they came
 * from. No column leaves here that the ticket list does not already expose — these are counts and averages,
 * not rows — so there is nothing for a serializer to redact.
 *
 * "Current state" counts (open / overdue / breached, and the status/priority/department breakdowns) are over
 * ALL visible tickets. The time-boxed figures (volume per day, average resolution / first-response time) are
 * scoped to the trailing `sinceDays` window, because "how fast are we closing things" is a question about
 * recent work, not the whole history.
 */

const OPEN_STATUSES = sql`('open','in_progress','pending_requester','on_hold','escalated')`;

export interface AnalyticsFilter {
  kind?: CommsTicketKind;
  department?: string;
  /** Trailing window for volume + resolution-time stats. Clamped to 1..365; defaults to 30. */
  sinceDays?: number;
}

export interface CommsAnalytics {
  window: { sinceDays: number; since: string };
  totals: { all: number; open: number; resolved: number; closed: number; overdue: number; breached: number };
  sla: {
    firstResponseMet: number;
    firstResponseMissed: number;
    firstResponsePending: number;
    avgResolutionHours: number | null;
    avgFirstResponseHours: number | null;
  };
  byStatus: { key: string; count: number }[];
  byPriority: { key: string; count: number }[];
  byDepartment: { key: string | null; count: number }[];
  volume: { date: string; created: number; resolved: number }[];
  topAssignees: { zohoUserId: string; name: string | null; open: number }[];
}

/** node-postgres hands back bigint/numeric as strings; normalise to a number (or null). */
const n = (v: unknown): number => (v == null ? 0 : Number(v));
const nn = (v: unknown): number | null => (v == null ? null : Number(v));

export const commsAnalyticsRepo = {
  /** Shared WHERE: tenant + the reader gate + optional kind/department. The join carries the gate. */
  baseWhere(ctx: TenantContext, filter: AnalyticsFilter): SQL[] {
    const where: SQL[] = [
      eq(mytrionTickets.tenantId, ctx.tenantId),
      commsThreadReaderFilter(ctx),
    ];
    if (filter.kind) where.push(eq(mytrionTickets.kind, filter.kind));
    if (filter.department) where.push(eq(mytrionTickets.targetDepartment, filter.department));
    return where;
  },

  /**
   * The scalar-aggregate query as a BUILDER, split out so the RBAC-leakage suite can assert the reader
   * gate on `.toSQL()` with no database. Every other query in `summary` shares the identical
   * `baseWhere` + join, so proving the gate here proves it for all of them.
   */
  buildScalarQuery(ctx: TenantContext, filter: AnalyticsFilter = {}) {
    const sinceDays = Math.min(Math.max(Math.trunc(filter.sinceDays ?? 30), 1), 365);
    const where = this.baseWhere(ctx, filter);
    const t = mytrionTickets;
    // Bind the window boundary as an ISO string + explicit cast. Interpolating a raw JS Date inside a
    // `sql` template skips the column type-mapper (unlike `gte(col, date)`), and postgres.js then fails
    // to encode it; a text param cast to timestamptz in SQL is unambiguous.
    const since = sql`${new Date(Date.now() - sinceDays * 86_400_000).toISOString()}::timestamptz`;
    return db
      .select({
        all: sql`count(*)::int`,
        open: sql`count(*) FILTER (WHERE ${t.status} IN ${OPEN_STATUSES})::int`,
        resolved: sql`count(*) FILTER (WHERE ${t.status} = 'resolved')::int`,
        closed: sql`count(*) FILTER (WHERE ${t.status} = 'closed')::int`,
        overdue: sql`count(*) FILTER (WHERE ${t.status} IN ${OPEN_STATUSES} AND ${t.dueAt} IS NOT NULL AND ${t.dueAt} < now())::int`,
        breached: sql`count(*) FILTER (WHERE ${t.breachedAt} IS NOT NULL)::int`,
        frMet: sql`count(*) FILTER (WHERE ${t.firstResponseAt} IS NOT NULL AND (${t.firstResponseDueAt} IS NULL OR ${t.firstResponseAt} <= ${t.firstResponseDueAt}))::int`,
        frMissed: sql`count(*) FILTER (WHERE (${t.firstResponseAt} IS NOT NULL AND ${t.firstResponseDueAt} IS NOT NULL AND ${t.firstResponseAt} > ${t.firstResponseDueAt}) OR (${t.firstResponseAt} IS NULL AND ${t.firstResponseDueAt} IS NOT NULL AND ${t.firstResponseDueAt} < now()))::int`,
        frPending: sql`count(*) FILTER (WHERE ${t.firstResponseAt} IS NULL AND (${t.firstResponseDueAt} IS NULL OR ${t.firstResponseDueAt} >= now()))::int`,
        avgResolutionHours: sql`(avg(EXTRACT(EPOCH FROM (${t.resolvedAt} - ${t.createdAt})) / 3600.0) FILTER (WHERE ${t.resolvedAt} IS NOT NULL AND ${t.resolvedAt} >= ${since}))::float8`,
        avgFirstResponseHours: sql`(avg(EXTRACT(EPOCH FROM (${t.firstResponseAt} - ${t.createdAt})) / 3600.0) FILTER (WHERE ${t.firstResponseAt} IS NOT NULL AND ${t.firstResponseAt} >= ${since}))::float8`,
      })
      .from(mytrionTickets)
      .innerJoin(
        mytrionThreads,
        and(
          eq(mytrionThreads.tenantId, mytrionTickets.tenantId),
          eq(mytrionThreads.id, mytrionTickets.threadId),
        ),
      )
      .where(and(...where));
  },

  async summary(ctx: TenantContext, filter: AnalyticsFilter = {}): Promise<CommsAnalytics> {
    const sinceDays = Math.min(Math.max(Math.trunc(filter.sinceDays ?? 30), 1), 365);
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const where = this.baseWhere(ctx, filter);
    const t = mytrionTickets;

    // The join carries the reader gate; every query below repeats it so each aggregate is scoped
    // identically. `db.select(cols).from().innerJoin()` must specify columns up front — there is no
    // shared pre-selected builder to reuse without losing Drizzle's per-query result typing.
    const joinCond = and(
      eq(mytrionThreads.tenantId, mytrionTickets.tenantId),
      eq(mytrionThreads.id, mytrionTickets.threadId),
    );

    const [scalar] = await this.buildScalarQuery(ctx, filter);

    const [byStatus, byPriority, byDepartment, createdDaily, resolvedDaily, topAssignees] =
      await Promise.all([
        db
          .select({ key: t.status, count: sql`count(*)::int` })
          .from(mytrionTickets)
          .innerJoin(mytrionThreads, joinCond)
          .where(and(...where))
          .groupBy(t.status),
        db
          .select({ key: t.priority, count: sql`count(*)::int` })
          .from(mytrionTickets)
          .innerJoin(mytrionThreads, joinCond)
          .where(and(...where))
          .groupBy(t.priority),
        db
          .select({ key: t.targetDepartment, count: sql`count(*)::int` })
          .from(mytrionTickets)
          .innerJoin(mytrionThreads, joinCond)
          .where(and(...where))
          .groupBy(t.targetDepartment),
        db
          .select({
            date: sql<string>`to_char((${t.createdAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
            count: sql`count(*)::int`,
          })
          .from(mytrionTickets)
          .innerJoin(mytrionThreads, joinCond)
          .where(and(...where, gte(t.createdAt, since)))
          .groupBy(sql`1`),
        db
          .select({
            date: sql<string>`to_char((${t.resolvedAt} AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD')`,
            count: sql`count(*)::int`,
          })
          .from(mytrionTickets)
          .innerJoin(mytrionThreads, joinCond)
          .where(and(...where, sql`${t.resolvedAt} IS NOT NULL`, gte(t.resolvedAt, since)))
          .groupBy(sql`1`),
        db
          .select({
            zohoUserId: t.assigneeZohoUserId,
            name: sql<string | null>`max(${t.assigneeName})`,
            open: sql`count(*)::int`,
          })
          .from(mytrionTickets)
          .innerJoin(mytrionThreads, joinCond)
          .where(and(...where, sql`${t.assigneeZohoUserId} IS NOT NULL`, sql`${t.status} IN ${OPEN_STATUSES}`))
          .groupBy(t.assigneeZohoUserId)
          .orderBy(sql`count(*) DESC`)
          .limit(8),
      ]);

    return {
      window: { sinceDays, since: since.toISOString() },
      totals: {
        all: n(scalar?.all),
        open: n(scalar?.open),
        resolved: n(scalar?.resolved),
        closed: n(scalar?.closed),
        overdue: n(scalar?.overdue),
        breached: n(scalar?.breached),
      },
      sla: {
        firstResponseMet: n(scalar?.frMet),
        firstResponseMissed: n(scalar?.frMissed),
        firstResponsePending: n(scalar?.frPending),
        avgResolutionHours: nn(scalar?.avgResolutionHours),
        avgFirstResponseHours: nn(scalar?.avgFirstResponseHours),
      },
      byStatus: byStatus.map((r) => ({ key: String(r.key), count: n(r.count) })),
      byPriority: byPriority.map((r) => ({ key: String(r.key), count: n(r.count) })),
      byDepartment: byDepartment.map((r) => ({
        key: r.key === null ? null : String(r.key),
        count: n(r.count),
      })),
      volume: mergeDaily(sinceDays, createdDaily, resolvedDaily),
      topAssignees: topAssignees.map((r) => ({
        zohoUserId: String(r.zohoUserId),
        name: r.name ?? null,
        open: n(r.open),
      })),
    };
  },
};

/** Zip created + resolved counts onto one dense per-day series so the chart has no gaps. */
function mergeDaily(
  sinceDays: number,
  created: { date: string; count: unknown }[],
  resolved: { date: string; count: unknown }[],
): { date: string; created: number; resolved: number }[] {
  const c = new Map(created.map((r) => [r.date, n(r.count)]));
  const r = new Map(resolved.map((x) => [x.date, n(x.count)]));
  const out: { date: string; created: number; resolved: number }[] = [];
  // Walk oldest→newest across the whole window so every day has a bar, even a zero one.
  const startMs = Date.now() - (sinceDays - 1) * 86_400_000;
  for (let i = 0; i < sinceDays; i += 1) {
    const day = new Date(startMs + i * 86_400_000).toISOString().slice(0, 10);
    out.push({ date: day, created: c.get(day) ?? 0, resolved: r.get(day) ?? 0 });
  }
  return out;
}
