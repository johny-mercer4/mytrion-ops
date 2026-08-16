/**
 * The DWH feature query for Mytrion Watch — one statement, eight features, all carriers.
 *
 * SOURCE OF TRUTH IS `octane.mart_transaction_line_items`, and the grain matters enormously:
 *
 *   That table is at LINE-ITEM grain (1.33M rows) while the model was trained on TRANSACTION grain
 *   (971k). `median_fuel_31d` is a median over transactions and `night_weekend_ratio_31d` counts
 *   transactions, so feeding line items would inflate both and quietly shift every carrier into the
 *   wrong bin. We therefore DISTINCT on `transaction_id` and read the transaction-level columns.
 *
 *   Verified against the model's own training source (`verification_public.dbt_stg_cmp_transactions`)
 *   over 2026-04-01..2026-05-04, joined on `transaction_id`:
 *     - `transaction_fuel_quantity` == the trained `fuel_quantity`  →  72,340 / 72,340 (100%)
 *     - SUM(`line_item_fuel_quantity`)                              →  48,844 / 72,340 (67%)
 *   so the transaction-level column is the faithful one and the line-item sum is not.
 *
 * TIMEZONE. The old source was `timestamptz`, so `EXTRACT(HOUR ...)` depended on the session
 * timezone — the training run happened to read it as Asia/Tashkent. The mart's `transaction_date`
 * is `timestamp WITHOUT time zone` holding that same local wall-clock: the same 72,340 rows agree
 * on the hour with `AT TIME ZONE 'Asia/Tashkent'` and agree on ZERO with UTC. So this query is
 * timezone-deterministic and needs no session setting — an improvement over the reference SQL.
 *
 * NIGHT/WEEKEND DOUBLE COUNT IS INTENTIONAL. A 02:00 Sunday transaction is counted by both terms,
 * so the ratio spans [0, 2]. The published bins top out at 0.816986 which only makes sense on that
 * scale. Reproduced exactly; do not "fix" it without retraining.
 */

/** Every feature the model reads, plus the identity columns the desk shows. */
export interface WatchFeatureRow {
  carrier_id: string;
  company_name: string | null;
  agent_name: string | null;
  credit_limit: string | null;
  pay_ratio_31d: string | null;
  payment_gap: string | null;
  longest_dormant_31d: number | null;
  recovery_speed: string | null;
  mob: number | null;
  avg_invoiced_14d: string | null;
  median_fuel_31d: string | null;
  night_weekend_ratio_31d: string | null;
}

/**
 * Build the feature query for one scoring date.
 *
 * `$1` is the scoring date (an ISO `YYYY-MM-DD`). Everything is computed strictly BEFORE it, so the
 * result is what was knowable on that morning — with the caveat that the overdue table is mutated
 * in place, which is why we snapshot forward rather than backfill.
 */
