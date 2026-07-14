/**
 * Live analytics — curated, parameterized SQL over the read-only DWH pool (dwh.ts enforces
 * default_transaction_read_only). The LLM never authors SQL here: every query is server-written
 * against the canonical warehouse tables (mart_transaction_line_items, intm_zoho_deals,
 * zoho_deals/zoho_users, stg_cmp_billing_history, cmp_invoice). Consumers (route + agent tool)
 * read snapshots via the cache — never call these compute functions per request.
 */
import { dwhQuery } from '../../integrations/dwh.js';
import type {
  AnalyticsBlock,
  AnalyticsDimension,
  BreakdownItem,
  BreakdownTone,
  KpiStat,
  LeaderboardRow,
  TrendPoint,
} from './types.js';

/* ------------------------------ formatting helpers ------------------------------ */

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}k`;
  return Math.round(n).toLocaleString('en-US');
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1_000).toFixed(0)}k`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

function pct(part: number, total: number): string {
  if (total <= 0) return '0%';
  return `${((part / total) * 100).toFixed(1)}%`;
}

const num = (v: unknown): number => (v == null ? 0 : Number(v));

/* ------------------------------ trend (shared shape) ------------------------------ */

interface DayRow {
  day_label: string;
  value: string | number | null;
}

/** Zero-filled last-14-days series; the trailing (today) point is marked partial. */
function toTrend(rows: DayRow[]): TrendPoint[] {
  return rows.map((r, i) => ({
    label: r.day_label,
    value: num(r.value),
    ...(i === rows.length - 1 ? { partial: true } : {}),
  }));
}

/* ------------------------------ pipeline ------------------------------ */

/** Funnel stage order — matches the org's canonical 11-stage deal funnel (intm_zoho_deals). */
const STAGE_ORDER_SQL = `case stage
  when 'Application Sent' then 1
  when 'Application Filled' then 2
  when 'CS Validation' then 3
  when 'Billing Form Sent' then 4
  when 'Billing Form Filled' then 5
  when 'EFS Processing' then 6
  when 'Vendor Validation' then 7
  when 'Cards Sent' then 8
  when 'Cards Activated' then 9
  when 'Card Funded' then 10
  when 'Card Swiped' then 11
  else 99
end`;

const STAGE_TONES: Record<string, BreakdownTone> = {
  'Application Sent': 'sky',
  'Application Filled': 'info',
  'CS Validation': 'purple',
  'Billing Form Sent': 'warn',
  'Billing Form Filled': 'amber',
  'EFS Processing': 'warn',
  'Vendor Validation': 'purple',
  'Cards Sent': 'teal',
  'Cards Activated': 'good',
  'Card Funded': 'good',
  'Card Swiped': 'good',
};

async function computePipeline(): Promise<AnalyticsBlock> {
  const [apps, stages, daily, agents] = await Promise.all([
    dwhQuery<{ this_month: unknown; prev_month: unknown }>(
      `select
         count(*) filter (where date_trunc('month', coalesce(application_date, created_time)) = date_trunc('month', current_date)) as this_month,
         count(*) filter (where date_trunc('month', coalesce(application_date, created_time)) = date_trunc('month', current_date - interval '1 month')) as prev_month
       from public.zoho_deals
       where coalesce(application_date, created_time) >= date_trunc('month', current_date - interval '1 month')`,
    ),
    dwhQuery<{ stage: string; stage_order: unknown; stage_count: unknown }>(
      `select stage, ${STAGE_ORDER_SQL} as stage_order, count(*) as stage_count
       from intm_zoho_deals
       where date_trunc('month', coalesce(application_date, created_time)) = date_trunc('month', current_date)
       group by stage
       order by 2`,
    ),
    dwhQuery<DayRow>(
      `select to_char(d.day, 'Mon DD') as day_label, coalesce(z.appfills, 0) as value
       from generate_series(current_date - interval '13 days', current_date, interval '1 day') as d(day)
       left join (
         select date(coalesce(application_date, created_time)) as day, count(*) as appfills
         from public.zoho_deals
         where coalesce(application_date, created_time) >= current_date - interval '13 days'
         group by 1
       ) z on z.day = d.day::date
       order by d.day`,
    ),
    dwhQuery<{ agent_name: string | null; total: unknown; this_week: unknown; today: unknown }>(
      `select zu.full_name as agent_name,
              count(*) as total,
              count(*) filter (where date_trunc('week', coalesce(zd.application_date, zd.created_time)) = date_trunc('week', current_date)) as this_week,
              count(*) filter (where date(coalesce(zd.application_date, zd.created_time)) = current_date) as today
       from public.zoho_deals zd
       left join (select distinct id, full_name from zoho_users) zu on zd.owner = zu.id
       where date_trunc('month', coalesce(zd.application_date, zd.created_time)) = date_trunc('month', current_date)
       group by zu.full_name
       order by total desc
       limit 5`,
    ),
  ]);

  const thisMonth = num(apps[0]?.this_month);
  const prevMonth = num(apps[0]?.prev_month);
  const totalDeals = stages.reduce((s, r) => s + num(r.stage_count), 0);
  // "Reached stage N" = deals currently AT or PAST it (a Card Swiped deal passed Cards Sent).
  const reached = (order: number): number =>
    stages.filter((r) => num(r.stage_order) >= order && num(r.stage_order) <= 11).reduce((s, r) => s + num(r.stage_count), 0);
  const inFlight = stages
    .filter((r) => num(r.stage_order) >= 2 && num(r.stage_order) <= 10)
    .reduce((s, r) => s + num(r.stage_count), 0);

  const kpis: KpiStat[] = [
    { label: 'App Fills', value: fmtCount(thisMonth), delta: { prev: prevMonth, current: thisMonth, higherIsBetter: true } },
    { label: 'Reached Cards Sent', value: pct(reached(8), totalDeals), hint: 'of this month’s deals' },
    { label: 'Card Swiped', value: pct(reached(11), totalDeals), hint: 'fully converted' },
    { label: 'In Flight', value: fmtCount(inFlight), hint: 'between filled & funded' },
  ];

  const breakdown: BreakdownItem[] = stages
    .filter((r) => num(r.stage_order) <= 11)
    .map((r) => ({ label: r.stage, value: num(r.stage_count), tone: STAGE_TONES[r.stage] ?? 'neutral' }));

  const leaderboard: LeaderboardRow[] = agents.map((a) => ({
    name: a.agent_name ?? 'Unassigned',
    col1: num(a.total),
    col2: num(a.this_week),
    col3: num(a.today),
  }));

  return {
    label: 'Pipeline',
    caption: 'Deal flow and funnel conversion (this month)',
    kpis,
    trendLabel: 'App fills / day',
    trend: toTrend(daily),
    breakdownLabel: 'Deals by stage (this month)',
    breakdown,
    leaderboardLabel: 'Top agents by app fills',
    leaderboardCols: ['Apps', 'Week', 'Today'],
    leaderboard,
  };
}

