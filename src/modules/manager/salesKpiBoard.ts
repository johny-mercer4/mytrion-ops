/**
 * Sales Management → KPI: every sales agent with their headline numbers for the current cycle.
 *
 * Two DWH queries, both grouped by AGENT — not a fan-out. The obvious implementation is to call
 * servercrm's `/api/agent/dwh/snapshot` once per agent, which is what the Sales Mytrion's Home tab
 * does for the ONE agent looking at it; across ~65 agents that is ~65 sequential vendor calls. The
 * same numbers come out of one mart scan grouped by `dim_company.agent`, measured at ~816ms.
 *
 *   swipes / gallons / cards  octane.mart_transaction_line_items ⋈ octane.dim_company (by agent)
 *   app fills                 public.zoho_deals ⋈ public.zoho_users (by deal owner)
 *
 * ⚠️ The two sources are joined on the agent's NAME, because they have no shared id: the mart side
 * carries `dim_company.agent` (a name string) and the Zoho side carries `zoho_users.full_name`.
 * `dim_company.agent_zoho_user_id` exists but does NOT match a session's Zoho id — the same trap
 * documented on the Sales Data Center, where an id-only match returned 0 rows for every agent. So
 * the join is by normalised name and an agent whose name differs between systems shows App Fills
 * of 0 rather than silently disappearing.
 *
 * "Cycle" is Octane's billing cycle — the 26th through the 25th — matching dwhClientRoster.
 */
import { dwh } from '../../integrations/dwh.js';

/** The 26th→25th billing cycle, stated once and reused by both queries. */
const CYCLE_CTE = `
  cyc as (
    select case when extract(day from current_date) >= 26
                then date_trunc('month', current_date) + interval '25 days'
                else date_trunc('month', current_date) - interval '1 month' + interval '25 days'
           end as cycle_start
  )`;

export interface SalesAgentKpi {
  agent: string;
  /** Clients owned in dim_company — the denominator for everything else. */
  clients: number;
  /** Fuel transactions this cycle. The "Card Swipes" headline. */
  swipes: number;
  gallons: number;
  /** Distinct cards transacting this cycle. */
  activeCards: number;
  /** Deals whose application landed this cycle. Summed across duplicate Zoho user records. */
  appFills: number;
  lastTransactionAt: string | null;
  /**
   * False for an agent who filled applications but owns no carrier in dim_company — lead-gen and
   * new agents. Their fuel figures are structurally zero, not a bad month, and the UI says so.
   */
  inWarehouse: boolean;
}

export interface SalesKpiBoard {
  cycleStart: string;
  fetchedAt: string;
  agents: SalesAgentKpi[];
  totals: { clients: number; swipes: number; gallons: number; activeCards: number; appFills: number };
}

interface ActivityRow {
  agent: string;
  clients: string | number;
  cycle_gallons: string | number;
  cycle_swipes: string | number;
  active_cards: string | number;
  last_tx: Date | string | null;
}

interface FillRow {
  agent: string | null;
  app_fills: string | number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Names arrive with inconsistent case and padding from two systems; compare on a normal form. */
const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function fetchSalesKpiBoard(): Promise<SalesKpiBoard> {
  const [activity, fills, cycle] = await Promise.all([
    dwh.query<ActivityRow>(
      `with ${CYCLE_CTE},
       owned as (
         select carrier_id, agent
           from octane.dim_company
          where agent is not null and btrim(agent) <> '' and carrier_id is not null
       )
       select o.agent,
              count(distinct o.carrier_id)                                as clients,
              coalesce(sum(t.line_item_fuel_quantity), 0)::numeric(14,2)  as cycle_gallons,
              count(distinct t.transaction_id)                            as cycle_swipes,
              count(distinct t.card_number)                               as active_cards,
              max(t.transaction_date)                                     as last_tx
         from owned o
         -- LEFT join: an agent with clients but no fuelling this cycle must still appear, at zero.
         -- An inner join silently drops exactly the agents a manager most wants to see.
         left join octane.mart_transaction_line_items t
                on t.carrier_id = o.carrier_id
               and t.transaction_date >= (select cycle_start from cyc)
        group by o.agent`,
      [],
    ),
    dwh.query<FillRow>(
      `with ${CYCLE_CTE}
       select zu.full_name as agent, count(*) as app_fills
         from public.zoho_deals zd
         left join (select distinct id, full_name from public.zoho_users) zu on zu.id = zd.owner
        where coalesce(zd.application_date, zd.created_time) >= (select cycle_start from cyc)
        group by zu.full_name`,
      [],
    ),
    dwh.query<{ cycle_start: Date | string }>(`with ${CYCLE_CTE} select cycle_start from cyc`, []),
  ]);

  /*
   * SUM, never overwrite. Zoho holds several user records for the same person under differently
   * formatted names — "Samandar Baxodirov", "SAMANDAR BAXODIROV" and
   * "BAXODIROV SAMANDAR YUSUFALI O'G'LI Ford" are one agent with three owner ids. They collapse to
   * one key here, and assigning instead of adding would report only whichever row landed last.
   */
  const fillsByAgent = new Map<string, { fills: number; display: string }>();
  for (const row of fills) {
    const key = norm(row.agent);
    if (!key) continue;
    const prior = fillsByAgent.get(key);
    fillsByAgent.set(key, {
      fills: (prior?.fills ?? 0) + num(row.app_fills),
      display: prior?.display ?? String(row.agent),
    });
  }

  const seen = new Set<string>();
  const agents: SalesAgentKpi[] = activity.map((row) => {
    const key = norm(String(row.agent));
    seen.add(key);
    return {
      agent: String(row.agent),
      clients: num(row.clients),
      swipes: num(row.cycle_swipes),
      gallons: num(row.cycle_gallons),
      activeCards: num(row.active_cards),
      appFills: fillsByAgent.get(key)?.fills ?? 0,
      lastTransactionAt: row.last_tx ? new Date(row.last_tx).toISOString() : null,
      inWarehouse: true,
    };
  });

  /*
   * Agents who filled applications this cycle but own no carrier in dim_company — lead-gen and new
   * agents, measured at 22 people and 263 app fills. Driving the board off dim_company alone made
   * that work invisible, which for a KPI board is the worst kind of wrong: it under-reports exactly
   * the people whose only output IS app fills. They appear with zeroed fuel figures and a flag, so
   * the zeros read as "owns no carriers" rather than "did nothing".
   */
  for (const [key, value] of fillsByAgent) {
    if (seen.has(key)) continue;
    agents.push({
      agent: value.display,
      clients: 0,
      swipes: 0,
      gallons: 0,
      activeCards: 0,
      appFills: value.fills,
      lastTransactionAt: null,
      inWarehouse: false,
    });
  }

  agents.sort((a, b) => b.gallons - a.gallons || b.appFills - a.appFills);

  const totals = agents.reduce(
    (acc, a) => ({
      clients: acc.clients + a.clients,
      swipes: acc.swipes + a.swipes,
      gallons: acc.gallons + a.gallons,
      activeCards: acc.activeCards + a.activeCards,
      appFills: acc.appFills + a.appFills,
    }),
    { clients: 0, swipes: 0, gallons: 0, activeCards: 0, appFills: 0 },
  );

  const start = cycle[0]?.cycle_start;
  return {
    cycleStart: start ? new Date(start).toISOString() : new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    agents,
    totals,
  };
}