export const WATCH_FEATURE_SQL = `
WITH
-- One row per TRANSACTION. See the header: line-item grain would shift median and counts.
txn AS (
  SELECT DISTINCT
    m.transaction_id,
    m.carrier_id::bigint                AS carrier_id,
    m.transaction_date                  AS transaction_date,
    m.transaction_fuel_quantity         AS fuel_quantity
  FROM octane.mart_transaction_line_items m
  WHERE m.transaction_fuel_quantity  > 0
    AND m.transaction_price_per_unit BETWEEN 0.1 AND 10
    AND m.carrier_id IS NOT NULL
    AND m.transaction_date < $1::date
),
-- Overdue / invoice history. carried_id is text in the warehouse, hence the digit guard.
ov AS (
  SELECT
    o.carried_id::bigint            AS carrier_id,
    o.invoice_date::date            AS invoice_date,
    o.invoice_amount,
    o.payment_date::date            AS payment_date,
    o.payment_amount,
    o.exage3,
    (o.invoice_date::date + o.exage3) AS observation_date
  FROM verification_staging.postlimit_default_list o
  WHERE o.invoice_date IS NOT NULL
    AND o.exage3       IS NOT NULL
    AND o.carried_id ~ '^[0-9]+$'
),
-- Carriers active in the last 31 days.
recent AS (
  SELECT DISTINCT carrier_id FROM txn
  WHERE transaction_date >= $1::date - INTERVAL '31 days'
),
first_txn AS (
  SELECT carrier_id, MIN(transaction_date) AS first_txn_date FROM txn GROUP BY carrier_id
),
known AS (
  SELECT DISTINCT carried_id::bigint AS carrier_id
  FROM verification_staging.postlimit_default_list
  WHERE carried_id ~ '^[0-9]+$'
),
-- Prepay carriers cannot go overdue, so the model was never trained on them.
prepay AS (
  SELECT DISTINCT c.carrier_id::bigint AS carrier_id
  FROM verification_staging.dim_company c
  LEFT JOIN verification_staging.stg_cmp_company_tags ct ON ct.company_id = c.company_id
  LEFT JOIN verification_staging.stg_cmp_company_tag  t  ON t.tag_id      = ct.tag_id
  WHERE LOWER(t.tag_name) LIKE '%prepay%'
    AND c.carrier_id IS NOT NULL
),
-- Debtors are already a Collection problem; scoring them is not the question this model answers.
debtors AS (
  SELECT DISTINCT carried_id::bigint AS carrier_id
  FROM verification_staging.postlimit_default_list
  WHERE LOWER(COALESCE(tags, '')) LIKE '%debtors%'
    AND carried_id ~ '^[0-9]+$'
),
base AS (
  SELECT r.carrier_id, f.first_txn_date
  FROM recent r
  JOIN first_txn f USING (carrier_id)
  JOIN known     k USING (carrier_id)
  LEFT JOIN prepay  p USING (carrier_id)
  LEFT JOIN debtors d USING (carrier_id)
  WHERE p.carrier_id IS NULL AND d.carrier_id IS NULL
),
-- pay_ratio_31d. Computed on its OWN window rather than joined alongside the 14-day set: the
-- reference SQL joined both to base in one query, which multiplies the two invoice sets together.
pay_31 AS (
  SELECT carrier_id,
         SUM(invoice_amount) AS invoiced,
         SUM(CASE WHEN payment_date IS NOT NULL AND payment_date < $1::date
                  THEN COALESCE(payment_amount, 0) ELSE 0 END) AS paid
  FROM ov
  WHERE observation_date >= $1::date - INTERVAL '31 days'
    AND observation_date <  $1::date
  GROUP BY carrier_id
),
inv_14 AS (
  SELECT carrier_id, AVG(invoice_amount) AS avg_invoiced_14d
  FROM ov
  WHERE observation_date >= $1::date - INTERVAL '14 days'
    AND observation_date <  $1::date
  GROUP BY carrier_id
),
-- payment_gap / recovery_speed over all settled history before the cut.
hist AS (
  SELECT carrier_id,
         AVG((payment_date - invoice_date)::numeric) AS payment_gap,
         AVG(CASE WHEN exage3 > 0 THEN (payment_date - invoice_date)::numeric END) AS recovery_speed
  FROM ov
  WHERE observation_date < $1::date
    AND payment_date IS NOT NULL
    AND payment_date < $1::date
  GROUP BY carrier_id
),
-- median_fuel_31d / night_weekend_ratio_31d. The two terms below intentionally overlap.
txn_31 AS (
  SELECT carrier_id, fuel_quantity,
         EXTRACT(HOUR FROM transaction_date)::int AS h,
         EXTRACT(DOW  FROM transaction_date)::int AS dow
  FROM txn
  WHERE transaction_date >= $1::date - INTERVAL '31 days'
),
txn_feats AS (
  SELECT carrier_id,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY fuel_quantity) AS median_fuel_31d,
         ( SUM(CASE WHEN h < 6 OR h >= 22 THEN 1 ELSE 0 END)::numeric
         + SUM(CASE WHEN dow IN (0, 6)    THEN 1 ELSE 0 END)::numeric
         ) / NULLIF(COUNT(*), 0) AS night_weekend_ratio_31d
  FROM txn_31 GROUP BY carrier_id
),
-- longest_dormant_31d — longest run of consecutive days with no transaction.
active_days AS (
  SELECT DISTINCT carrier_id, transaction_date::date AS d
  FROM txn WHERE transaction_date >= $1::date - INTERVAL '31 days'
),
cal AS (
  SELECT generate_series($1::date - INTERVAL '31 days', $1::date - INTERVAL '1 day', INTERVAL '1 day')::date AS d
),
panel AS (
  SELECT b.carrier_id, c.d,
         CASE WHEN a.carrier_id IS NULL THEN 1 ELSE 0 END AS inactive
  FROM base b CROSS JOIN cal c
  LEFT JOIN active_days a ON a.carrier_id = b.carrier_id AND a.d = c.d
),
runs AS (
  SELECT carrier_id, inactive,
         SUM(CASE WHEN inactive = 0 THEN 1 ELSE 0 END)
           OVER (PARTITION BY carrier_id ORDER BY d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS grp
  FROM panel
),
dormant AS (
  SELECT carrier_id, MAX(len)::int AS longest_dormant_31d FROM (
    SELECT carrier_id, grp, COUNT(*) AS len FROM runs WHERE inactive = 1 GROUP BY carrier_id, grp
  ) x GROUP BY carrier_id
),
-- Identity comes from the COMPANY DIMENSION, one row per carrier.
--
-- It used to be MAX() over postlimit_default_list, an overdue export. Measured against
-- octane.dim_company over the 2,913 carriers in both: the agent disagreed for 2,272 and was
-- missing entirely for 476, and names differed for 771 — though 591 of those were casing only.
-- Worse, that CTE's WHERE also filtered on a parseable credit_limit, so a carrier whose overdue
-- rows carried no numeric limit lost its NAME and AGENT too. The dimension covers all 728 scored
-- carriers with a name and 726 with an agent, so nothing is lost by reading it directly.
company AS (
  SELECT carrier_id, company_name, agent AS agent_name, credit_limit
  FROM octane.dim_company
),
-- The dimension's credit_limit is populated for LOC carriers (all 2,429 of them) but is null or
-- zero elsewhere, while 460 carriers company-wide have an approved limit ONLY in the overdue list.
-- So the dimension wins where it has a figure and this is the fallback — for this column alone.
pl_limit AS (
  SELECT carried_id::bigint AS carrier_id,
         MAX(NULLIF(credit_limit, '')::numeric) AS credit_limit
  FROM verification_staging.postlimit_default_list
  WHERE carried_id   ~ '^[0-9]+$'
    AND credit_limit ~ '^[0-9]+(\\.[0-9]+)?$'
  GROUP BY carried_id::bigint
)
SELECT
  b.carrier_id::text                                         AS carrier_id,
  co.company_name,
  co.agent_name,
  COALESCE(NULLIF(co.credit_limit, 0), pl.credit_limit)::text AS credit_limit,
  CASE WHEN COALESCE(p31.invoiced, 0) = 0 THEN NULL
       ELSE (p31.paid / p31.invoiced) END::text              AS pay_ratio_31d,
  h.payment_gap::text                                        AS payment_gap,
  COALESCE(d.longest_dormant_31d, 0)                         AS longest_dormant_31d,
  h.recovery_speed::text                                     AS recovery_speed,
  ($1::date - b.first_txn_date::date)::int                   AS mob,
  i14.avg_invoiced_14d::text                                 AS avg_invoiced_14d,
  tf.median_fuel_31d::text                                   AS median_fuel_31d,
  tf.night_weekend_ratio_31d::text                           AS night_weekend_ratio_31d
FROM base b
LEFT JOIN pay_31    p31 USING (carrier_id)
LEFT JOIN inv_14    i14 USING (carrier_id)
LEFT JOIN hist      h   USING (carrier_id)
LEFT JOIN dormant   d   USING (carrier_id)
LEFT JOIN txn_feats tf  USING (carrier_id)
LEFT JOIN company   co  USING (carrier_id)
LEFT JOIN pl_limit  pl  USING (carrier_id)
`;

/** Same query, narrowed to one carrier — the on-demand "rescore now" path. */
export const WATCH_FEATURE_SQL_ONE = `${WATCH_FEATURE_SQL}\nWHERE b.carrier_id = $2::bigint`;
