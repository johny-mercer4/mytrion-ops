/**
 * Manager Mytrion → Loyalty Program API. Reads every carrier's tier inputs and persists the
 * marketing-gated per-client reward controls exposed by the Loyalty workspace.
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
// session), kept only for the API-key / rollback path. Mirrors api/referrals.ts's MKT_HEADERS.
const MKT_HEADERS = { 'x-department-access': 'marketing' } as const;

/** Every carrier's tier inputs, heaviest this-month volume first (server-ordered). */
export function listLoyaltyClients(options: { refresh?: boolean } = {}): Promise<LoyaltyRoster> {
  return request('GET', '/marketing/loyalty/clients', {
    headers: MKT_HEADERS,
    query: options.refresh ? { refresh: '1' } : {},
  }) as Promise<LoyaltyRoster>;
}

/**
 * One carrier measured against a CHOSEN month, for the export.
 *
 * Field names say which WINDOW the figure comes from, never "prev"/"this": `basis*` is the month that
 * earns the tier (M-1) and `month*` is the month being reported (M). The board's `LoyaltyClient`
 * above can afford `prevMonth`/`thisMonth` because it is always anchored on today; an export of March
 * cannot. `loyaltyExportModel.ts` is the one place that maps these onto the shared tier resolver.
 */
export interface LoyaltyMonthClient {
  carrierId: string;
  companyName: string;
  agentName: string;
  trucks: number | null;
  /** Account-level active cards from the warehouse dim — today's figure, not the month's. */
  activeCards: number;
  /** `dim_company.tier_name` as persisted now. Present for context; prefer `retainedTierName`. */
  currentStoredTierName: string;
  /**
   * The retained tier the server is willing to stand behind for this month — the stored value for a
   * current-month export, and deliberately EMPTY for any past month (a carrier that is Gold today
   * was not necessarily Gold in March).
   */
  retainedTierName: string;
  basisActiveCards: number;
  basisInNetworkGallons: number;
  basisTotalGallons: number;
  basisTransactions: number;
  monthActiveCards: number;
  monthInNetworkGallons: number;
  monthTotalGallons: number;
  monthTransactions: number;
  /** The 26th→25th billing cycle closing inside the reported month. */
  cycleGallons: number;
  /** ISO `YYYY-MM-DD` of the latest transaction in the scanned window, or null. */
  lastTransactionAt: string | null;
  /** Manual exception as configured NOW — `updatedAt` says when that became true. */
  loyaltyOverride: LoyaltyClientOverride | null;
}

export interface LoyaltyMonthRoster {
  /** The reported month, `YYYY-MM-01`. */
  month: string;
  /** The month that earns the tier — always one month before `month`. */
  basisMonth: string;
  monthLabel: string;
  basisMonthLabel: string;
  cycleLabel: string;
  /** False when the reported month is still in progress, so its activity figures are partial. */
  monthComplete: boolean;
  clients: LoyaltyMonthClient[];
  total: number;
  fetchedAt: string;
}

/**
 * The month-anchored roster behind the export. A two-month mart scan over ~8k carriers, so it gets a
 * generous timeout — the transport's 20s default is tuned for interactive reads, not extracts.
 */
export function getLoyaltyMonthRoster(
  month: string,
  options: { refresh?: boolean } = {},
): Promise<LoyaltyMonthRoster> {
  return request('GET', '/marketing/loyalty/export', {
    headers: MKT_HEADERS,
    query: options.refresh ? { month, refresh: '1' } : { month },
    timeoutMs: 90_000,
  }) as Promise<LoyaltyMonthRoster>;
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
  return request('PATCH', `/marketing/loyalty/clients/${encodeURIComponent(carrierId)}/rewards`, {
    body: input,
    headers: MKT_HEADERS,
  }) as Promise<{ override: LoyaltyClientOverride }>;
}

export function resetLoyaltyOverride(carrierId: string): Promise<{ removed: boolean }> {
  return request('DELETE', `/marketing/loyalty/clients/${encodeURIComponent(carrierId)}/rewards`, {
    headers: MKT_HEADERS,
  }) as Promise<{ removed: boolean }>;
}

/** Closed-month in-network gallons used to resolve the tier active now. */
export function loyaltyGallons(c: Pick<LoyaltyClient, 'inNetworkGallonsPrevMonth'>): number {
  return c.inNetworkGallonsPrevMonth;
}
