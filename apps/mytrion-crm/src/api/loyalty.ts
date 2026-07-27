/**
 * Manager Mytrion → Loyalty Program API. Reads EVERY carrier's tier inputs (active cards + monthly
 * gallons) from the manager-gated backend (`/v1/manager/loyalty/clients`). Read-only.
 *
 * Same DWH roster query as Sales' Data Center → Clients, minus the per-agent owner filter, so the two
 * surfaces resolve identical tiers. Tier math itself is client-side, in mytrions/_shared/loyalty.ts.
 */
import { request } from './transport';

/** One carrier on the loyalty board — mirrors the backend `LoyaltyClientRow`. */
export interface LoyaltyClient {
  carrierId: string;
  companyName: string;
  /** Current owning agent, '—' when the warehouse has none. */
  agentName: string;
  /** Total active cards on the account — context only; the TRACK uses prev-month transacting cards. */
  activeCards: number;
  activeCardsThisMonth: number;
  /** Cards that transacted LAST month — the program's track basis (see _shared/loyalty.ts). */
  activeCardsPrevMonth: number;
  /** This-calendar-month gallons — the program's tier basis. */
  gallonsThisMonth: number;
  /** Billing-cycle (26th→25th) gallons — the fallback basis before any pumps land this month. */
  cycleGallons: number;
  gallonsPrevMonth: number;
  computedIsActive: boolean;
}

export interface LoyaltyRoster {
  clients: LoyaltyClient[];
  total: number;
  fetchedAt: string;
}

// LEGACY department assertion — ignored for verified sessions (the server derives access from the
// session), kept only for the API-key / rollback path. Mirrors api/referrals.ts's MGR_HEADERS.
const MGR_HEADERS = { 'x-department-access': 'management' } as const;

/** Every carrier's tier inputs, heaviest this-month volume first (server-ordered). */
export function listLoyaltyClients(): Promise<LoyaltyRoster> {
  return request('GET', '/manager/loyalty/clients', { headers: MGR_HEADERS }) as Promise<LoyaltyRoster>;
}

/** The gallons figure the program resolves a tier from: this month, falling back to the cycle. */
export function loyaltyGallons(c: Pick<LoyaltyClient, 'gallonsThisMonth' | 'cycleGallons'>): number {
  return c.gallonsThisMonth > 0 ? c.gallonsThisMonth : c.cycleGallons;
}
