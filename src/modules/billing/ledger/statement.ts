/**
 * The drill-down statement — one carrier, one section, a period, as a bank-statement line list with a
 * running balance (TZ: "clicking a sum opens the client's operations history with a running balance").
 *
 * THE RUNNING BALANCE IS COMPUTED HERE, not in the UI. If the client derived it, any line the server
 * excluded would silently shift the whole column and the modal's last row would disagree with the
 * row's Closing — the most damaging failure mode in a reconciliation tool, because both numbers look
 * plausible. Computing it server-side makes `closing === lines[last].running` an invariant a test can
 * assert.
 *
 * Unlike ./compute.ts, which aggregates, this reads individual rows — so it is per-carrier, lazy (only
 * when a modal opens), and line-capped.
 */
import { dwh } from '../../../integrations/dwh.js';
import { num } from '../../../repos/ledgerOpeningBalanceRepo.js';
import {
  LOC_PAYMENT_METHOD,
  PREPAY_PAYMENT_METHOD,
} from '../../customerService/maintenanceFields.js';
import { maintenanceCaseRepo } from '../../../repos/maintenanceCaseRepo.js';
import { paymentTransactionRepo } from '../../../repos/paymentTransactionRepo.js';
import { lookupLedgerCarrier } from './clientType.js';
import { computeSection, shiftYmd, type SectionMovement } from './compute.js';
import { LEDGER_TZ } from './feeds.js';
import { getLedgerSection, type LedgerSectionId } from './sections.js';

/** A statement line is capped because a year of card spend for a large fleet is a lot of rows. */
export const MAX_STATEMENT_LINES = 5_000;

export type StatementRefType =
  | 'topup'
  | 'draw'
  | 'transaction'
  | 'invoice'
  | 'payment'
  | 'maintenance'
  | 'money-code';

export interface StatementLine {
  /** Stable key — dates repeat, so an index key would break React's reconciliation on a refetch. */
  id: string;
  /** yyyy-mm-dd. */
  date: string;
  description: string;
  /** Exactly one of debit/credit is non-null. */
  debit: number | null;
  credit: number | null;
  /** Running balance AFTER this line. Server-computed — see the module header. */
  running: number;
  refType: StatementRefType;
  refId?: string;
}

export interface CarrierStatement {
  carrierId: string;
  companyName: string;
  clientType: string;
  section: LedgerSectionId;
  sectionLabel: string;
  period: { startDate: string; endDate: string; endDateExclusive: string };
  opening: number | null;
  openingAsOf: string | null;
  openingSource: SectionMovement['openingSource'];
  debit: number;
  credit: number;
  closing: number | null;
  lines: StatementLine[];
  /** True when the line cap was hit — the totals are still whole, the list is not. */
  truncated: boolean;
  warnings: string[];
}

interface RawLine {
  date: string;
  description: string;
  amount: number;
  side: 'debit' | 'credit';
  refType: StatementRefType;
  refId?: string;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** yyyy-mm-dd from whatever the driver hands back for a date/timestamp column. */
function ymdOf(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? '').slice(0, 10);
}

async function cardSpendLines(
  carrierId: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  const rows = await dwh.query<{
    transaction_id: string | number;
    transaction_date: string | Date;
    funded_total: string;
    location_name: string | null;
  }>(
    // transaction_date is zoneless — compared as a plain range, no AT TIME ZONE. See ./feeds.ts.
    `SELECT transaction_id, transaction_date, funded_total, location_name
       FROM public.cmp_transaction
      WHERE carrier_id::text = $1
        AND transaction_date >= $2::date
        AND transaction_date <  $3::date
      ORDER BY transaction_date, transaction_id
      LIMIT ${MAX_STATEMENT_LINES}`,
    [carrierId, startDate, endExclusive],
  );
  return rows.map((r) => ({
    date: ymdOf(r.transaction_date),
    description: r.location_name ? `Fuel — ${r.location_name}` : 'Fuel',
    amount: num(r.funded_total),
    side: 'debit',
    refType: 'transaction',
    refId: String(r.transaction_id),
  }));
}

async function invoiceLines(
  carrierId: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  const rows = await dwh.query<{
    id: string | number;
    invoice_date: string | Date;
    total_amount: string;
    date_from: string | Date;
    date_to: string | Date;
  }>(
    `SELECT id, invoice_date, total_amount, date_from, date_to
       FROM public.cmp_invoice
      WHERE carrier_id::text = $1
        AND invoice_date >= $2::date
        AND invoice_date <  $3::date
        AND status <> 'CANCELLED'
      ORDER BY invoice_date, id
      LIMIT ${MAX_STATEMENT_LINES}`,
    [carrierId, startDate, endExclusive],
  );
  return rows.map((r) => ({
    date: ymdOf(r.invoice_date),
    description: `Invoice #${r.id} (${ymdOf(r.date_from)} → ${ymdOf(r.date_to)})`,
    amount: num(r.total_amount),
    side: 'debit',
    refType: 'invoice',
    refId: String(r.id),
  }));
}

