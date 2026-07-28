/**
 * Billing dimension — client top-ups, wallet balances and open debtor invoices.
 *
 * Distinct from `receivables`: this is the money clients PUT IN (billing history top-ups and the
 * resulting balances). Receivables is what they still OWE us against issued invoices.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import {
  dateScope,
  normalizeFilters,
  ownedCarrierCte,
  ownedCarrierCteBilling,
  SqlParams,
  type AnalyticsFilters,
} from '../filters.js';
import { captionFor, fmtCount, fmtMoney, num, toTrend, withCte, type DayRow } from '../shared.js';
import type { AnalyticsBlock, BreakdownItem, BreakdownTone, KpiStat, LeaderboardRow } from '../types.js';

const COMPANY_TONES: BreakdownTone[] = ['good', 'teal', 'sky', 'purple', 'amber', 'neutral'];

const DEAL_NAME_JOIN = `join (
  select distinct on (carrier_id) carrier_id, deal_name
  from zoho_deals
  where carrier_id is not null
  order by carrier_id, created_time desc
) zd on zd.carrier_id = bh.carrier_id`;

export async function computeBilling(filters: AnalyticsFilters): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);
  const BH_DATE = 'create_date';

  const monthsP = new SqlParams();
  const monthsScope = dateScope(`bh.${BH_DATE}`, f, monthsP);
  const monthsOwned = ownedCarrierCteBilling(f, monthsP);
  const monthsSql = withCte(
    monthsOwned.cte,
    `select case when ${monthsScope.current} then 'cur' else 'prev' end as m,
            count(*) as topups,
            sum(amount) as total,
            avg(amount) as avg_amount
     from octane.stg_cmp_billing_history bh
     ${monthsOwned.joinOn}
     where ((${monthsScope.current}) or (${monthsScope.previous}))
     group by 1`,
  );

  const dailyP = new SqlParams();
  const dailyScope = dateScope(`bh.${BH_DATE}`, f, dailyP);
  const dailyOwned = ownedCarrierCteBilling(f, dailyP);
  const dailyInner = withCte(
    dailyOwned.cte,
    `select date(create_date) as day, round(sum(amount)) as total
     from octane.stg_cmp_billing_history bh
     ${dailyOwned.joinOn}
     where create_date::date >= (${dailyScope.trendStart})::date
       and create_date::date <= (${dailyScope.trendEnd})::date
     group by 1`,
  );
  const dailySql = `select to_char(d.day, 'Mon DD') as day_label, coalesce(b.total, 0) as value
     from generate_series(${dailyScope.trendStart}, ${dailyScope.trendEnd}, interval '1 day') as d(day)
     left join (${dailyInner}) b on b.day = d.day::date
     order by d.day`;

  const topP = new SqlParams();
  const topScope = dateScope(`bh.${BH_DATE}`, f, topP);
  const topOwned = ownedCarrierCteBilling(f, topP);
  const topSql = withCte(
    topOwned.cte,
    `select zd.deal_name as company, sum(bh.amount) as total
     from octane.stg_cmp_billing_history bh
     ${DEAL_NAME_JOIN}
     ${topOwned.joinOn}
     where ${topScope.current}
     group by zd.deal_name
     order by 2 desc
     limit 6`,
  );

  const balP = new SqlParams();
  const balOwned = ownedCarrierCteBilling(f, balP);
  // Balance leaderboard is point-in-time; still restrict carriers when agent-scoped.
  const balSql = withCte(
    balOwned.cte,
    `select zd.deal_name as company, latest.balance_after as balance, latest.month_topups as topups
     from (
       select distinct on (bh.carrier_id) bh.carrier_id, bh.balance_after,
              count(*) filter (where date_trunc('month', bh.create_date) = date_trunc('month', current_date))
                over (partition by bh.carrier_id) as month_topups
       from octane.stg_cmp_billing_history bh
       ${balOwned.joinOn}
       order by bh.carrier_id, bh.create_date desc
     ) latest
     join (
       select distinct on (carrier_id) carrier_id, deal_name
       from zoho_deals
       where carrier_id is not null
       order by carrier_id, created_time desc
     ) zd on zd.carrier_id = latest.carrier_id
     order by latest.balance_after desc
     limit 5`,
  );

  const debtP = new SqlParams();
  const debtOwned = ownedCarrierCte(f, debtP, 'carrier_id');
  // cmp_invoice.status is stored UPPERCASE ('PENDING' / 'PARTIALLY_PAID'). This predicate used to
  // compare against lowercase literals, so the KPI silently read 0 open invoices forever.
  const debtSql = debtOwned.cte
    ? withCte(
        debtOwned.cte,
        `select count(*) as open_invoices
         from cmp_invoice i
         join owned o on o.carrier_id::text = i.carrier_id::text
         where i.status in ('PENDING', 'PARTIALLY_PAID')`,
      )
    : `select count(*) as open_invoices from cmp_invoice where status in ('PENDING', 'PARTIALLY_PAID')`;

  const [months, daily] = await Promise.all([
    dwhQuery<{ m: string; topups: unknown; total: unknown; avg_amount: unknown }>(monthsSql, monthsP.values),
    dwhQuery<DayRow>(dailySql, dailyP.values),
  ]);
  const [topCompanies, balances] = await Promise.all([
    dwhQuery<{ company: string | null; total: unknown }>(topSql, topP.values),
    dwhQuery<{ company: string | null; balance: unknown; topups: unknown }>(balSql, balP.values),
  ]);
  const debtors = await dwhQuery<{ open_invoices: unknown }>(debtSql, debtP.values);

  const cur = months.find((r) => r.m === 'cur');
  const prev = months.find((r) => r.m === 'prev');
  const kpis: KpiStat[] = [
    {
      label: 'Top-ups',
      value: fmtCount(num(cur?.topups)),
      delta: { prev: num(prev?.topups), current: num(cur?.topups), higherIsBetter: true },
    },
    {
      label: 'Top-up Volume',
      value: fmtMoney(num(cur?.total)),
      delta: { prev: num(prev?.total), current: num(cur?.total), higherIsBetter: true },
    },
    { label: 'Avg Top-up', value: fmtMoney(num(cur?.avg_amount)), hint: 'in filter window' },
    { label: 'Open Debtor Invoices', value: fmtCount(num(debtors[0]?.open_invoices)), hint: 'pending / partially paid' },
  ];

  const breakdown: BreakdownItem[] = topCompanies.map((c, i) => ({
    label: c.company ?? 'Unknown',
    value: Math.round(num(c.total)),
    tone: COMPANY_TONES[i % COMPANY_TONES.length] ?? 'neutral',
  }));

  const leaderboard: LeaderboardRow[] = balances.map((b) => ({
    name: b.company ?? 'Unknown',
    col1: Math.round(num(b.balance)),
    col2: num(b.topups),
    col3: fmtMoney(num(b.balance)),
  }));

  return {
    label: 'Billing',
    caption: captionFor('Client top-ups, balances and receivables', f),
    kpis,
    trendLabel: 'Top-up $ / day',
    trend: toTrend(daily),
    breakdownLabel: 'Top-ups by company',
    breakdown,
    leaderboardLabel: 'Largest current balances',
    leaderboardCols: ['Balance', 'Top-ups (m)', 'Amount'],
    leaderboard,
  };
}
