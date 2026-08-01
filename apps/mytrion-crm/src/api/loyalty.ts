/**
 * Manager Mytrion → Loyalty Program API. Reads every carrier's tier inputs and persists the
 * manager-gated per-client reward controls exposed by the Loyalty workspace.
 *
 * Same DWH roster query as Sales' Data Center → Clients, minus the per-agent owner filter, so the two
 * surfaces resolve identical tiers. Tier math itself is client-side, in mytrions/_shared/loyalty.ts.
 */
import { request } from './transport';

export const LOYALTY_REWARD_IDS = [
  'transaction_fee_waiver',
  'credit_score_check',
  'money_code_limit',
  'monthly_fee_waiver',
  'ta_petro_rebate',
  'loves_rebate',
] as const;
export type LoyaltyRewardId = (typeof LOYALTY_REWARD_IDS)[number];
export type LoyaltyEnterpriseMode = 'normal_billing' | 'volume_target';

export interface LoyaltyClientOverride {
  carrierId: string;
  enterpriseMode: LoyaltyEnterpriseMode | null;
  enterpriseGoldTargetGallons: number | null;
  /** null = tier defaults; [] = deliberately no rewards. */
  enabledRewardIds: LoyaltyRewardId[] | null;
  note: string | null;
  updatedBy: string;
  updatedAt: string;
}

/** One carrier on the loyalty board — mirrors the backend `LoyaltyClientRow`. */
export interface LoyaltyClient {
  carrierId: string;
  companyName: string;
  /** Current owning agent, '—' when the warehouse has none. */
  agentName: string;
  /** Declared fleet size — reference only; loyalty tracks use monthly transacting cards. */
  trucks: number | null;
  /** Total active cards on the account — account context, not the closed-month track. */
  activeCards: number;
  lastTierName: string;
  activeCardsThisMonth: number;
  /** Cards that transacted LAST month — the program's track basis (see _shared/loyalty.ts). */
  activeCardsPrevMonth: number;
  /** This-calendar-month total gallons — reference only. */
  gallonsThisMonth: number;
  /** This-month ULSR + ULSD gallons — next evaluation progress. */
  inNetworkGallonsThisMonth: number;
  /** Billing-cycle (26th→25th) total gallons — reference only. */
  cycleGallons: number;
  gallonsPrevMonth: number;
  /** Closed previous-month ULSR + ULSD gallons — current tier basis. */
  inNetworkGallonsPrevMonth: number;
  computedIsActive: boolean;
  loyaltyOverride: LoyaltyClientOverride | null;
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
export function listLoyaltyClients(options: { refresh?: boolean } = {}): Promise<LoyaltyRoster> {
  return request('GET', '/manager/loyalty/clients', {
    headers: MGR_HEADERS,
    query: options.refresh ? { refresh: '1' } : {},
  }) as Promise<LoyaltyRoster>;
}

export interface SaveLoyaltyOverrideInput {
  companyName: string;
  enterpriseMode: LoyaltyEnterpriseMode | null;
  enterpriseGoldTargetGallons: number | null;
  enabledRewardIds: LoyaltyRewardId[] | null;
  note: string | null;
}

export function saveLoyaltyOverride(
  carrierId: string,
  input: SaveLoyaltyOverrideInput,
): Promise<{ override: LoyaltyClientOverride }> {
  return request('PATCH', `/manager/loyalty/clients/${encodeURIComponent(carrierId)}/rewards`, {
    body: input,
    headers: MGR_HEADERS,
  }) as Promise<{ override: LoyaltyClientOverride }>;
}

export function resetLoyaltyOverride(carrierId: string): Promise<{ removed: boolean }> {
  return request('DELETE', `/manager/loyalty/clients/${encodeURIComponent(carrierId)}/rewards`, {
    headers: MGR_HEADERS,
  }) as Promise<{ removed: boolean }>;
}

/** Closed-month in-network gallons used to resolve the tier active now. */
export function loyaltyGallons(c: Pick<LoyaltyClient, 'inNetworkGallonsPrevMonth'>): number {
  return c.inNetworkGallonsPrevMonth;
}
