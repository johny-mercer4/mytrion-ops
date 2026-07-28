/**
 * Sales dimension — the card/volume scorecard (backs the Sales dashboard).
 *
 * Mirrors the core metric set the "Sales_new" Power BI report repeats on every page:
 * Active Companies, Unique Cards, New Cards, Volume (gallons) and Revenue, each against the prior
 * equivalent window for the MoM-style delta.
 *
 * Sales used to render the `pipeline` dimension — the Zoho deal funnel (App Fills, stages). That is
 * the report's *CRM* page, not its Sales scorecard, so the funnel now lives under its own CRM
 * category and Sales shows the actual card/volume performance.
 *
 * Source: `octane.mart_sales_dashboard_card_base` — the mart the Power BI report itself is built
 * on, one row per transaction line item with carrier / agent / card / volume / amount already
 * denormalized. Two properties matter here:
 *   - `first_transaction_date` is the CARD's first swipe and is single-valued per `card_number`
 *     (verified: zero cards carry more than one value), so "New Cards" = cards whose first swipe
 *     falls inside the window, and it is also the cohort key if cohort views get built later.
 *   - It is 1.27M rows and an UNFILTERED scan takes ~3.5s. Every query here must stay date-bounded;
 *     date-filtered aggregates run 170–430ms.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import {
  dateScope,
  normalizeFilters,
  ownedCarrierCteFor,
  SqlParams,
  type AnalyticsFilters,
} from '../filters.js';
import {
  captionFor,
  fmtCount,
  fmtMoney,
  num,
  softQuery,
  toTrend,
  withCte,
  type DayRow,
} from '../shared.js';
import type { AnalyticsBlock, BreakdownItem, BreakdownTone, KpiStat, LeaderboardRow } from '../types.js';

const MART = 'octane.mart_sales_dashboard_card_base';
const TX_DAY = 'm.transaction_day';
/** The card's first-ever swipe — drives "New Cards" (single-valued per card_number). */
const FIRST_TX = 'm.first_transaction_date';

const COMPANY_TONES: BreakdownTone[] = ['sky', 'info', 'teal', 'purple', 'amber', 'neutral'];

interface ScorecardRow {
  cur_companies: unknown;
  prev_companies: unknown;
  cur_cards: unknown;
  prev_cards: unknown;
  cur_new_cards: unknown;
  prev_new_cards: unknown;
  cur_volume: unknown;
  prev_volume: unknown;
  cur_revenue: unknown;
  prev_revenue: unknown;
}

interface AgentRow {
  agent_name: string | null;
  volume: unknown;
  cards: unknown;
  revenue: unknown;
}

