/**
 * Mytrion Watch orchestration: pull features from the DWH, score them, persist the snapshot.
 *
 * The scoring maths is pure (`scoring.ts`) and the SQL is a constant (`featureSql.ts`); this module
 * is the only place the two meet a database. It is also the only writer, so a score and its
 * per-feature contributions can never disagree about how they were produced.
 */
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { dwh } from '../../integrations/dwh.js';
import { isMissingColumn, isMissingTable } from '../../repos/util.js';
import { mytrionWatchRepo, type WatchAggregates, type WatchListFilter } from '../../repos/mytrionWatchRepo.js';
import {
  WATCH_FEATURES,
  WATCH_FEATURE_HELP,
  WATCH_FEATURE_LABEL,
  WATCH_FEATURE_MISSING,
  WATCH_FEATURE_NOUN,
  WATCH_FEATURE_UNIT,
  WATCH_MODEL_VERSION,
} from '../../db/schema/mytrion_watch.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { WATCH_FEATURE_SQL, WATCH_FEATURE_SQL_ONE, type WatchFeatureRow } from './featureSql.js';
import { scoreCarrier, topRiskDrivers, type WatchBin, type WatchModel } from './scoring.js';

const WATCH_TABLES = [
  'mytrion_watch_scores',
  'mytrion_watch_contributions',
  'mytrion_watch_model_bins',
  'mytrion_watch_models',
  'mytrion_watch_runs',
];

/** Deploy-ahead-of-migration → an actionable 503, the same treatment the verification flow gets. */
export function asWatchSchemaError(err: unknown): AppError | null {
  const missing = WATCH_TABLES.some((t) => isMissingTable(err, t) || isMissingColumn(err, t));
  if (!missing) return null;
  return new AppError(
    'Mytrion Watch tables are not migrated on this database. Run `pnpm db:migrate` — migration 0124_mytrion_watch.',
    { statusCode: 503, code: 'MYTRION_WATCH_NOT_MIGRATED', expose: true },
  );
}

async function withWatchSchemaGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const mapped = asWatchSchemaError(err);
    if (mapped) throw mapped;
    throw err;
  }
}

/**
 * Model weights, cached for the process lifetime.
 *
 * They change only when a migration inserts a new `model_version`, and a deploy restarts the
 * process — the same reasoning as the verification status lookup.
 */
let modelCache: { model: WatchModel; binsByFeature: Map<string, WatchBin[]> } | null = null;

async function loadModel(): Promise<{ model: WatchModel; binsByFeature: Map<string, WatchBin[]> }> {
  if (modelCache) return modelCache;
  const loaded = await mytrionWatchRepo.loadModel(WATCH_MODEL_VERSION);
  if (!loaded) {
    throw new AppError(
      `Scoring model ${WATCH_MODEL_VERSION} is not present. Migration 0124_mytrion_watch seeds it.`,
      { statusCode: 503, code: 'MYTRION_WATCH_MODEL_MISSING', expose: true },
    );
  }
  const binsByFeature = new Map<string, WatchBin[]>();
  for (const feature of WATCH_FEATURES) {
    binsByFeature.set(
      feature,
      loaded.bins.filter((b) => b.feature === feature),
    );
  }
  modelCache = { model: loaded.model, binsByFeature };
  return modelCache;
}

export function clearWatchModelCache(): void {
  modelCache = null;
}

const num = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The Monday on or before `d` — the model is defined on weekly cuts. */
export function mondayOf(d: Date): string {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = copy.getUTCDay(); // 0 = Sunday
  const back = dow === 0 ? 6 : dow - 1;
  copy.setUTCDate(copy.getUTCDate() - back);
  return copy.toISOString().slice(0, 10);
}

export interface WatchRunResult {
  scoringDate: string;
  scored: number;
  skipped: number;
  durationMs: number;
  unmatchedFeatures: Record<string, number>;
}

/**
 * Score the whole book for one date and persist the snapshot.
 *
 * Movement is computed against the most recent EARLIER snapshot rather than "last week" exactly, so
 * a missed run shows as a bigger delta instead of a null.
 */
