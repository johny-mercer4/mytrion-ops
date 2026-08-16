/**
 * Run the ORIGINAL scoring_all_in_one.sql, verbatim except for schema names, and diff it against
 * what Mytrion Watch stored for the same Monday. Read-only; nothing is written anywhere.
 *
 *   public.dbt_stg_cmp_transactions -> verification_public.dbt_stg_cmp_transactions
 *   staging.*                       -> verification_staging.*
 * Session timezone is pinned to Asia/Tashkent because the training source is timestamptz and the
 * original relies on the reader's session TZ (its own header flags this).
 */
import 'dotenv/config';
import { Client } from 'pg';

const D = process.argv[2] ?? '2026-08-10';
const c = new Client({ connectionString: process.env.DWH_DATABASE_URL, ssl: false });
await c.connect();
await c.query(`set time zone 'Asia/Tashkent'`);

const SQL = `
with tmp_txn as (
  select transaction_date::timestamptz as transaction_date, carrier_id::bigint as carrier_id,
         fuel_quantity, price_per_unit
  from verification_public.dbt_stg_cmp_transactions
  where fuel_quantity > 0 and price_per_unit between 0.1 and 10
    and transaction_date::timestamptz < '${D}'::date
),
tmp_ov as (
  select carried_id::bigint as carrier_id, invoice_date::date as invoice_date, invoice_amount,
         payment_date::date as payment_date, payment_amount, exage3,
         (invoice_date::date + exage3) as observation_date
  from verification_staging.postlimit_default_list
  where invoice_date is not null and exage3 is not null
    and carried_id ~ '^\\d+$' and carried_id != ''
),
recent_txn as (select distinct carrier_id from tmp_txn
  where transaction_date >= '${D}'::date - interval '31 days' and transaction_date < '${D}'::date),
all_first_txn as (select carrier_id, min(transaction_date) first_txn_date from tmp_txn group by 1),
exp_carriers as (select distinct carried_id::bigint carrier_id from verification_staging.postlimit_default_list
  where carried_id ~ '^\\d+$' and carried_id != ''),
prepay_carriers as (select distinct scc.carrier_id::bigint carrier_id
  from verification_staging.dim_company scc
  left join verification_staging.stg_cmp_company_tags scct2 on scct2.company_id = scc.company_id
  left join verification_staging.stg_cmp_company_tag scct on scct.tag_id = scct2.tag_id
  where lower(scct.tag_name) like '%prepay%'),
debtor_carriers as (select distinct carried_id::bigint carrier_id
  from verification_staging.postlimit_default_list
  where lower(tags) like '%debtors%' and carried_id ~ '^\\d+$'),
tmp_base as (
  select r.carrier_id, f.first_txn_date
  from recent_txn r
  join all_first_txn f using (carrier_id)
  join exp_carriers e using (carrier_id)
  left join prepay_carriers p using (carrier_id)
  left join debtor_carriers d using (carrier_id)
  where p.carrier_id is null and d.carrier_id is null
),
ov_31 as (
  select o.carrier_id, o.invoice_amount,
    case when o.payment_date is null or o.payment_date < '${D}'::date
         then coalesce(o.payment_amount,0) else 0 end as paid
  from tmp_ov o
  where o.observation_date >= '${D}'::date - interval '31 days' and o.observation_date < '${D}'::date),
ov_14 as (select o.carrier_id, o.invoice_amount from tmp_ov o
  where o.observation_date >= '${D}'::date - interval '14 days' and o.observation_date < '${D}'::date),
tmp_ov_feats as (
  select b.carrier_id,
    case when coalesce(sum(o31.invoice_amount),0)=0 then null
         else sum(o31.paid)/sum(o31.invoice_amount) end as pay_ratio_31d,
    avg(o14.invoice_amount) as avg_invoiced_14d
  from tmp_base b left join ov_31 o31 using (carrier_id) left join ov_14 o14 using (carrier_id)
  group by b.carrier_id),
paid_h as (select o.carrier_id, (o.payment_date::date - o.invoice_date::date)::numeric gap_days, o.exage3
  from tmp_ov o where o.observation_date < '${D}'::date
    and o.payment_date is not null and o.payment_date < '${D}'::date),
tmp_hist_feats as (select b.carrier_id, avg(p.gap_days) payment_gap,
    avg(case when p.exage3 > 0 then p.gap_days end) recovery_speed
  from tmp_base b left join paid_h p using (carrier_id) group by b.carrier_id),
txn_31 as (select carrier_id, fuel_quantity,
    extract(hour from transaction_date)::int h, extract(dow from transaction_date)::int dow
  from tmp_txn where transaction_date >= '${D}'::date - interval '31 days' and transaction_date < '${D}'::date),
tmp_txn_feats as (select carrier_id,
    percentile_cont(0.5) within group (order by fuel_quantity) median_fuel_31d,
    (sum(case when h < 6 or h >= 22 then 1 else 0 end)::numeric
     + sum(case when dow in (0,6) then 1 else 0 end)::numeric)/nullif(count(*),0) night_weekend_ratio_31d
  from txn_31 group by carrier_id),
calendar as (select generate_series('${D}'::date - interval '31 days', '${D}'::date - interval '1 day', interval '1 day')::date d),
active as (select distinct carrier_id, transaction_date::date d from tmp_txn
  where transaction_date >= '${D}'::date - interval '31 days' and transaction_date < '${D}'::date),
panel as (select b.carrier_id, c.d, case when a.carrier_id is null then 1 else 0 end is_inactive
  from tmp_base b cross join calendar c left join active a on a.carrier_id=b.carrier_id and a.d=c.d),
runs as (select carrier_id, is_inactive,
    sum(case when is_inactive=0 then 1 else 0 end) over (partition by carrier_id order by d
      rows between unbounded preceding and current row) run_grp from panel),
run_lengths as (select carrier_id, run_grp, count(*) run_len from runs where is_inactive=1 group by 1,2),
tmp_dormant as (select b.carrier_id, coalesce(max(rl.run_len),0)::int longest_dormant_31d
  from tmp_base b left join run_lengths rl using (carrier_id) group by b.carrier_id)
select f.carrier_id::text carrier_id,
  ovf.pay_ratio_31d::float8 pay_ratio_31d, h.payment_gap::float8 payment_gap,
  d.longest_dormant_31d, h.recovery_speed::float8 recovery_speed,
  ('${D}'::date - f.first_txn_date::date)::int mob,
  ovf.avg_invoiced_14d::float8 avg_invoiced_14d, t.median_fuel_31d::float8 median_fuel_31d,
  t.night_weekend_ratio_31d::float8 night_weekend_ratio_31d
from tmp_base f
left join tmp_ov_feats ovf using (carrier_id)
left join tmp_hist_feats h using (carrier_id)
left join tmp_dormant d using (carrier_id)
left join tmp_txn_feats t using (carrier_id)`;

