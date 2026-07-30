/**
 * Pipeline dimension — Zoho deal flow and funnel conversion (backs the Sales dashboard).
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import {
  dateScope,
  normalizeFilters,
  pipelineOwnerPred,
  SqlParams,
  type AnalyticsFilters,
} from '../filters.js';
import {
  captionFor,
  fmtCount,
  num,
  pct,
  softQuery,
  toTrend,
  type DayRow,
} from '../shared.js';
import type { AnalyticsBlock, BreakdownItem, BreakdownTone, KpiStat, LeaderboardRow } from '../types.js';

const STAGE_ORDER_SQL = `case zd.stage
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

const DEAL_TS = 'coalesce(application_date, created_time)';
const DEAL_TS_ZD = 'coalesce(zd.application_date, zd.created_time)';
const USERS_JOIN = `left join (select distinct id, full_name from zoho_users) zu on zd.owner = zu.id`;

type StageRow = { stage: string; stage_order: unknown; stage_count: unknown };

export async function computePipeline(filters: AnalyticsFilters): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);
  const agentScoped = Boolean(f.agentId || f.agentName);

  const appsP = new SqlParams();
  const appsScope = dateScope(DEAL_TS_ZD, f, appsP);
  const appsOwner = pipelineOwnerPred('zu', f, appsP);
  const appsWhereOwner = appsOwner ? `and ${appsOwner}` : '';

  // Stage funnel from public.zoho_deals (has stage + owner) — intm_zoho_deals is a heavy SCD
  // view that regularly hits the 30s DWH statement_timeout under concurrent load.
  const stagesP = new SqlParams();
  const stagesDate = dateScope(DEAL_TS_ZD, f, stagesP);
  const stagesOwner = pipelineOwnerPred('zu', f, stagesP);
  const stagesWhereOwner = stagesOwner ? `and ${stagesOwner}` : '';

  const dailyP = new SqlParams();
  const dailyScope = dateScope(DEAL_TS, f, dailyP);
  const dailyOwnerJoin = agentScoped
    ? `left join (select distinct id, full_name from zoho_users) zu on zoho_deals.owner = zu.id`
    : '';
  const dailyOwnerPred = pipelineOwnerPred('zu', f, dailyP);
  const dailyWhereOwner = dailyOwnerPred ? `and ${dailyOwnerPred}` : '';

  const agentsP = new SqlParams();
  const agentsScope = dateScope(DEAL_TS_ZD, f, agentsP);
  const agentsOwner = pipelineOwnerPred('zu', f, agentsP);
  const agentsWhereOwner = agentsOwner ? `and ${agentsOwner}` : '';

  // Cap parallelism at 2 — the shared DWH pool is tiny (max ~5) and concurrent UI + warmer
  // stampedes used to exhaust it ("timeout exceeded when trying to connect").
  const [apps, stages] = await Promise.all([
    softQuery('pipeline.apps', () =>
      dwhQuery<{ this_period: unknown; prev_period: unknown }>(
        `select
           count(*) filter (where ${appsScope.current}) as this_period,
           count(*) filter (where ${appsScope.previous}) as prev_period
         from public.zoho_deals zd
         ${USERS_JOIN}
         where ((${appsScope.current}) or (${appsScope.previous}))
           ${appsWhereOwner}`,
        appsP.values,
      ),
    ),
    softQuery<StageRow>('pipeline.stages', () =>
      dwhQuery<StageRow>(
        `select zd.stage as stage, ${STAGE_ORDER_SQL} as stage_order, count(*) as stage_count
         from public.zoho_deals zd
         ${USERS_JOIN}
         where ${stagesDate.current}
           ${stagesWhereOwner}
         group by zd.stage
         order by 2`,
        stagesP.values,
      ),
    ),
  ]);
  const [daily, agents] = await Promise.all([
    softQuery<DayRow>('pipeline.daily', () =>
      dwhQuery<DayRow>(
        `select to_char(d.day, 'Mon DD') as day_label, coalesce(z.appfills, 0) as value
         from generate_series(${dailyScope.trendStart}, ${dailyScope.trendEnd}, interval '1 day') as d(day)
         left join (
           select date(${DEAL_TS}) as day, count(*) as appfills
           from public.zoho_deals
           ${dailyOwnerJoin}
           where ${DEAL_TS}::date >= (${dailyScope.trendStart})::date
             and ${DEAL_TS}::date <= (${dailyScope.trendEnd})::date
             ${dailyWhereOwner}
           group by 1
         ) z on z.day = d.day::date
         order by d.day`,
        dailyP.values,
      ),
    ),
    softQuery<{ agent_name: string | null; total: unknown; this_week: unknown; today: unknown }>(
      'pipeline.agents',
      () =>
        dwhQuery<{ agent_name: string | null; total: unknown; this_week: unknown; today: unknown }>(
          `select zu.full_name as agent_name,
                  count(*) as total,
                  count(*) filter (where date_trunc('week', ${DEAL_TS_ZD}) = date_trunc('week', current_date)) as this_week,
                  count(*) filter (where date(${DEAL_TS_ZD}) = current_date) as today
           from public.zoho_deals zd
           ${USERS_JOIN}
           where ${agentsScope.current}
             ${agentsWhereOwner}
           group by zu.full_name
           order by total desc
           limit 5`,
          agentsP.values,
        ),
    ),
  ]);

  const thisPeriod = num(apps[0]?.this_period);
  const prevPeriod = num(apps[0]?.prev_period);
  const totalDeals = stages.reduce((s, r) => s + num(r.stage_count), 0);
  const reached = (order: number): number =>
    stages
      .filter((r) => num(r.stage_order) >= order && num(r.stage_order) <= 11)
      .reduce((s, r) => s + num(r.stage_count), 0);
  const inFlight = stages
    .filter((r) => num(r.stage_order) >= 2 && num(r.stage_order) <= 10)
    .reduce((s, r) => s + num(r.stage_count), 0);

  const kpis: KpiStat[] = [
    {
      label: 'App Fills',
      value: fmtCount(thisPeriod),
      delta: { prev: prevPeriod, current: thisPeriod, higherIsBetter: true },
    },
    { label: 'Reached Cards Sent', value: pct(reached(8), totalDeals), hint: 'of filtered deals' },
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

  // Agent filter matched the book but this window has zero fills — still show the row so the UI
  // doesn't read as "agent not found".
  if (leaderboard.length === 0 && (f.agentName || f.agentId)) {
    leaderboard.push({
      name: f.agentName ?? 'Agent',
      col1: thisPeriod,
      col2: 0,
      col3: f.range === 'today' ? thisPeriod : 0,
    });
  }

  return {
    label: 'Pipeline',
    caption: captionFor('Deal flow and funnel conversion', f),
    kpis,
    trendLabel: 'App fills / day',
    trend: toTrend(daily),
    breakdownLabel: 'Deals by stage',
    breakdown,
    leaderboardLabel: f.agentId || f.agentName ? 'Agent app fills' : 'Top agents by app fills',
    leaderboardCols: ['Apps', 'Week', 'Today'],
    leaderboard,
  };
}