async function invoicePaymentLines(
  carrierId: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  const rows = await dwh.query<{
    invoice_id: string | number;
    payment_date: string | Date;
    amount: string;
  }>(
    `SELECT p.invoice_id, p.payment_date, p.amount
       FROM public.cmp_invoice_payment p
       JOIN public.cmp_invoice i ON i.id = p.invoice_id
      WHERE i.carrier_id::text = $1
        AND p.payment_date >= $2::date
        AND p.payment_date <  $3::date
        AND COALESCE(p.is_failed, false) = false
      ORDER BY p.payment_date, p.invoice_id
      LIMIT ${MAX_STATEMENT_LINES}`,
    [carrierId, startDate, endExclusive],
  );
  return rows.map((r, i) => ({
    date: ymdOf(r.payment_date),
    description: `Payment applied to invoice #${r.invoice_id}`,
    amount: num(r.amount),
    side: 'credit',
    refType: 'payment',
    refId: `${r.invoice_id}-${i}`,
  }));
}

async function topUpLines(
  carrierId: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  const rows = await dwh.query<{ create_date: string | Date; amount: string; id: string | number | null }>(
    `SELECT create_date, amount, NULL::bigint AS id
       FROM public.cmp_billing_history
      WHERE carrier_id::text = $1
        AND create_date >= $2::date - interval '1 day'
        AND create_date <  $3::date + interval '1 day'
        AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date >= $2::date
        AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE '${LEDGER_TZ}')::date <  $3::date
      ORDER BY create_date
      LIMIT ${MAX_STATEMENT_LINES}`,
    [carrierId, startDate, endExclusive],
  );
  return rows.map((r, i) => {
    const amt = num(r.amount);
    const isLoad = amt > 0;
    return {
      date: ymdOf(r.create_date),
      description: isLoad ? 'Top-up' : 'Draw (RMVE)',
      // A draw is a NEGATIVE debit rather than a credit: Customer Balance's Debit is `loads − draws`,
      // so putting a draw on the credit side here would make the running balance disagree with the
      // section row's Debit column.
      amount: isLoad ? amt : -Math.abs(amt),
      side: 'debit',
      refType: isLoad ? 'topup' : 'draw',
      refId: `bh-${ymdOf(r.create_date)}-${i}`,
    };
  });
}

async function paymentReceivedLines(
  carrierId: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  const rows = await paymentTransactionRepo.listPage({
    page: 1,
    limit: Math.min(2000, MAX_STATEMENT_LINES),
    carrierId,
    dateFrom: startDate,
    dateTo: endExclusive,
  });
  return rows.rows
    .filter((r) => !r.isReturned)
    .map((r) => ({
      date: ymdOf(r.occurredAt),
      description: `Payment received — ${r.source}${r.senderName ? ` (${r.senderName})` : ''}`,
      amount: num(r.amount),
      side: 'debit' as const,
      refType: 'payment' as const,
      refId: String(r.id),
    }));
}

async function maintenanceLines(
  carrierId: string,
  clientType: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  const cases = await maintenanceCaseRepo.listForLedger(carrierId, startDate, endExclusive);
  const method = clientType === 'LOC' ? LOC_PAYMENT_METHOD : PREPAY_PAYMENT_METHOD;
  return cases
    .filter((c) => c.paymentMethod === method)
    .map((c) => ({
      date: ymdOf(c.caseDate),
      description: `Maintenance — ${c.caseType ?? 'service'}`,
      amount: num(c.totalAmount),
      side: 'debit' as const,
      refType: 'maintenance' as const,
      refId: c.id,
    }));
}

/**
 * Which raw lines make up each side of each section. Mirrors ./compute.ts's `sectionFlows` — the
 * statement must itemize exactly what the aggregate counted, or the two disagree.
 */
