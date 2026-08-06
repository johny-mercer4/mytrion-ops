/**
 * The ledger compute — turns the feeds into `Closing = Opening + Debit − Credit` per carrier per
 * section, for an arbitrary period (TZ §5).
 *
 * THE THREE THINGS THIS FILE EXISTS TO GET RIGHT:
 *
 * 1. **`opening` is `null` when none is recorded — never 0.** Zero is a *claim* that the carrier held no
 *    position at inception. Null is "we don't know yet". Coercing produces a Closing that is
 *    confidently wrong and reconciles-with-variance instead of not-reconciling-at-all, which buries the
 *    launch-migration backlog inside the real variance queue. Debit and Credit are still returned — they
 *    are independently true — so an agent sees the movement without a fabricated balance.
 *
 * 2. **An arbitrary window is only correct if the opening is rolled forward.** The stored opening
 *    anchors INCEPTION. For a window that starts later, `opening` must be the anchor plus every
 *    movement between the anchor date and the window start. Skipping that is the single most likely way
 *    to ship plausible wrong money, so it is done explicitly here rather than left to the caller.
 *
 * 3. **The chain holds by shared code.** Each section's Debit/Credit call the same feed functions as its
 *    neighbour's opposite side (see ./feeds.ts), so `S1.credit === S2.debit` and `S2.credit === S3.debit`
 *    are properties of the implementation, not of two queries staying in sync.
 *
 * Carriers may each have their own anchor date, so the roll-forward groups them by anchor and runs one
 * feed pass per distinct date. In practice a launch uses one or two dates, so that is a couple of extra
 * passes, not one per carrier.
 */
import { ledgerOpeningBalanceRepo, num } from '../../../repos/ledgerOpeningBalanceRepo.js';
import type { LedgerCarrier } from './clientType.js';
import {
  carrierTransactions,
  invoiced,
  invoicePayments,
  paymentsReceived,
  topUps,
  type CarrierSums,
  type Period,
} from './feeds.js';
import { getLedgerSection, type LedgerClientType, type LedgerSectionId } from './sections.js';

/** Where a row's opening balance came from — surfaced so the UI can explain a null. */
export type OpeningSource =
  | 'recorded'
  /** Anchored earlier than the window start, so movements were accumulated forward. */
  | 'rolled-forward'
  /** No opening balance on file for this carrier + section. */
  | 'missing'
  /** The window starts BEFORE the anchor date, so no balance can be stated for it. */
  | 'predates-inception';

export interface SectionMovement {
  carrierId: string;
  companyName: string;
  clientType: LedgerClientType;
  billingCycle: string;
  section: LedgerSectionId;
  /** null ⇒ unknown. NEVER coerced to 0 — see the module header. */
  opening: number | null;
  openingAsOf: string | null;
  openingSource: OpeningSource;
  debit: number;
  credit: number;
  /** `opening + debit − credit`, or null when `opening` is null. */
  closing: number | null;
  /** Per-term breakdown for the row subnote (fuel / money code / maintenance / loads / draws …). */
  components: Record<string, number>;
  warnings: string[];
}

/** Debit and Credit for one section over one period, keyed by carrier. */
interface SectionFlows {
  debit: CarrierSums;
  credit: CarrierSums;
  /** Extra per-carrier component sums for display. */
  components: Map<string, Record<string, number>>;
}

const get = (m: CarrierSums, id: string): number => m.get(id) ?? 0;

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Compute one section's Debit/Credit flows for a period.
 *
 * Section-by-section, straight from TZ §5.1/§5.2:
 *   cb-loc / cb-prepay  Debit = top-ups net of draws   Credit = fuel + money code + maintenance
 *   unbilled            Debit = the SAME transactions  Credit = amount invoiced by CMP
 *   ar                  Debit = the SAME invoices      Credit = payments applied
 *   untopped            Debit = payments received      Credit = the SAME top-up loads
 */
