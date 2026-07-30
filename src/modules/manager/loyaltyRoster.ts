/**
 * Manager Mytrion → Loyalty Program: the ALL-CLIENTS roster that backs the tier board.
 *
 * Sales Mytrion's Data Center → Clients shows the same program scoped to ONE agent's book
 * (`fetchAgentClients`); this is the company-wide view, so it reuses the exact same DWH query via
 * `fetchAllClients()` — same gallons basis, same active-card counts, same billing cycle. If the two
 * diverged, a client's tier would differ depending on which Mytrion you opened it in.
 *
 * Why a TRIMMED row shape: the raw roster is ~8,000 carriers × ~20 fields ≈ 3.3 MB of JSON. Tier
 * only needs the active-card count and the monthly gallons, so we project down to the nine fields the
 * board actually renders (~1 MB) and drop debt/phone/DOT/money-code, which belong to the Clients tab
 * rather than the loyalty program.
 *
 * Tier resolution itself deliberately stays on the CLIENT, in the shared `loyalty.ts` module that
 * Sales already uses — one implementation of the thresholds, not a second copy in SQL or here.
 */
import { fetchAllClients } from '../../integrations/dwhClientRoster.js';

/** One carrier on the loyalty board — only what the tier math and the card need. */
export interface LoyaltyClientRow {
  carrierId: string;
  companyName: string;
  /** Current owning agent (`dim_company.agent`), '—' when the dim has none. */
  agentName: string;
  /** Declared fleet size — the program's TRACK basis (1 truck = owner-operator). `null` = unknown. */
  trucks: number | null;
  /** Total active cards on the account — context only; NOT the track (see _shared/loyalty.ts). */
  activeCards: number;
  /** Cards that actually transacted this calendar month. */
  activeCardsThisMonth: number;
  /** Cards that transacted LAST calendar month — the program's track basis ("≥1 tx previous month"). */
  activeCardsPrevMonth: number;
  /** This-calendar-month gallons — the program's tier basis. */
  gallonsThisMonth: number;
  /** This billing-cycle (26th→25th) gallons — the fallback basis before any pumps land this month. */
  cycleGallons: number;
  /** Previous calendar month gallons — powers the month-over-month trend. */
  gallonsPrevMonth: number;
  /** ≥1 transaction in the last 10 days. */
  computedIsActive: boolean;
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
export async function fetchLoyaltyRoster(): Promise<LoyaltyRosterResult> {
  const rows = await fetchAllClients();
  const clients: LoyaltyClientRow[] = rows
    .map((r) => ({
      carrierId: r.carrierId,
      companyName: r.companyName,
      agentName: r.agentName,
      trucks: r.trucks,
      activeCards: r.activeCards,
      activeCardsThisMonth: r.activeCardsThisMonth,
      activeCardsPrevMonth: r.activeCardsPrevMonth,
      gallonsThisMonth: r.gallonsThisMonth,
      cycleGallons: r.cycleGallons,
      gallonsPrevMonth: r.gallonsPrevMonth,
      computedIsActive: r.computedIsActive,
    }))
    .sort((a, b) => {
      const ga = a.gallonsThisMonth > 0 ? a.gallonsThisMonth : a.cycleGallons;
      const gb = b.gallonsThisMonth > 0 ? b.gallonsThisMonth : b.cycleGallons;
      if (gb !== ga) return gb - ga;
      return a.companyName.localeCompare(b.companyName);
    });
  return { clients, total: clients.length, fetchedAt: new Date().toISOString() };
}