const rows = (await c.query(SQL)).rows;
await c.end();
console.log(`training SQL -> ${rows.length} carriers for ${D}`);

// score them with OUR stored model
const app = new Client({ connectionString: process.env.MYTRION_OPS_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await app.connect();
const bins = (await app.query(`select feature, bin_id, lower_b::float8 lo, upper_b::float8 hi, is_nan,
  woe::float8 woe, coef::float8 coef from mytrion_watch_model_bins where model_version='forward_all_clean_v1'`)).rows;
const m = (await app.query(`select intercept::float8 i, base_score::float8 bs, base_odds::float8 bo,
  pdo::float8 pdo from mytrion_watch_models where model_version='forward_all_clean_v1'`)).rows[0];
const stored = new Map((await app.query(
  `select carrier_id, credit_score::float8 s, features from mytrion_watch_scores where scoring_date=$1`, [D]
)).rows.map(r => [r.carrier_id, r]));
await app.end();

const FEATS = ['pay_ratio_31d','payment_gap','longest_dormant_31d','recovery_speed','mob',
               'avg_invoiced_14d','median_fuel_31d','night_weekend_ratio_31d'];
const byFeat = new Map();
for (const b of bins) { if (!byFeat.has(b.feature)) byFeat.set(b.feature, []); byFeat.get(b.feature).push(b); }
for (const [, v] of byFeat) v.sort((a,b) => a.bin_id - b.bin_id);

const pick = (f, v) => {
  const bs = byFeat.get(f) ?? [];
  if (v === null || v === undefined || !Number.isFinite(v)) return bs.find(b => b.is_nan) ?? null;
  for (const b of bs.filter(b => !b.is_nan))
    if ((b.lo === null || v > b.lo) && (b.hi === null || v <= b.hi)) return b;
  return null;
};
const factor = m.pdo / Math.log(2);
const scoreOf = (row) => {
  let sum = 0;
  for (const f of FEATS) { const b = pick(f, row[f]); if (b) sum += b.woe * b.coef; }
  const logit = sum + m.i;
  return (m.bs - factor * Math.log(m.bo)) - factor * logit;
};

let matched = 0, missing = 0, diffs = [];
for (const r of rows) {
  const s = stored.get(r.carrier_id);
  if (!s) { missing++; continue; }
  const mine = scoreOf(r);
  const d = mine - s.s;
  if (Math.abs(d) < 0.05) matched++; else diffs.push({ carrier: r.carrier_id, training: +mine.toFixed(1), ours: s.s, delta: +d.toFixed(1), row: r, stored: s.features });
}
console.log(`stored rows for ${D}: ${stored.size}`);
console.log(`training carriers not in our snapshot: ${missing}`);
console.log(`our carriers not in training set: ${[...stored.keys()].filter(k => !rows.find(r=>r.carrier_id===k)).length}`);
console.log(`SCORE MATCHES (within 0.05): ${matched} / ${rows.length - missing}`);
console.log(`SCORE DIFFERENCES: ${diffs.length}`);
diffs.sort((a,b) => Math.abs(b.delta) - Math.abs(a.delta));
for (const d of diffs.slice(0, 12)) {
  const changed = FEATS.filter(f => {
    const a = d.row[f], b = d.stored[f] === null ? null : Number(d.stored[f]);
    if (a === null && b === null) return false;
    if (a === null || b === null) return true;
    return Math.abs(a - b) > 1e-6;
  });
  console.log(`  ${d.carrier}  training ${d.training}  ours ${d.ours}  delta ${d.delta}   feature(s): ${changed.map(f=>`${f} ${d.row[f]} vs ${d.stored[f]}`).join(' | ') || '(none - model/rounding)'}`);
}