async function sectionFlows(
  section: LedgerSectionId,
  clientType: LedgerClientType,
  period: Period,
  carrierIds: readonly string[],
): Promise<SectionFlows> {
  const components = new Map<string, Record<string, number>>();
  const put = (id: string, key: string, value: number): void => {
    if (!value) return;
    const bag = components.get(id) ?? {};
    bag[key] = round2((bag[key] ?? 0) + value);
    components.set(id, bag);
  };

  switch (section) {
    case 'cb-loc':
    case 'cb-prepay': {
      const [loads, spend] = await Promise.all([
        topUps(period, carrierIds),
        carrierTransactions(period, clientType, carrierIds),
      ]);
      const debit: CarrierSums = new Map();
      for (const id of carrierIds) {
        const t = loads.get(id);
        if (!t) continue;
        // Net the draws into Debit so this equals ops' `loaded = TopUp − RMVE`.
        debit.set(id, round2(t.loads - t.draws));
        put(id, 'Top-up', t.loads);
        put(id, 'Draw', -t.draws);
      }
      for (const id of carrierIds) {
        put(id, 'Fuel', get(spend.fuel, id));
        put(id, 'Money code', get(spend.moneyCode, id));
        put(id, 'Maintenance', get(spend.maintenance, id));
      }
      return { debit, credit: spend.total, components };
    }

    case 'unbilled': {
      // Debit is the SAME feed as cb-loc's Credit — that is what makes the chain true.
      const [spend, inv] = await Promise.all([
        carrierTransactions(period, clientType, carrierIds),
        invoiced(period, carrierIds),
      ]);
      for (const id of carrierIds) {
        put(id, 'Fuel', get(spend.fuel, id));
        put(id, 'Money code', get(spend.moneyCode, id));
        put(id, 'Maintenance', get(spend.maintenance, id));
        put(id, 'Invoiced', -get(inv, id));
      }
      return { debit: spend.total, credit: inv, components };
    }

    case 'ar': {
      // Debit is the SAME feed as unbilled's Credit.
      const [inv, paid] = await Promise.all([
        invoiced(period, carrierIds),
        invoicePayments(period, carrierIds),
      ]);
      for (const id of carrierIds) {
        put(id, 'Invoiced', get(inv, id));
        put(id, 'Paid', -get(paid, id));
      }
      return { debit: inv, credit: paid, components };
    }

    case 'untopped': {
      // Credit is the SAME feed as cb-prepay's Debit.
      const [received, loads] = await Promise.all([
        paymentsReceived(period, carrierIds),
        topUps(period, carrierIds),
      ]);
      const credit: CarrierSums = new Map();
      for (const id of carrierIds) {
        const t = loads.get(id);
        if (t) credit.set(id, round2(t.loads));
        put(id, 'Received', get(received, id));
        if (t) put(id, 'Applied', -t.loads);
      }
      return { debit: received, credit, components };
    }
  }
}

/**
 * Sum the net movement `debit − credit` per carrier over a range — used to roll a stored opening
 * balance forward from its anchor date to the start of the requested window.
 */
async function netMovement(
  section: LedgerSectionId,
  clientType: LedgerClientType,
  period: Period,
  carrierIds: readonly string[],
): Promise<CarrierSums> {
  if (period.startDate >= period.endDateExclusive) return new Map();
  const flows = await sectionFlows(section, clientType, period, carrierIds);
  const out: CarrierSums = new Map();
  for (const id of carrierIds) {
    out.set(id, round2(get(flows.debit, id) - get(flows.credit, id)));
  }
  return out;
}

export interface ComputeSectionOptions {
  section: LedgerSectionId;
  /** Inclusive start, INCLUSIVE end — as the agent typed it. Converted once, here. */
  startDate: string;
  endDate: string;
  /** The carriers to compute. Already scope-filtered by the caller. */
  carriers: readonly LedgerCarrier[];
}

