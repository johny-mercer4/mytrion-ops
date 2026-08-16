-- Mytrion Watch — behavioural credit scoring for existing carriers.
--
-- Model `forward_all_clean_v1` (LogReg on WoE). Weights live in a TABLE rather than in code so a
-- retrain is an insert with a new model_version and every historical score stays explainable
-- against the weights that actually produced it.
--
-- Hand-written and idempotent, like 0121/0122. Do not apply to Render unless opted in.

CREATE TABLE IF NOT EXISTS mytrion_watch_models (
  model_version       text PRIMARY KEY,
  intercept           numeric(12,6) NOT NULL,
  base_score          numeric(10,4) NOT NULL DEFAULT 600,
  base_odds           numeric(10,4) NOT NULL DEFAULT 50,
  pdo                 numeric(10,4) NOT NULL DEFAULT 20,
  band_high_below     numeric(10,2) NOT NULL DEFAULT 520,
  band_elevated_below numeric(10,2) NOT NULL DEFAULT 580,
  band_watch_below    numeric(10,2) NOT NULL DEFAULT 640,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_watch_model_bins (
  id            text PRIMARY KEY,
  model_version text NOT NULL,
  feature       text NOT NULL,
  bin_id        integer NOT NULL,
  lower_b       numeric(20,6),
  upper_b       numeric(20,6),
  is_nan        boolean NOT NULL DEFAULT false,
  woe           numeric(12,6) NOT NULL,
  coef          numeric(12,6) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_watch_model_bins_version_feature_bin_uq
  ON mytrion_watch_model_bins (model_version, feature, bin_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_watch_model_bins_version_idx
  ON mytrion_watch_model_bins (model_version);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_watch_scores (
  id                text PRIMARY KEY,
  tenant_id         text NOT NULL,
  scoring_date      text NOT NULL,
  carrier_id        text NOT NULL,
  model_version     text NOT NULL,
  company_name      text,
  agent_name        text,
  credit_limit      numeric(14,2),
  sum_contribution  numeric(14,6) NOT NULL,
  logit             numeric(14,6) NOT NULL,
  pd_score          numeric(8,6) NOT NULL,
  credit_score      numeric(10,2) NOT NULL,
  band              text NOT NULL,
  prev_credit_score numeric(10,2),
  score_delta       numeric(10,2),
  features          jsonb NOT NULL DEFAULT '{}'::jsonb,
  risk_drivers      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_watch_scores_tenant_date_carrier_uq
  ON mytrion_watch_scores (tenant_id, scoring_date, carrier_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_watch_scores_tenant_date_band_idx
  ON mytrion_watch_scores (tenant_id, scoring_date, band);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_watch_scores_tenant_carrier_idx
  ON mytrion_watch_scores (tenant_id, carrier_id, scoring_date);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_watch_contributions (
  id           text PRIMARY KEY,
  tenant_id    text NOT NULL,
  score_id     text NOT NULL,
  scoring_date text NOT NULL,
  carrier_id   text NOT NULL,
  feature      text NOT NULL,
  raw_value    numeric(20,6),
  bin_id       integer NOT NULL,
  woe          numeric(12,6) NOT NULL,
  coef         numeric(12,6) NOT NULL,
  contribution numeric(14,6) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mytrion_watch_contributions_score_feature_uq
  ON mytrion_watch_contributions (score_id, feature);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_watch_contributions_tenant_carrier_idx
  ON mytrion_watch_contributions (tenant_id, carrier_id, scoring_date);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mytrion_watch_runs (
  id            text PRIMARY KEY,
  tenant_id     text NOT NULL,
  scoring_date  text NOT NULL,
  model_version text NOT NULL,
  trigger       text NOT NULL DEFAULT 'cron',
  scored_count  integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0,
  duration_ms   integer,
  error         text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mytrion_watch_runs_tenant_date_idx
  ON mytrion_watch_runs (tenant_id, scoring_date);
--> statement-breakpoint

-- The shipped model. Intercept and scaling come from the training export; the band cut-points are
-- ours and are the one part a policy decision may move.
INSERT INTO mytrion_watch_models (model_version, intercept, base_score, base_odds, pdo, notes) VALUES
  ('forward_all_clean_v1', -2.874368, 600, 50, 20,
   'LogReg on WoE. Features from octane.mart_transaction_line_items (deduped by transaction_id, transaction_fuel_quantity) + verification_staging.postlimit_default_list.')
ON CONFLICT (model_version) DO NOTHING;
--> statement-breakpoint

INSERT INTO mytrion_watch_model_bins (id, model_version, feature, bin_id, lower_b, upper_b, is_nan, woe, coef) VALUES
  ('mwb_seed_pay_ratio_31d_m1', 'forward_all_clean_v1', 'pay_ratio_31d', -1, NULL, NULL, true, -0.114759, -0.740190),
  ('mwb_seed_pay_ratio_31d_0', 'forward_all_clean_v1', 'pay_ratio_31d', 0, NULL, 0.469380, false, -2.156863, -0.740190),
  ('mwb_seed_pay_ratio_31d_1', 'forward_all_clean_v1', 'pay_ratio_31d', 1, 0.469380, 0.752688, false, -0.771349, -0.740190),
  ('mwb_seed_pay_ratio_31d_2', 'forward_all_clean_v1', 'pay_ratio_31d', 2, 0.752688, 0.981467, false, -0.284658, -0.740190),
  ('mwb_seed_pay_ratio_31d_3', 'forward_all_clean_v1', 'pay_ratio_31d', 3, 0.981467, 0.999957, false, 0.404365, -0.740190),
  ('mwb_seed_pay_ratio_31d_4', 'forward_all_clean_v1', 'pay_ratio_31d', 4, 0.999957, NULL, false, 0.844066, -0.740190),
  ('mwb_seed_payment_gap_m1', 'forward_all_clean_v1', 'payment_gap', -1, NULL, NULL, true, -1.358245, -0.423288),
  ('mwb_seed_payment_gap_0', 'forward_all_clean_v1', 'payment_gap', 0, NULL, 0.341667, false, -0.002740, -0.423288),
  ('mwb_seed_payment_gap_1', 'forward_all_clean_v1', 'payment_gap', 1, 0.341667, 0.491379, false, 1.763433, -0.423288),
  ('mwb_seed_payment_gap_2', 'forward_all_clean_v1', 'payment_gap', 2, 0.491379, 1.065591, false, 0.807762, -0.423288),
  ('mwb_seed_payment_gap_3', 'forward_all_clean_v1', 'payment_gap', 3, 1.065591, 1.585714, false, -0.060346, -0.423288),
  ('mwb_seed_payment_gap_4', 'forward_all_clean_v1', 'payment_gap', 4, 1.585714, 2.881944, false, -0.628192, -0.423288),
  ('mwb_seed_payment_gap_5', 'forward_all_clean_v1', 'payment_gap', 5, 2.881944, 3.585714, false, -0.062573, -0.423288),
  ('mwb_seed_payment_gap_6', 'forward_all_clean_v1', 'payment_gap', 6, 3.585714, NULL, false, -1.039609, -0.423288),
  ('mwb_seed_longest_dormant_31d_0', 'forward_all_clean_v1', 'longest_dormant_31d', 0, NULL, 2.500000, false, 0.813954, -0.296236),
  ('mwb_seed_longest_dormant_31d_1', 'forward_all_clean_v1', 'longest_dormant_31d', 1, 2.500000, 5.500000, false, 0.433161, -0.296236),
  ('mwb_seed_longest_dormant_31d_2', 'forward_all_clean_v1', 'longest_dormant_31d', 2, 5.500000, 9.500000, false, 0.035814, -0.296236),
  ('mwb_seed_longest_dormant_31d_3', 'forward_all_clean_v1', 'longest_dormant_31d', 3, 9.500000, 16.500000, false, -0.295217, -0.296236),
  ('mwb_seed_longest_dormant_31d_4', 'forward_all_clean_v1', 'longest_dormant_31d', 4, 16.500000, 19.500000, false, -0.880813, -0.296236),
  ('mwb_seed_longest_dormant_31d_5', 'forward_all_clean_v1', 'longest_dormant_31d', 5, 19.500000, 23.500000, false, -0.244725, -0.296236),
  ('mwb_seed_longest_dormant_31d_6', 'forward_all_clean_v1', 'longest_dormant_31d', 6, 23.500000, NULL, false, -0.622301, -0.296236),
  ('mwb_seed_recovery_speed_m1', 'forward_all_clean_v1', 'recovery_speed', -1, NULL, NULL, true, 0.070663, -0.766417),
  ('mwb_seed_recovery_speed_0', 'forward_all_clean_v1', 'recovery_speed', 0, NULL, 1.500000, false, 1.977619, -0.766417),
  ('mwb_seed_recovery_speed_1', 'forward_all_clean_v1', 'recovery_speed', 1, 1.500000, 2.416667, false, 1.831151, -0.766417),
  ('mwb_seed_recovery_speed_2', 'forward_all_clean_v1', 'recovery_speed', 2, 2.416667, 3.291667, false, 0.351331, -0.766417),
  ('mwb_seed_recovery_speed_3', 'forward_all_clean_v1', 'recovery_speed', 3, 3.291667, 4.875000, false, -0.658871, -0.766417),
  ('mwb_seed_recovery_speed_4', 'forward_all_clean_v1', 'recovery_speed', 4, 4.875000, 5.733333, false, -0.955826, -0.766417),
  ('mwb_seed_recovery_speed_5', 'forward_all_clean_v1', 'recovery_speed', 5, 5.733333, 8.366666, false, -1.429595, -0.766417),
  ('mwb_seed_recovery_speed_6', 'forward_all_clean_v1', 'recovery_speed', 6, 8.366666, NULL, false, -0.747282, -0.766417),
  ('mwb_seed_mob_0', 'forward_all_clean_v1', 'mob', 0, NULL, 13.500000, false, -0.995343, -0.420568),
  ('mwb_seed_mob_1', 'forward_all_clean_v1', 'mob', 1, 13.500000, 30.500000, false, -0.812919, -0.420568),
  ('mwb_seed_mob_2', 'forward_all_clean_v1', 'mob', 2, 30.500000, 44.500000, false, 0.497042, -0.420568),
  ('mwb_seed_mob_3', 'forward_all_clean_v1', 'mob', 3, 44.500000, 57.500000, false, -0.414417, -0.420568),
  ('mwb_seed_mob_4', 'forward_all_clean_v1', 'mob', 4, 57.500000, 86.500000, false, 0.550931, -0.420568),
  ('mwb_seed_mob_5', 'forward_all_clean_v1', 'mob', 5, 86.500000, 210.500000, false, 0.069320, -0.420568),
  ('mwb_seed_mob_6', 'forward_all_clean_v1', 'mob', 6, 210.500000, NULL, false, 0.584158, -0.420568),
  ('mwb_seed_avg_invoiced_14d_m1', 'forward_all_clean_v1', 'avg_invoiced_14d', -1, NULL, NULL, true, 0.449311, -0.927313),
  ('mwb_seed_avg_invoiced_14d_0', 'forward_all_clean_v1', 'avg_invoiced_14d', 0, NULL, 376.500000, false, -0.535973, -0.927313),
  ('mwb_seed_avg_invoiced_14d_1', 'forward_all_clean_v1', 'avg_invoiced_14d', 1, 376.500000, 704.382507, false, 0.100016, -0.927313),
  ('mwb_seed_avg_invoiced_14d_2', 'forward_all_clean_v1', 'avg_invoiced_14d', 2, 704.382507, 787.894165, false, 0.979678, -0.927313),
  ('mwb_seed_avg_invoiced_14d_3', 'forward_all_clean_v1', 'avg_invoiced_14d', 3, 787.894165, 947.526245, false, -0.439581, -0.927313),
  ('mwb_seed_avg_invoiced_14d_4', 'forward_all_clean_v1', 'avg_invoiced_14d', 4, 947.526245, 1164.929993, false, 0.449946, -0.927313),
  ('mwb_seed_avg_invoiced_14d_5', 'forward_all_clean_v1', 'avg_invoiced_14d', 5, 1164.929993, 2606.364990, false, -0.156483, -0.927313),
  ('mwb_seed_avg_invoiced_14d_6', 'forward_all_clean_v1', 'avg_invoiced_14d', 6, 2606.364990, NULL, false, 0.267926, -0.927313),
  ('mwb_seed_median_fuel_31d_0', 'forward_all_clean_v1', 'median_fuel_31d', 0, NULL, 15.142500, false, -0.054135, -0.962599),
  ('mwb_seed_median_fuel_31d_1', 'forward_all_clean_v1', 'median_fuel_31d', 1, 15.142500, 33.092501, false, -0.570906, -0.962599),
  ('mwb_seed_median_fuel_31d_2', 'forward_all_clean_v1', 'median_fuel_31d', 2, 33.092501, 53.957500, false, -0.258986, -0.962599),
  ('mwb_seed_median_fuel_31d_3', 'forward_all_clean_v1', 'median_fuel_31d', 3, 53.957500, 78.652500, false, 0.429864, -0.962599),
  ('mwb_seed_median_fuel_31d_4', 'forward_all_clean_v1', 'median_fuel_31d', 4, 78.652500, 84.572498, false, -0.266309, -0.962599),
  ('mwb_seed_median_fuel_31d_5', 'forward_all_clean_v1', 'median_fuel_31d', 5, 84.572498, 154.787506, false, 0.209420, -0.962599),
  ('mwb_seed_median_fuel_31d_6', 'forward_all_clean_v1', 'median_fuel_31d', 6, 154.787506, NULL, false, -0.398283, -0.962599),
  ('mwb_seed_night_weekend_ratio_31d_0', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 0, NULL, 0.381385, false, -0.186902, -0.600202),
  ('mwb_seed_night_weekend_ratio_31d_1', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 1, 0.381385, 0.498705, false, 0.147840, -0.600202),
  ('mwb_seed_night_weekend_ratio_31d_2', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 2, 0.498705, 0.562859, false, -0.119487, -0.600202),
  ('mwb_seed_night_weekend_ratio_31d_3', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 3, 0.562859, 0.593358, false, 0.430468, -0.600202),
  ('mwb_seed_night_weekend_ratio_31d_4', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 4, 0.593358, 0.622300, false, -0.422482, -0.600202),
  ('mwb_seed_night_weekend_ratio_31d_5', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 5, 0.622300, 0.816986, false, 0.404122, -0.600202),
  ('mwb_seed_night_weekend_ratio_31d_6', 'forward_all_clean_v1', 'night_weekend_ratio_31d', 6, 0.816986, NULL, false, -0.022196, -0.600202)
ON CONFLICT (model_version, feature, bin_id) DO NOTHING;
