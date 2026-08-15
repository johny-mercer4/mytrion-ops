/**
 * Mytrion Watch — behavioural credit scoring for EXISTING carriers.
 *
 * A logistic-regression-on-WoE model (`forward_all_clean_v1`) scores every active carrier weekly.
 * The features come from the DWH; everything below is OURS, in the app Postgres, because:
 *
 *   - HISTORY CANNOT BE RECONSTRUCTED. The DWH's overdue table is mutated in place — `payment_date`
 *     and `payment_amount` are filled in when a bill is paid — so scoring a past Monday off it uses
 *     knowledge from the future. Its archive holds one week. Every week we do not snapshot is a
 *     week of history that is gone, which is the whole argument for storing rather than computing
 *     on demand.
 *   - The trend IS the product. "PD 0.14" tells a credit agent far less than "620 → 540 over six
 *     weeks, driven by pay ratio", and that only exists if we keep the rows.
 *   - The DWH is a small shared analytics Postgres with a low connection cap. An eight-CTE scoring
 *     query per page view is the pattern we just removed from the Verification desk.
 *
 * Weights live in a TABLE, not in code: a retrain is an insert with a new `model_version`, and
 * every historical score stays explainable against the weights that actually produced it.
 */
import { createId } from '@paralleldrive/cuid2';
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/** The eight features the model reads, in the order the SOP lists them. */
export const WATCH_FEATURES = [
  'pay_ratio_31d',
  'payment_gap',
  'longest_dormant_31d',
  'recovery_speed',
  'mob',
  'avg_invoiced_14d',
  'median_fuel_31d',
  'night_weekend_ratio_31d',
] as const;
export type WatchFeature = (typeof WATCH_FEATURES)[number];

/**
 * Risk bands. Cut on the scaled credit score rather than PD because that is what the desk reads,
 * and the scaling is monotonic so the two can never disagree about ordering.
 */
export const WATCH_BANDS = ['low', 'watch', 'elevated', 'high'] as const;
export type WatchBand = (typeof WATCH_BANDS)[number];

/**
 * Model weights — one row per (version, feature, bin).
 *
 * `lower_b` NULL means -infinity and `upper_b` NULL means +infinity, matching the training export.
 * A bin with `is_nan` true is the one used when the feature is missing.
 */