/** Shift a yyyy-mm-dd by whole days without going through a local-midnight Date. */
export function shiftYmd(s: string, days: number): string {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Compute a section for a set of carriers over a period.
 *
 * The caller passes INCLUSIVE dates (what the agent typed); everything below works in the repo's
 * exclusive-end convention after one conversion.
 */
export async function computeSection(opts: ComputeSectionOptions): Promise<SectionMovement[]> {
  const def = getLedgerSection(opts.section);
  const carriers = opts.carriers.filter((c) => c.clientType === def.clientType);
  if (!carriers.length) return [];

  const carrierIds = carriers.map((c) => c.carrierId);
  const period: Period = {
    startDate: opts.startDate,
    endDateExclusive: shiftYmd(opts.endDate, 1),
  };

  const [flows, anchors] = await Promise.all([
    sectionFlows(opts.section, def.clientType, period, carrierIds),
    ledgerOpeningBalanceRepo.findLiveBatch(carrierIds, [opts.section]),
  ]);

  /**
   * Roll-forward: group carriers by their anchor date so each distinct date costs ONE extra feed pass
   * rather than one per carrier. A launch typically uses one or two dates.
   */
  const byAnchor = new Map<string, string[]>();
  for (const c of carriers) {
    const anchor = anchors.get(`${c.carrierId}:${opts.section}`);
    if (!anchor) continue;
    if (anchor.asOfDate >= opts.startDate) continue; // nothing to roll forward
    const list = byAnchor.get(anchor.asOfDate) ?? [];
    list.push(c.carrierId);
    byAnchor.set(anchor.asOfDate, list);
  }

  const rollForward = new Map<string, number>();
  for (const [anchorDate, ids] of byAnchor) {
    const moved = await netMovement(
      opts.section,
      def.clientType,
      { startDate: anchorDate, endDateExclusive: opts.startDate },
      ids,
    );
    for (const id of ids) rollForward.set(id, moved.get(id) ?? 0);
  }

  return carriers.map((c) => {
    const id = c.carrierId;
    const anchor = anchors.get(`${id}:${opts.section}`);
    const debit = round2(get(flows.debit, id));
    const credit = round2(get(flows.credit, id));

    let opening: number | null = null;
    let openingSource: OpeningSource = 'missing';
    const warnings: string[] = [];

    if (!anchor) {
      warnings.push('No opening balance recorded — the closing balance cannot be stated.');
    } else if (anchor.asOfDate > opts.startDate) {
      // The window opens before the carrier's ledger does.
      openingSource = 'predates-inception';
      warnings.push(
        `This period starts before the opening balance date (${anchor.asOfDate}), so no balance applies to it.`,
      );
    } else if (anchor.asOfDate === opts.startDate) {
      opening = round2(num(anchor.amount));
      openingSource = 'recorded';
    } else {
      opening = round2(num(anchor.amount) + (rollForward.get(id) ?? 0));
      openingSource = 'rolled-forward';
    }

    return {
      carrierId: id,
      companyName: c.companyName,
      clientType: c.clientType,
      billingCycle: c.billingCycle,
      section: opts.section,
      opening,
      openingAsOf: anchor?.asOfDate ?? null,
      openingSource,
      debit,
      credit,
      closing: opening === null ? null : round2(opening + debit - credit),
      components: flows.components.get(id) ?? {},
      warnings,
    };
  });
}

export interface SectionTotals {
  carriers: number;
  opening: number;
  debit: number;
  credit: number;
  closing: number;
  /** How many rows could not state a closing balance — the migration backlog, kept visible. */
  missingOpening: number;
}

/**
 * Totals across a section. Rows with a null opening contribute their Debit and Credit (both true) but
 * NOT to the opening/closing totals, and are counted separately — otherwise a partly-migrated book
 * would show a total that silently omits an unknown number of carriers.
 */
export function sectionTotals(rows: readonly SectionMovement[]): SectionTotals {
  let opening = 0;
  let debit = 0;
  let credit = 0;
  let closing = 0;
  let missingOpening = 0;
  for (const r of rows) {
    debit += r.debit;
    credit += r.credit;
    if (r.opening === null || r.closing === null) {
      missingOpening += 1;
      continue;
    }
    opening += r.opening;
    closing += r.closing;
  }
  return {
    carriers: rows.length,
    opening: round2(opening),
    debit: round2(debit),
    credit: round2(credit),
    closing: round2(closing),
    missingOpening,
  };
}