async function linesFor(
  section: LedgerSectionId,
  carrierId: string,
  clientType: string,
  startDate: string,
  endExclusive: string,
): Promise<RawLine[]> {
  switch (section) {
    case 'cb-loc':
    case 'cb-prepay': {
      const [loads, spend, maint] = await Promise.all([
        topUpLines(carrierId, startDate, endExclusive),
        cardSpendLines(carrierId, startDate, endExclusive),
        maintenanceLines(carrierId, clientType, startDate, endExclusive),
      ]);
      return [
        ...loads,
        ...spend.map((l) => ({ ...l, side: 'credit' as const })),
        ...maint.map((l) => ({ ...l, side: 'credit' as const })),
      ];
    }
    case 'unbilled': {
      const [spend, maint, inv] = await Promise.all([
        cardSpendLines(carrierId, startDate, endExclusive),
        maintenanceLines(carrierId, clientType, startDate, endExclusive),
        invoiceLines(carrierId, startDate, endExclusive),
      ]);
      return [...spend, ...maint, ...inv.map((l) => ({ ...l, side: 'credit' as const }))];
    }
    case 'ar': {
      const [inv, paid] = await Promise.all([
        invoiceLines(carrierId, startDate, endExclusive),
        invoicePaymentLines(carrierId, startDate, endExclusive),
      ]);
      return [...inv, ...paid];
    }
    case 'untopped': {
      const [received, loads] = await Promise.all([
        paymentReceivedLines(carrierId, startDate, endExclusive),
        topUpLines(carrierId, startDate, endExclusive),
      ]);
      return [
        ...received,
        ...loads
          .filter((l) => l.refType === 'topup')
          .map((l) => ({ ...l, side: 'credit' as const, description: 'Top-up applied' })),
      ];
    }
  }
}

export interface StatementOptions {
  carrierId: string;
  section: LedgerSectionId;
  /** INCLUSIVE, as the agent typed it. */
  startDate: string;
  endDate: string;
}

/**
 * Build the statement. The aggregate half comes from `computeSection` — the SAME code the section table
 * uses — so the header figures on the modal are the row the agent clicked, by construction.
 */
export async function buildCarrierStatement(opts: StatementOptions): Promise<CarrierStatement> {
  const def = getLedgerSection(opts.section);
  const lookup = await lookupLedgerCarrier(opts.carrierId);
  if (!lookup.found || !lookup.carrier) {
    throw new Error(`Carrier ${opts.carrierId} is not in the ledger (${lookup.reason ?? 'not found'})`);
  }
  const carrier = lookup.carrier;
  const endDateExclusive = shiftYmd(opts.endDate, 1);

  const [movements, raw] = await Promise.all([
    computeSection({
      section: opts.section,
      startDate: opts.startDate,
      endDate: opts.endDate,
      carriers: [carrier],
    }),
    linesFor(opts.section, carrier.carrierId, carrier.clientType, opts.startDate, endDateExclusive),
  ]);

  const movement = movements[0];
  const opening = movement?.opening ?? null;

  // Sort by date, then by a stable tiebreak so a refetch cannot reorder equal-dated lines and shift the
  // running balance column under the agent.
  raw.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    if (a.refType !== b.refType) return a.refType < b.refType ? -1 : 1;
    return (a.refId ?? '').localeCompare(b.refId ?? '');
  });

  const truncated = raw.length > MAX_STATEMENT_LINES;
  const kept = truncated ? raw.slice(0, MAX_STATEMENT_LINES) : raw;

  let running = opening ?? 0;
  const lines: StatementLine[] = kept.map((l, i) => {
    running = round2(running + (l.side === 'debit' ? l.amount : -l.amount));
    return {
      id: `${l.refType}-${l.refId ?? i}-${i}`,
      date: l.date,
      description: l.description,
      debit: l.side === 'debit' ? round2(l.amount) : null,
      credit: l.side === 'credit' ? round2(l.amount) : null,
      running,
      refType: l.refType,
      ...(l.refId ? { refId: l.refId } : {}),
    };
  });

  const warnings = [...(movement?.warnings ?? [])];
  if (truncated) {
    warnings.push(
      `Only the first ${MAX_STATEMENT_LINES.toLocaleString('en-US')} lines are listed; the totals above cover the whole period.`,
    );
  }

  return {
    carrierId: carrier.carrierId,
    companyName: carrier.companyName,
    clientType: carrier.clientType,
    section: opts.section,
    sectionLabel: def.label,
    period: { startDate: opts.startDate, endDate: opts.endDate, endDateExclusive },
    opening,
    openingAsOf: movement?.openingAsOf ?? null,
    openingSource: movement?.openingSource ?? 'missing',
    debit: movement?.debit ?? 0,
    credit: movement?.credit ?? 0,
    closing: movement?.closing ?? null,
    lines,
    truncated,
    warnings,
  };
}
