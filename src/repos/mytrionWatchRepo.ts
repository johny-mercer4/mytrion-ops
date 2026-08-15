/**
 * Mytrion Watch persistence — scores, per-feature contributions, model weights and run history.
 *
 * Tenant-first `where` on every query, as everywhere else in this codebase; the predicate IS the
 * isolation. Reads are shaped for the desk: a queue page and a carrier history are each one round
 * trip, for the same reason the Verification desk was collapsed to one — the app database is ~300ms
 * away and query count is the only lever that matters.
 */
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { db } from '../db/client.js';
import {
  mytrionWatchContributions,
  mytrionWatchModelBins,
  mytrionWatchModels,
  mytrionWatchRuns,
  mytrionWatchScores,
  type MytrionWatchScore,
  type NewMytrionWatchContribution,
  type NewMytrionWatchScore,
  type WatchBand,
} from '../db/schema/index.js';
import type { TenantContext } from '../types/tenantContext.js';
import { firstOrUndefined, normalizePagination } from './util.js';
import type { WatchBin, WatchModel } from '../modules/mytrionWatch/scoring.ts';

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface WatchListFilter {
  limit?: number | undefined;
  offset?: number | undefined;
  band?: WatchBand | undefined;
  search?: string | undefined;
  /** 'worsened' surfaces the carriers whose score fell since the previous snapshot. */
  movement?: 'worsened' | 'improved' | undefined;
  scoringDate?: string | undefined;
}

export interface WatchAggregates {
  total: number;
  low: number;
  watch: number;
  elevated: number;
  high: number;
  worsened: number;
  improved: number;
  avgScore: number | null;
  exposureAtRisk: number | null;
}

function tenant(ctx: TenantContext): SQL {
  return eq(mytrionWatchScores.tenantId, ctx.tenantId) as SQL;
}