export async function computeSales(filters: AnalyticsFilters): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);

  const kpiP = new SqlParams();
  const kpiScope = dateScope(TX_DAY, f, kpiP);
  // A card is "new" when its first-ever swipe lands in the window — scoped on first_transaction_date,
  // not transaction_day, so a card that first swiped last month is not counted again this month.
  const newScope = dateScope(FIRST_TX, f, kpiP);
  const kpiOwned = ownedCarrierCteFor('m', f, kpiP);
  const kpiSql = withCte(
    kpiOwned.cte,
    `select
       count(distinct m.carrier_id)  filter (where ${kpiScope.current})  as cur_companies,
       count(distinct m.carrier_id)  filter (where ${kpiScope.previous}) as prev_companies,
       count(distinct m.card_number) filter (where ${kpiScope.current})  as cur_cards,
       count(distinct m.card_number) filter (where ${kpiScope.previous}) as prev_cards,
       count(distinct m.card_number) filter (where ${kpiScope.current}  and ${newScope.current})  as cur_new_cards,
       count(distinct m.card_number) filter (where ${kpiScope.previous} and ${newScope.previous}) as prev_new_cards,
       sum(m.fuel_quantity)          filter (where ${kpiScope.current})  as cur_volume,
       sum(m.fuel_quantity)          filter (where ${kpiScope.previous}) as prev_volume,
       sum(m.line_item_amount)       filter (where ${kpiScope.current})  as cur_revenue,
       sum(m.line_item_amount)       filter (where ${kpiScope.previous}) as prev_revenue
     from ${MART} m
     ${kpiOwned.joinOn}
     where ((${kpiScope.current}) or (${kpiScope.previous}))`,
  );

  const dailyP = new SqlParams();
  const dailyScope = dateScope(TX_DAY, f, dailyP);
  const dailyOwned = ownedCarrierCteFor('m', f, dailyP);
  const dailyInner = withCte(
    dailyOwned.cte,
    `select ${TX_DAY} as day, round(sum(m.fuel_quantity)) as volume
     from ${MART} m
     ${dailyOwned.joinOn}
     where ${TX_DAY} >= (${dailyScope.trendStart})::date
       and ${TX_DAY} <= (${dailyScope.trendEnd})::date
     group by 1`,
  );
  // generate_series sits outside the owned CTE — wrap the aggregate as a subquery.
  const dailySql = `select to_char(d.day, 'Mon DD') as day_label, coalesce(v.volume, 0) as value
     from generate_series(${dailyScope.trendStart}, ${dailyScope.trendEnd}, interval '1 day') as d(day)
     left join (${dailyInner}) v on v.day = d.day::date
     order by d.day`;

  const compP = new SqlParams();
  const compScope = dateScope(TX_DAY, f, compP);
  const compOwned = ownedCarrierCteFor('m', f, compP);
  const compSql = withCte(
    compOwned.cte,
    `select coalesce(nullif(trim(m.company_name), ''), '(unnamed)') as company,
            sum(m.fuel_quantity) as volume
     from ${MART} m
     ${compOwned.joinOn}
     where ${compScope.current}
     group by 1
     order by 2 desc
     limit 6`,
  );

  const agentP = new SqlParams();
  const agentScope = dateScope(TX_DAY, f, agentP);
  const agentOwned = ownedCarrierCteFor('m', f, agentP);
  // dim_company is the ownership authority when scoped; the mart's own agent for company-wide.
  const agentExpr = agentOwned.cte ? 'o.agent' : 'm.agent';
  const agentSql = withCte(
    agentOwned.cte,
    `select ${agentExpr} as agent_name,
            sum(m.fuel_quantity) as volume,
            count(distinct m.card_number) as cards,
            sum(m.line_item_amount) as revenue
     from ${MART} m
     ${agentOwned.joinOn}
     where ${agentScope.current}
     group by 1
     order by 2 desc
     limit 5`,
  );

  // Parallelism capped at 2 per round — the shared DWH pool is tiny (max ~5).
  const [scorecard, daily] = await Promise.all([
    softQuery<ScorecardRow>('sales.scorecard', () =>
      dwhQuery<ScorecardRow>(kpiSql, kpiP.values),
    ),
    softQuery<DayRow>('sales.daily', () => dwhQuery<DayRow>(dailySql, dailyP.values)),
  ]);
  const [companies, agents] = await Promise.all([
    softQuery<{ company: string | null; volume: unknown }>('sales.companies', () =>
      dwhQuery<{ company: string | null; volume: unknown }>(compSql, compP.values),
    ),
    softQuery<AgentRow>('sales.agents', () => dwhQuery<AgentRow>(agentSql, agentP.values)),
  ]);

  const s = scorecard[0];
  const kpis: KpiStat[] = [
    {
      label: 'Active Companies',
      value: fmtCount(num(s?.cur_companies)),
      delta: {
        prev: num(s?.prev_companies),
        current: num(s?.cur_companies),
        higherIsBetter: true,
      },
    },
    {
      label: 'Unique Cards',
      value: fmtCount(num(s?.cur_cards)),
      delta: { prev: num(s?.prev_cards), current: num(s?.cur_cards), higherIsBetter: true },
    },
    {
      label: 'New Cards',
      value: fmtCount(num(s?.cur_new_cards)),
      delta: {
        prev: num(s?.prev_new_cards),
        current: num(s?.cur_new_cards),
        higherIsBetter: true,
      },
      hint: 'first swipe in window',
    },
    {
      label: 'Volume',
      value: `${fmtCount(num(s?.cur_volume))} gal`,
      delta: { prev: num(s?.prev_volume), current: num(s?.cur_volume), higherIsBetter: true },
    },
    {
      label: 'Revenue',
      value: fmtMoney(num(s?.cur_revenue)),
      delta: { prev: num(s?.prev_revenue), current: num(s?.cur_revenue), higherIsBetter: true },
    },
  ];

  const breakdown: BreakdownItem[] = companies.map((c, i) => ({
    label: c.company ?? '(unnamed)',
    value: Math.round(num(c.volume)),
    tone: COMPANY_TONES[i % COMPANY_TONES.length] ?? 'neutral',
  }));

  const leaderboard: LeaderboardRow[] = agents.map((a) => ({
    name: a.agent_name ?? 'Unassigned',
    col1: Math.round(num(a.volume)),
    col2: num(a.cards),
    col3: fmtMoney(num(a.revenue)),
  }));

  return {
    label: 'Sales',
    caption: captionFor('Cards, volume and revenue performance', f),
    kpis,
    trendLabel: 'Volume (gal) / day',
    trend: toTrend(daily),
    breakdownLabel: 'Volume by company',
    breakdown,
    leaderboardLabel: f.agentId || f.agentName ? 'Agent volume' : 'Top agents by volume',
    leaderboardCols: ['Volume', 'Cards', 'Revenue'],
    leaderboard,
  };
}