/* ------------------------------ transactions ------------------------------ */

const CHAIN_TONES: BreakdownTone[] = ['info', 'teal', 'purple', 'sky', 'amber', 'neutral'];

async function computeTransactions(): Promise<AnalyticsBlock> {
  const [months, daily, chains, agents] = await Promise.all([
    dwhQuery<{
      m: string;
      gallons: unknown;
      revenue: unknown;
      txns: unknown;
      carriers: unknown;
    }>(
      `select case when date_trunc('month', transaction_date) = date_trunc('month', current_date) then 'cur' else 'prev' end as m,
              sum(line_item_fuel_quantity) as gallons,
              sum(line_item_amount) as revenue,
              count(distinct transaction_id) as txns,
              count(distinct carrier_id) as carriers
       from octane.mart_transaction_line_items
       where transaction_date >= date_trunc('month', current_date - interval '1 month')
         and transaction_date::date <= current_date
       group by 1`,
    ),
    dwhQuery<DayRow>(
      `select to_char(d.day, 'Mon DD') as day_label, coalesce(t.gallons, 0) as value
       from generate_series(current_date - interval '13 days', current_date, interval '1 day') as d(day)
       left join (
         select transaction_date::date as day, sum(line_item_fuel_quantity) as gallons
         from octane.mart_transaction_line_items
         where transaction_date >= current_date - interval '13 days'
         group by 1
       ) t on t.day = d.day::date
       order by d.day`,
    ),
    dwhQuery<{ chain: string | null; gallons: unknown }>(
      `select coalesce(chain_name, chain_code, 'Other') as chain, sum(line_item_fuel_quantity) as gallons
       from octane.mart_transaction_line_items
       where date_trunc('month', transaction_date) = date_trunc('month', current_date)
       group by 1
       order by 2 desc
       limit 6`,
    ),
    dwhQuery<{ agent_name: string | null; gallons: unknown; txns: unknown; revenue: unknown }>(
      `select agent as agent_name,
              sum(line_item_fuel_quantity) as gallons,
              count(distinct transaction_id) as txns,
              sum(line_item_amount) as revenue
       from octane.mart_transaction_line_items
       where date_trunc('month', transaction_date) = date_trunc('month', current_date)
       group by agent
       order by 2 desc
       limit 5`,
    ),
  ]);

  const cur = months.find((r) => r.m === 'cur');
  const prev = months.find((r) => r.m === 'prev');
  const kpis: KpiStat[] = [
    {
      label: 'Gallons',
      value: fmtCount(num(cur?.gallons)),
      delta: { prev: num(prev?.gallons), current: num(cur?.gallons), higherIsBetter: true },
    },
    {
      label: 'Fuel Spend',
      value: fmtMoney(num(cur?.revenue)),
      delta: { prev: num(prev?.revenue), current: num(cur?.revenue), higherIsBetter: true },
    },
    {
      label: 'Transactions',
      value: fmtCount(num(cur?.txns)),
      delta: { prev: num(prev?.txns), current: num(cur?.txns), higherIsBetter: true },
    },
    {
      label: 'Active Carriers',
      value: fmtCount(num(cur?.carriers)),
      delta: { prev: num(prev?.carriers), current: num(cur?.carriers), higherIsBetter: true },
    },
  ];

  const breakdown: BreakdownItem[] = chains.map((c, i) => ({
    label: c.chain ?? 'Other',
    value: Math.round(num(c.gallons)),
    tone: CHAIN_TONES[i % CHAIN_TONES.length] ?? 'neutral',
  }));

  const leaderboard: LeaderboardRow[] = agents.map((a) => ({
    name: a.agent_name ?? 'Unassigned',
    col1: Math.round(num(a.gallons)),
    col2: num(a.txns),
    col3: fmtMoney(num(a.revenue)),
  }));

  return {
    label: 'Transactions',
    caption: 'Fueling volume and card spend (month to date)',
    kpis,
    trendLabel: 'Gallons / day',
    trend: toTrend(daily),
    breakdownLabel: 'Gallons by chain (this month)',
    breakdown,
    leaderboardLabel: 'Top agents by gallons',
    leaderboardCols: ['Gallons', 'Txns', 'Spend'],
    leaderboard,
  };
}

