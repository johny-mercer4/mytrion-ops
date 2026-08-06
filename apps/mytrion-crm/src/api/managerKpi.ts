/**
 * Manager → Sales KPI board.
 *
 * One payload holding every agent, so sorting and filtering are client-side and instant. The
 * server derives it from two grouped DWH queries rather than a per-agent fan-out — see
 * modules/manager/salesKpiBoard.ts.
 */
import { request } from './transport';

export interface SalesAgentKpi {
  agent: string;
  /** Carriers owned in octane.dim_company. */
  clients: number;
  /** Fuel transactions this cycle — the "Card Swipes" headline. */
  swipes: number;
  gallons: number;
  activeCards: number;
  /** Deals whose application landed this cycle, summed across duplicate Zoho user records. */
  appFills: number;
  lastTransactionAt: string | null;
  /**
   * False for an agent who fills applications but owns no carrier in the warehouse — lead-gen and
   * new agents. Their fuel figures are structurally zero, not a bad cycle.
   */
  inWarehouse: boolean;
}

export interface SalesKpiBoard {
  /** Start of the 26th→25th billing cycle these figures cover. */
  cycleStart: string;
  fetchedAt: string;
  agents: SalesAgentKpi[];
  totals: {
    clients: number;
    swipes: number;
    gallons: number;
    activeCards: number;
    appFills: number;
  };
}

export async function getSalesKpiBoard(): Promise<SalesKpiBoard> {
  return (await request('GET', '/manager/sales/kpi/board')) as SalesKpiBoard;
}