export const mytrionWatchRepo = {
  /** Weights for a model version. Cached by the caller — these change only on retrain. */
  async loadModel(modelVersion: string): Promise<{ model: WatchModel; bins: WatchBin[] } | null> {
    const [head] = await db
      .select()
      .from(mytrionWatchModels)
      .where(eq(mytrionWatchModels.modelVersion, modelVersion))
      .limit(1);
    if (!head) return null;

    const rows = await db
      .select()
      .from(mytrionWatchModelBins)
      .where(eq(mytrionWatchModelBins.modelVersion, modelVersion));

    return {
      model: {
        modelVersion: head.modelVersion,
        intercept: num(head.intercept) ?? 0,
        baseScore: num(head.baseScore) ?? 600,
        baseOdds: num(head.baseOdds) ?? 50,
        pdo: num(head.pdo) ?? 20,
        bandHighBelow: num(head.bandHighBelow) ?? 520,
        bandElevatedBelow: num(head.bandElevatedBelow) ?? 580,
        bandWatchBelow: num(head.bandWatchBelow) ?? 640,
      },
      bins: rows.map((r) => ({
        feature: r.feature,
        binId: r.binId,
        lowerB: num(r.lowerB),
        upperB: num(r.upperB),
        isNan: r.isNan,
        woe: num(r.woe) ?? 0,
        coef: num(r.coef) ?? 0,
      })),
    };
  },

  /** The most recent scoring date that actually has rows. */
  async latestScoringDate(ctx: TenantContext): Promise<string | null> {
    const rows = await db
      .select({ d: sql<string>`max(${mytrionWatchScores.scoringDate})` })
      .from(mytrionWatchScores)
      .where(tenant(ctx));
    return firstOrUndefined(rows)?.d ?? null;
  },

  /**
   * The queue page and its counters in ONE statement.
   *
   * The counters describe the whole book on that date, not the current filter — a chip must be able
   * to say "12 high" while the visible list shows none.
   */
  async queue(
    ctx: TenantContext,
    scoringDate: string,
    filter: WatchListFilter = {},
  ): Promise<{ items: MytrionWatchScore[]; total: number; aggregates: WatchAggregates }> {
    const { limit, offset } = normalizePagination(filter, 500);
    const clauses: SQL[] = [
      sql`tenant_id = ${ctx.tenantId}`,
      sql`scoring_date = ${scoringDate}`,
    ];
    if (filter.band) clauses.push(sql`band = ${filter.band}`);
    if (filter.movement === 'worsened') clauses.push(sql`score_delta < 0`);
    if (filter.movement === 'improved') clauses.push(sql`score_delta > 0`);
    if (filter.search) {
      const needle = `%${filter.search.toLowerCase()}%`;
      clauses.push(
        sql`(lower(coalesce(company_name,'')) like ${needle} or carrier_id like ${needle})`,
      );
    }
    const where = sql.join(clauses, sql` and `);

    const rows = await db.execute<{ bundle: Record<string, unknown> }>(sql`
      with filtered as (
        select * from mytrion_watch_scores where ${where}
        order by credit_score asc
        limit ${limit} offset ${offset}
      ),
      counted as (select count(*)::int n from mytrion_watch_scores where ${where}),
      agg as (
        select
          count(*)::int total,
          count(*) filter (where band = 'low')::int low,
          count(*) filter (where band = 'watch')::int watch,
          count(*) filter (where band = 'elevated')::int elevated,
          count(*) filter (where band = 'high')::int high,
          count(*) filter (where score_delta < 0)::int worsened,
          count(*) filter (where score_delta > 0)::int improved,
          round(avg(credit_score), 1)::float8 avg_score,
          coalesce(sum(credit_limit) filter (where band in ('elevated','high')), 0)::float8 exposure_at_risk
        from mytrion_watch_scores
        where tenant_id = ${ctx.tenantId} and scoring_date = ${scoringDate}
      )
      select jsonb_build_object(
        'items',      coalesce((select jsonb_agg(to_jsonb(f)) from filtered f), '[]'::jsonb),
        'total',      (select n from counted),
        'aggregates', (select to_jsonb(a) from agg a)
      ) as bundle
    `);

    const bundle = (rows as unknown as Array<{ bundle: Record<string, unknown> }>)[0]?.bundle;
    const camel = <T>(o: unknown): T => {
      const src = (o ?? {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) {
        out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
      }
      return out as T;
    };
    const items = Array.isArray(bundle?.items)
      ? (bundle.items as unknown[]).map((r) => camel<MytrionWatchScore>(r))
      : [];
    const aggregates = camel<WatchAggregates>(bundle?.aggregates);

    return { items, total: Number(bundle?.total) || 0, aggregates };
  },

  /** One carrier: the latest score, its per-feature contributions, and the full score history. */
  async carrierDetail(
    ctx: TenantContext,
    carrierId: string,
  ): Promise<{
    score: MytrionWatchScore | null;
    contributions: Array<Record<string, unknown>>;
    history: Array<{ scoringDate: string; creditScore: number; pdScore: number; band: string }>;
  }> {
    const rows = await db.execute<{ bundle: Record<string, unknown> }>(sql`
      with latest as (
        select * from mytrion_watch_scores
        where tenant_id = ${ctx.tenantId} and carrier_id = ${carrierId}
        order by scoring_date desc limit 1
      )
      select jsonb_build_object(
        'score', (select to_jsonb(l) from latest l),
        'contributions', coalesce((
          select jsonb_agg(to_jsonb(c) order by c.contribution desc)
          from mytrion_watch_contributions c
          where c.tenant_id = ${ctx.tenantId}
            and c.score_id = (select id from latest)
        ), '[]'::jsonb),
        'history', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'scoringDate', h.scoring_date,
                   'creditScore', h.credit_score::float8,
                   'pdScore',     h.pd_score::float8,
                   'band',        h.band) order by h.scoring_date)
          from mytrion_watch_scores h
          where h.tenant_id = ${ctx.tenantId} and h.carrier_id = ${carrierId}
        ), '[]'::jsonb)
      ) as bundle
    `);

    const bundle = (rows as unknown as Array<{ bundle: Record<string, unknown> }>)[0]?.bundle;
    const camel = (o: unknown): Record<string, unknown> => {
      const src = (o ?? {}) as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(src)) {
        out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v;
      }
      return out;
    };

    return {
      score: bundle?.score ? (camel(bundle.score) as unknown as MytrionWatchScore) : null,
      contributions: Array.isArray(bundle?.contributions)
        ? (bundle.contributions as unknown[]).map(camel)
        : [],
      history: Array.isArray(bundle?.history)
        ? (bundle.history as Array<{
            scoringDate: string;
            creditScore: number;
            pdScore: number;
            band: string;
          }>)
        : [],
    };
  },

  /** Previous scores keyed by carrier, so a run can compute movement without a query per carrier. */
  async previousScores(
    ctx: TenantContext,
    beforeDate: string,
  ): Promise<Map<string, number>> {
    const rows = await db.execute<{ carrier_id: string; credit_score: string }>(sql`
      select distinct on (carrier_id) carrier_id, credit_score
      from mytrion_watch_scores
      where tenant_id = ${ctx.tenantId} and scoring_date < ${beforeDate}
      order by carrier_id, scoring_date desc
    `);
    const out = new Map<string, number>();
    for (const r of rows as unknown as Array<{ carrier_id: string; credit_score: string }>) {
      const v = num(r.credit_score);
      if (v !== null) out.set(r.carrier_id, v);
    }
    return out;
  },

  /** Upsert a batch of scores. Re-running a date CORRECTS the row rather than adding a second. */
  async upsertScores(
    ctx: TenantContext,
    scores: Array<Omit<NewMytrionWatchScore, 'tenantId'>>,
  ): Promise<MytrionWatchScore[]> {
    if (scores.length === 0) return [];
    return db
      .insert(mytrionWatchScores)
      .values(scores.map((s) => ({ ...s, tenantId: ctx.tenantId })))
      .onConflictDoUpdate({
        target: [
          mytrionWatchScores.tenantId,
          mytrionWatchScores.scoringDate,
          mytrionWatchScores.carrierId,
        ],
        set: {
          modelVersion: sql`excluded.model_version`,
          companyName: sql`excluded.company_name`,
          agentName: sql`excluded.agent_name`,
          creditLimit: sql`excluded.credit_limit`,
          sumContribution: sql`excluded.sum_contribution`,
          logit: sql`excluded.logit`,
          pdScore: sql`excluded.pd_score`,
          creditScore: sql`excluded.credit_score`,
          band: sql`excluded.band`,
          prevCreditScore: sql`excluded.prev_credit_score`,
          scoreDelta: sql`excluded.score_delta`,
          features: sql`excluded.features`,
          riskDrivers: sql`excluded.risk_drivers`,
        },
      })
      .returning();
  },

  async replaceContributions(
    ctx: TenantContext,
    scoringDate: string,
    rows: Array<Omit<NewMytrionWatchContribution, 'tenantId'>>,
  ): Promise<void> {
    if (rows.length === 0) return;
    await db
      .delete(mytrionWatchContributions)
      .where(
        and(
          eq(mytrionWatchContributions.tenantId, ctx.tenantId),
          eq(mytrionWatchContributions.scoringDate, scoringDate),
        ),
      );
    // Chunked: a full book is ~6k rows and a single INSERT with that many parameter groups can
    // exceed the driver's bind limit.
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      await db
        .insert(mytrionWatchContributions)
        .values(rows.slice(i, i + CHUNK).map((r) => ({ ...r, tenantId: ctx.tenantId })));
    }
  },

  async startRun(
    ctx: TenantContext,
    input: { scoringDate: string; modelVersion: string; trigger: 'cron' | 'manual' | 'single' },
  ): Promise<string> {
    const [row] = await db
      .insert(mytrionWatchRuns)
      .values({ ...input, tenantId: ctx.tenantId })
      .returning({ id: mytrionWatchRuns.id });
    return row?.id ?? '';
  },

  async finishRun(
    runId: string,
    input: { scoredCount: number; skippedCount: number; durationMs: number; error?: string | null },
  ): Promise<void> {
    await db
      .update(mytrionWatchRuns)
      .set({ ...input, error: input.error ?? null, finishedAt: new Date() })
      .where(eq(mytrionWatchRuns.id, runId));
  },

  async recentRuns(ctx: TenantContext, limit = 10) {
    return db
      .select()
      .from(mytrionWatchRuns)
      .where(eq(mytrionWatchRuns.tenantId, ctx.tenantId))
      .orderBy(desc(mytrionWatchRuns.startedAt))
      .limit(limit);
  },
};