export const mytrionWatchModelBins = pgTable(
  'mytrion_watch_model_bins',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mwb_${createId()}`),
    modelVersion: text('model_version').notNull(),
    feature: text('feature').notNull(),
    binId: integer('bin_id').notNull(),
    lowerB: numeric('lower_b', { precision: 20, scale: 6 }),
    upperB: numeric('upper_b', { precision: 20, scale: 6 }),
    isNan: boolean('is_nan').notNull().default(false),
    woe: numeric('woe', { precision: 12, scale: 6 }).notNull(),
    coef: numeric('coef', { precision: 12, scale: 6 }).notNull(),
  },
  (table) => ({
    versionFeatureBinUq: uniqueIndex('mytrion_watch_model_bins_version_feature_bin_uq').on(
      table.modelVersion,
      table.feature,
      table.binId,
    ),
    versionIdx: index('mytrion_watch_model_bins_version_idx').on(table.modelVersion),
  }),
);

/**
 * The intercept and score scaling for a model version.
 *
 * Kept beside the bins so a retrain cannot ship new weights against an old intercept — the two
 * together are the model, and separating them is how a scoring system silently drifts.
 */
export const mytrionWatchModels = pgTable('mytrion_watch_models', {
  modelVersion: text('model_version').primaryKey(),
  intercept: numeric('intercept', { precision: 12, scale: 6 }).notNull(),
  /** score = baseScore - factor * ln(baseOdds) - factor * logit; factor = pdo / ln(2). */
  baseScore: numeric('base_score', { precision: 10, scale: 4 }).notNull().default('600'),
  baseOdds: numeric('base_odds', { precision: 10, scale: 4 }).notNull().default('50'),
  pdo: numeric('pdo', { precision: 10, scale: 4 }).notNull().default('20'),
  /** Band cut-points on the scaled score, high band first. */
  bandHighBelow: numeric('band_high_below', { precision: 10, scale: 2 }).notNull().default('520'),
  bandElevatedBelow: numeric('band_elevated_below', { precision: 10, scale: 2 }).notNull().default('580'),
  bandWatchBelow: numeric('band_watch_below', { precision: 10, scale: 2 }).notNull().default('640'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One scored carrier for one scoring date.
 *
 * `(tenant_id, scoring_date, carrier_id)` is unique so a re-run is an upsert rather than a
 * duplicate — re-scoring the same Monday must correct the row, not add a second history point.
 */
export const mytrionWatchScores = pgTable(
  'mytrion_watch_scores',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mws_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    scoringDate: text('scoring_date').notNull(),
    carrierId: text('carrier_id').notNull(),
    modelVersion: text('model_version').notNull(),

    companyName: text('company_name'),
    agentName: text('agent_name'),
    creditLimit: numeric('credit_limit', { precision: 14, scale: 2 }),

    /** Sum of woe x coef across the eight features, before the intercept. */
    sumContribution: numeric('sum_contribution', { precision: 14, scale: 6 }).notNull(),
    logit: numeric('logit', { precision: 14, scale: 6 }).notNull(),
    pdScore: numeric('pd_score', { precision: 8, scale: 6 }).notNull(),
    creditScore: numeric('credit_score', { precision: 10, scale: 2 }).notNull(),
    band: text('band').$type<WatchBand>().notNull(),

    /** Movement against the previous snapshot — the thing the desk actually reads. */
    prevCreditScore: numeric('prev_credit_score', { precision: 10, scale: 2 }),
    scoreDelta: numeric('score_delta', { precision: 10, scale: 2 }),

    /** Raw feature values, kept so a score stays explainable without re-querying the DWH. */
    features: jsonb('features').$type<Record<string, number | null>>().notNull().default({}),
    /** Top risk drivers, highest positive contribution first. */
    riskDrivers: jsonb('risk_drivers').$type<string[]>().notNull().default([]),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantDateCarrierUq: uniqueIndex('mytrion_watch_scores_tenant_date_carrier_uq').on(
      table.tenantId,
      table.scoringDate,
      table.carrierId,
    ),
    tenantDateBandIdx: index('mytrion_watch_scores_tenant_date_band_idx').on(
      table.tenantId,
      table.scoringDate,
      table.band,
    ),
    tenantCarrierIdx: index('mytrion_watch_scores_tenant_carrier_idx').on(
      table.tenantId,
      table.carrierId,
      table.scoringDate,
    ),
  }),
);

/**
 * Per-feature contribution for one scored carrier.
 *
 * Separate from the score row because this is what makes a number defensible: which bin the value
 * fell in, what WoE that bin carries, and how much it moved the logit. A credit agent asked "why
 * did this drop" needs exactly this, and a jsonb blob is not queryable for "which feature moved
 * most across the book this week".
 */
export const mytrionWatchContributions = pgTable(
  'mytrion_watch_contributions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mwc_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    scoreId: text('score_id').notNull(),
    scoringDate: text('scoring_date').notNull(),
    carrierId: text('carrier_id').notNull(),
    feature: text('feature').notNull(),
    rawValue: numeric('raw_value', { precision: 20, scale: 6 }),
    binId: integer('bin_id').notNull(),
    woe: numeric('woe', { precision: 12, scale: 6 }).notNull(),
    coef: numeric('coef', { precision: 12, scale: 6 }).notNull(),
    contribution: numeric('contribution', { precision: 14, scale: 6 }).notNull(),
  },
  (table) => ({
    scoreFeatureUq: uniqueIndex('mytrion_watch_contributions_score_feature_uq').on(
      table.scoreId,
      table.feature,
    ),
    tenantCarrierIdx: index('mytrion_watch_contributions_tenant_carrier_idx').on(
      table.tenantId,
      table.carrierId,
      table.scoringDate,
    ),
  }),
);

/** One row per scoring run — how many carriers, how long, and whether it was cron or manual. */
export const mytrionWatchRuns = pgTable(
  'mytrion_watch_runs',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => `mwr_${createId()}`),
    tenantId: text('tenant_id').notNull(),
    scoringDate: text('scoring_date').notNull(),
    modelVersion: text('model_version').notNull(),
    trigger: text('trigger').$type<'cron' | 'manual' | 'single'>().notNull().default('cron'),
    scoredCount: integer('scored_count').notNull().default(0),
    skippedCount: integer('skipped_count').notNull().default(0),
    durationMs: integer('duration_ms'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => ({
    tenantDateIdx: index('mytrion_watch_runs_tenant_date_idx').on(table.tenantId, table.scoringDate),
  }),
);

export type MytrionWatchScore = typeof mytrionWatchScores.$inferSelect;
export type NewMytrionWatchScore = typeof mytrionWatchScores.$inferInsert;
export type MytrionWatchContribution = typeof mytrionWatchContributions.$inferSelect;
export type NewMytrionWatchContribution = typeof mytrionWatchContributions.$inferInsert;
export type MytrionWatchModelBin = typeof mytrionWatchModelBins.$inferSelect;
export type MytrionWatchModel = typeof mytrionWatchModels.$inferSelect;
export type MytrionWatchRun = typeof mytrionWatchRuns.$inferSelect;

/** The model this build ships with. A retrain adds a new version; it never edits this one. */
export const WATCH_MODEL_VERSION = 'forward_all_clean_v1';

/** Human labels for the drivers, so the UI and the stored `risk_drivers` cannot drift apart. */
export const WATCH_FEATURE_LABEL: Record<WatchFeature, string> = {
  pay_ratio_31d: 'Low payment ratio (31d)',
  payment_gap: 'Abnormal payment gap',
  longest_dormant_31d: 'Long dormant stretch (31d)',
  recovery_speed: 'Slow debt recovery',
  mob: 'Young account',
  avg_invoiced_14d: 'Average invoice deviation',
  median_fuel_31d: 'Fuel spend deviation',
  night_weekend_ratio_31d: 'High night / weekend activity',
};