/* ------------------------------ billing ------------------------------ */

const COMPANY_TONES: BreakdownTone[] = ['good', 'teal', 'sky', 'purple', 'amber', 'neutral'];

/** Latest deal_name per carrier — the org's canonical name-resolution join. */
const DEAL_NAME_JOIN = `join (
  select distinct on (carrier_id) carrier_id, deal_name
  from zoho_deals
  where carrier_id is not null
  order by carrier_id, created_time desc
) zd on zd.carrier_id = bh.carrier_id`;

async function computeBilling(): Promise<AnalyticsBlock> {
  const [months, daily, topCompanies, balances, debtors] = await Promise.all([
    dwhQuery<{ m: string; topups: unknown; total: unknown; avg_amount: unknown }>(
      `select case when date_trunc('month', create_date) = date_trunc('month', current_date) then 'cur' else 'prev' end as m,
              count(*) as topups,
              sum(amount) as total,
              avg(amount) as avg_amount
       from octane.stg_cmp_billing_history
       where create_date >= date_trunc('month', current_date - interval '1 month')
       group by 1`,
    ),
    dwhQuery<DayRow>(
      `select to_char(d.day, 'Mon DD') as day_label, coalesce(b.total, 0) as value
       from generate_series(current_date - interval '13 days', current_date, interval '1 day') as d(day)
       left join (
         select date(create_date) as day, round(sum(amount)) as total
         from octane.stg_cmp_billing_history
         where create_date >= current_date - interval '13 days'
         group by 1
       ) b on b.day = d.day::date
       order by d.day`,
    ),
    dwhQuery<{ company: string | null; total: unknown }>(
      `select zd.deal_name as company, sum(bh.amount) as total
       from octane.stg_cmp_billing_history bh
       ${DEAL_NAME_JOIN}
       where date_trunc('month', bh.create_date) = date_trunc('month', current_date)
       group by zd.deal_name
       order by 2 desc
       limit 6`,
    ),
    dwhQuery<{ company: string | null; balance: unknown; topups: unknown }>(
      `select zd.deal_name as company, latest.balance_after as balance, latest.month_topups as topups
       from (
         select distinct on (carrier_id) carrier_id, balance_after,
                count(*) filter (where date_trunc('month', create_date) = date_trunc('month', current_date))
                  over (partition by carrier_id) as month_topups
         from octane.stg_cmp_billing_history
         order by carrier_id, create_date desc
       ) latest
       join (
         select distinct on (carrier_id) carrier_id, deal_name
         from zoho_deals
         where carrier_id is not null
         order by carrier_id, created_time desc
       ) zd on zd.carrier_id = latest.carrier_id
       order by latest.balance_after desc
       limit 5`,
    ),
    dwhQuery<{ open_invoices: unknown }>(
      `select count(*) as open_invoices from cmp_invoice where status in ('pending', 'partially_paid')`,
    ),
  ]);

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
    { label: 'Avg Top-up', value: fmtMoney(num(cur?.avg_amount)), hint: 'this month' },
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
    caption: 'Client top-ups, balances and receivables (month to date)',
    kpis,
    trendLabel: 'Top-up $ / day',
    trend: toTrend(daily),
    breakdownLabel: 'Top-ups by company (this month)',
    breakdown,
    leaderboardLabel: 'Largest current balances',
    leaderboardCols: ['Balance', 'Top-ups (m)', 'Amount'],
    leaderboard,
  };
}

/* ------------------------------ dispatch ------------------------------ */

export async function computeAnalyticsBlock(dimension: AnalyticsDimension): Promise<AnalyticsBlock> {
  switch (dimension) {
    case 'pipeline':
      return computePipeline();
    case 'transactions':
      return computeTransactions();
    case 'billing':
      return computeBilling();
  }
}
