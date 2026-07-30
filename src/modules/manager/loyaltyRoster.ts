/**
 * Manager Mytrion → Loyalty Program: the ALL-CLIENTS roster that backs the tier board.
 *
 * Sales Mytrion's Data Center → Clients shows the same program scoped to ONE agent's book
 * (`fetchAgentClients`); this is the company-wide view, so it reuses the exact same DWH query via
 * `fetchAllClients()` — same gallons basis, same active-card counts, same billing cycle. If the two
 * diverged, a client's tier would differ depending on which Mytrion you opened it in.
 *
 * Why a TRIMMED row shape: the raw roster is ~8,000 carriers × ~20 fields ≈ 3.3 MB of JSON. Tier
 * only needs the projected track, gallon, status, and reward-control fields, so we drop
 * debt/phone/DOT/money-code, which belong to the Clients tab rather than the loyalty program.
 *
 * Tier resolution itself deliberately stays on the CLIENT, in the shared `loyalty.ts` module that
 * Sales already uses — one implementation of the thresholds, not a second copy in SQL or here.
 */
import { fetchAllClients } from '../../integrations/dwhClientRoster.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { loyaltyOverrides, type LoyaltyOverrideView } from './loyaltyOverrides.js';

/** One carrier on the loyalty board — only what the tier math and the card need. */
export interface LoyaltyClientRow {
  carrierId: string;
  companyName: string;
  /** Current owning agent (`dim_company.agent`), '—' when the dim has none. */
  agentName: string;
  /** Declared fleet size — reference only; loyalty tracks use closed-month transacting cards. */
  trucks: number | null;
  /** Total active cards on the account — context only; NOT the monthly track. */
  activeCards: number;
  /** Last persisted loyalty tier; retained only during a dormant month. */
  lastTierName: string;
  /** Cards that actually transacted this calendar month. */
  activeCardsThisMonth: number;
  /** Cards that transacted LAST calendar month — the program's track basis ("≥1 tx previous month"). */
  activeCardsPrevMonth: number;
  /** This-calendar-month total gallons — reference only. */
  gallonsThisMonth: number;
  /** This-month ULSR + ULSD gallons — next-month tier progress. */
  inNetworkGallonsThisMonth: number;
  /** This billing-cycle (26th→25th) total gallons — reference only. */
  cycleGallons: number;
  /** Previous calendar month total gallons — reference only. */
  gallonsPrevMonth: number;
  /** Previous-month ULSR + ULSD gallons — current tier basis. */
  inNetworkGallonsPrevMonth: number;
  /** ≥1 transaction in the last 10 days. */
  computedIsActive: boolean;
  /** Explicit manager exception; null keeps the normative automatic program. */
  loyaltyOverride: LoyaltyOverrideView | null;
}

export interface LoyaltyRosterResult {
  clients: LoyaltyClientRow[];
  /** Carrier count, so the card can show a total without measuring the array. */
  total: number;
  /** When the roster was read (the DWH is a replica; the card shows this as "updated"). */
  fetchedAt: string;
}

/**
 * Every carrier in the warehouse with its tier inputs, heaviest fuel volume first.
 *
 * Ordered by this-month gallons DESC so the clients that matter to the program (the ones actually
 * holding Gold/Silver/Bronze) land at the top of the first render window — the board renders
 * incrementally, and an alphabetical order would bury all 621 tiered clients behind thousands of
 * zero-gallon carriers.
 */
export async function fetchLoyaltyRoster(ctx: TenantContext): Promise<LoyaltyRosterResult> {
  const [rows, overrideRows] = await Promise.all([fetchAllClients(), loyaltyOverrides(ctx)]);
  const clients: LoyaltyClientRow[] = rows
    .map((r) => ({
      carrierId: r.carrierId,
      companyName: r.companyName,
      agentName: r.agentName,
      trucks: r.trucks,
      activeCards: r.activeCards,
      lastTierName: r.lastTierName,
      activeCardsThisMonth: r.activeCardsThisMonth,
      activeCardsPrevMonth: r.activeCardsPrevMonth,
      gallonsThisMonth: r.gallonsThisMonth,
      inNetworkGallonsThisMonth: r.inNetworkGallonsThisMonth,
      cycleGallons: r.cycleGallons,
      gallonsPrevMonth: r.gallonsPrevMonth,
      inNetworkGallonsPrevMonth: r.inNetworkGallonsPrevMonth,
      computedIsActive: r.computedIsActive,
      loyaltyOverride: overrideRows.get(r.carrierId) ?? null,
    }))
    .sort((a, b) => {
      const ga = a.inNetworkGallonsPrevMonth;
      const gb = b.inNetworkGallonsPrevMonth;
      if (gb !== ga) return gb - ga;
      return a.companyName.localeCompare(b.companyName);
    });
  return { clients, total: clients.length, fetchedAt: new Date().toISOString() };
}