export async function runScoring(
  ctx: TenantContext,
  opts: { scoringDate?: string; trigger?: 'cron' | 'manual'; carrierId?: string } = {},
): Promise<WatchRunResult> {
  return withWatchSchemaGuard(async () => {
    const scoringDate = opts.scoringDate ?? mondayOf(new Date());
    const trigger = opts.carrierId ? 'single' : (opts.trigger ?? 'cron');
    const started = Date.now();
    const runId = await mytrionWatchRepo.startRun(ctx, {
      scoringDate,
      modelVersion: WATCH_MODEL_VERSION,
      trigger,
    });

    try {
      const { model, binsByFeature } = await loadModel();

      const rows = opts.carrierId
        ? await dwh.query<WatchFeatureRow>(WATCH_FEATURE_SQL_ONE, [scoringDate, opts.carrierId])
        : await dwh.query<WatchFeatureRow>(WATCH_FEATURE_SQL, [scoringDate]);

      const previous = await mytrionWatchRepo.previousScores(ctx, scoringDate);
      const unmatchedFeatures: Record<string, number> = {};

      const scoreRows = [];
      const pending: Array<{ carrierId: string; contributions: ReturnType<typeof scoreCarrier>['contributions'] }> = [];

      for (const row of rows) {
        const features: Record<string, number | null> = {
          pay_ratio_31d: num(row.pay_ratio_31d),
          payment_gap: num(row.payment_gap),
          longest_dormant_31d: num(row.longest_dormant_31d),
          recovery_speed: num(row.recovery_speed),
          mob: num(row.mob),
          avg_invoiced_14d: num(row.avg_invoiced_14d),
          median_fuel_31d: num(row.median_fuel_31d),
          night_weekend_ratio_31d: num(row.night_weekend_ratio_31d),
        };

        const result = scoreCarrier(features, binsByFeature, model);
        for (const f of result.unmatched) {
          unmatchedFeatures[f] = (unmatchedFeatures[f] ?? 0) + 1;
        }

        const prev = previous.get(row.carrier_id) ?? null;
        scoreRows.push({
          scoringDate,
          carrierId: row.carrier_id,
          modelVersion: model.modelVersion,
          companyName: row.company_name,
          agentName: row.agent_name,
          creditLimit: row.credit_limit,
          sumContribution: result.sumContribution.toFixed(6),
          logit: result.logit.toFixed(6),
          pdScore: result.pdScore.toFixed(6),
          creditScore: result.creditScore.toFixed(2),
          band: result.band,
          prevCreditScore: prev === null ? null : prev.toFixed(2),
          scoreDelta: prev === null ? null : (result.creditScore - prev).toFixed(2),
          features,
          riskDrivers: topRiskDrivers(result.contributions, binsByFeature, WATCH_FEATURE_NOUN, WATCH_FEATURE_MISSING),
        });
        pending.push({ carrierId: row.carrier_id, contributions: result.contributions });
      }

      const saved = await mytrionWatchRepo.upsertScores(ctx, scoreRows);
      const idByCarrier = new Map(saved.map((s) => [s.carrierId, s.id]));

      const contributionRows = pending.flatMap((p) => {
        const scoreId = idByCarrier.get(p.carrierId);
        if (!scoreId) return [];
        return p.contributions.map((c) => ({
          scoreId,
          scoringDate,
          carrierId: p.carrierId,
          feature: c.feature,
          rawValue: c.rawValue === null ? null : c.rawValue.toFixed(6),
          binId: c.binId,
          woe: c.woe.toFixed(6),
          coef: c.coef.toFixed(6),
          contribution: c.contribution.toFixed(6),
        }));
      });

      // A single-carrier rescore must not wipe the whole date's contributions.
      if (!opts.carrierId) {
        await mytrionWatchRepo.replaceContributions(ctx, scoringDate, contributionRows);
      }

      const durationMs = Date.now() - started;
      await mytrionWatchRepo.finishRun(runId, {
        scoredCount: saved.length,
        skippedCount: rows.length - saved.length,
        durationMs,
      });

      if (Object.keys(unmatchedFeatures).length > 0) {
        // Loud on purpose: the reference SQL contributed zero for an unbinnable value, which makes a
        // gap in the data indistinguishable from a genuinely neutral carrier.
        logger.warn(
          { scoringDate, unmatchedFeatures },
          'mytrion-watch: some features had no matching bin and contributed nothing',
        );
      }

      return { scoringDate, scored: saved.length, skipped: rows.length - saved.length, durationMs, unmatchedFeatures };
    } catch (err) {
      await mytrionWatchRepo.finishRun(runId, {
        scoredCount: 0,
        skippedCount: 0,
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  });
}

export const watchService = {
  runScoring,

  async queue(
    ctx: TenantContext,
    filter: WatchListFilter = {},
  ): Promise<{
    scoringDate: string | null;
    items: unknown[];
    total: number;
    aggregates: WatchAggregates;
    lastRun: unknown;
  }> {
    return withWatchSchemaGuard(async () => {
      const scoringDate = filter.scoringDate ?? (await mytrionWatchRepo.latestScoringDate(ctx));
      if (!scoringDate) {
        return {
          scoringDate: null,
          items: [],
          total: 0,
          aggregates: {
            total: 0, low: 0, watch: 0, elevated: 0, high: 0,
            worsened: 0, improved: 0, avgScore: null, exposureAtRisk: null,
          },
          lastRun: null,
        };
      }
      // Sent with the page rather than fetched separately: "is this snapshot current, and did the
      // run actually finish" is part of reading the list, not a second question.
      const [res, runs] = await Promise.all([
        mytrionWatchRepo.queue(ctx, scoringDate, filter),
        mytrionWatchRepo.recentRuns(ctx, 1),
      ]);
      return { scoringDate, ...res, lastRun: runs[0] ?? null };
    });
  },

  async carrier(ctx: TenantContext, carrierId: string) {
    return withWatchSchemaGuard(async () => {
      const detail = await mytrionWatchRepo.carrierDetail(ctx, carrierId);
      return {
        ...detail,
        /**
         * Label, unit and help travel WITH the score rather than being duplicated in the client.
         * The desk has to write "0.333 out of 2" and "26 days", and only the model knows which is
         * which — a units table copied into the frontend is a units table that will drift.
         */
        featureMeta: WATCH_FEATURES.map((key) => ({
          key,
          label: WATCH_FEATURE_LABEL[key],
          unit: WATCH_FEATURE_UNIT[key],
          help: WATCH_FEATURE_HELP[key],
          noun: WATCH_FEATURE_NOUN[key],
        })),
      };
    });
  },

  async runs(ctx: TenantContext) {
    return withWatchSchemaGuard(() => mytrionWatchRepo.recentRuns(ctx));
  },
};
