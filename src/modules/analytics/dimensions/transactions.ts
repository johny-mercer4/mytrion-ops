/**
 * Transactions dimension — fueling volume and card spend from the transaction line-item mart.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import {
  dateScope,
  normalizeFilters,
  ownedCarrierCte,
  SqlParams,
  type AnalyticsFilters,
} from '../filters.js';
import { captionFor, fmtCount, fmtMoney, num, toTrend, withCte, type DayRow } from '../shared.js';
import type { AnalyticsBlock, BreakdownItem, BreakdownTone, KpiStat, LeaderboardRow } from '../types.js';

const CHAIN_TONES: BreakdownTone[] = ['info', 'teal', 'purple', 'sky', 'amber', 'neutral'];
const TX_DATE = 'transaction_date';

export async function computeTransactions(filters: AnalyticsFilters): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);

  const monthsP = new SqlParams();
  const monthsScope = dateScope(TX_DATE, f, monthsP);
  const monthsOwned = ownedCarrierCte(f, monthsP);
  const monthsSql = withCte(
    monthsOwned.cte,
    `select case when ${monthsScope.current} then 'cur' else 'prev' end as m,
            sum(line_item_fuel_quantity) as gallons,
            sum(line_item_amount) as revenue,
            count(distinct transaction_id) as txns,
            count(distinct t.carrier_id) as carriers
     from octane.mart_transaction_line_items t
     ${monthsOwned.joinOn}
     where ((${monthsScope.current}) or (${monthsScope.previous}))
     group by 1`,
  );

  const dailyP = new SqlParams();
  const dailyScope = dateScope(TX_DATE, f, dailyP);
  const dailyOwned = ownedCarrierCte(f, dailyP);
  const dailyInner = withCte(
    dailyOwned.cte,
    `select transaction_date::date as day, sum(line_item_fuel_quantity) as gallons
     from octane.mart_transaction_line_items t
     ${dailyOwned.joinOn}
     where transaction_date::date >= (${dailyScope.trendStart})::date
       and transaction_date::date <= (${dailyScope.trendEnd})::date
     group by 1`,
  );
  // generate_series is outside the owned CTE — wrap as subquery
  const dailySql = `select to_char(d.day, 'Mon DD') as day_label, coalesce(t.gallons, 0) as value
     from generate_series(${dailyScope.trendStart}, ${dailyScope.trendEnd}, interval '1 day') as d(day)
     left join (${dailyInner}) t on t.day = d.day::date
     order by d.day`;

  const chainsP = new SqlParams();
  const chainsScope = dateScope(TX_DATE, f, chainsP);
  const chainsOwned = ownedCarrierCte(f, chainsP);
  const chainsSql = withCte(
    chainsOwned.cte,
    `select coalesce(chain_name, chain_code, 'Other') as chain, sum(line_item_fuel_quantity) as gallons
     from octane.mart_transaction_line_items t
     ${chainsOwned.joinOn}
     where ${chainsScope.current}
     group by 1
     order by 2 desc
     limit 6`,
  );

  const agentsP = new SqlParams();
  const agentsScope = dateScope(TX_DATE, f, agentsP);
  const agentsOwned = ownedCarrierCte(f, agentsP);
  // Prefer dim_company.agent when scoped; fall back to mart.agent for company-wide.
  const agentExpr = agentsOwned.cte ? 'o.agent' : 't.agent';
  const agentsSql = withCte(
    agentsOwned.cte,
    `select ${agentExpr} as agent_name,
            sum(line_item_fuel_quantity) as gallons,
            count(distinct transaction_id) as txns,
            sum(line_item_amount) as revenue
     from octane.mart_transaction_line_items t
     ${agentsOwned.joinOn}
     where ${agentsScope.current}
     group by 1
     order by 2 desc
     limit 5`,
  );

  const [months, daily] = await Promise.all([
    dwhQuery<{
      m: string;
      gallons: unknown;
      revenue: unknown;
      txns: unknown;
      carriers: unknown;
    }>(monthsSql, monthsP.values),
    dwhQuery<DayRow>(dailySql, dailyP.values),
  ]);
  const [chains, agents] = await Promise.all([
    dwhQuery<{ chain: string | null; gallons: unknown }>(chainsSql, chainsP.values),
    dwhQuery<{ agent_name: string | null; gallons: unknown; txns: unknown; revenue: unknown }>(
      agentsSql,
      agentsP.values,
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
    caption: captionFor('Fueling volume and card spend', f),
    kpis,
    trendLabel: 'Gallons / day',
    trend: toTrend(daily),
    breakdownLabel: 'Gallons by chain',
    breakdown,
    leaderboardLabel: f.agentId || f.agentName ? 'Agent gallons' : 'Top agents by gallons',
    leaderboardCols: ['Gallons', 'Txns', 'Spend'],
    leaderboard,
  };
}
