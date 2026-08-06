/**
 * Ledger view-model helpers — range conversion, grouping, and formatting shared by the Ledger panels.
 *
 * THE ONE PLACE range → querystring happens. Billing is inconsistent about `endDate`: the list
 * endpoints treat it as EXCLUSIVE while `/billing/prepay/ledger` treats it as INCLUSIVE, which is why
 * Prepay.tsx shifts back a day at its call site. Every `/billing/ledger/*` endpoint is INCLUSIVE, and
 * routing all conversion through `toWireRange()` keeps that a one-line fact rather than a shift
 * scattered across call sites. An off-by-one here produces plausible-looking wrong money.
 */
import type {
  LedgerClientType,
  LedgerSectionId,
  OpeningBalanceWire,
} from '../../api/ledgerTypes';

export interface LedgerRange {
  /** yyyy-mm-dd, inclusive. */
  from: string;
  /** yyyy-mm-dd, inclusive. */
  to: string;
}

/**
 * Convert a UI range to the wire form. Every ledger endpoint is inclusive, so this is currently a
 * pass-through — its value is being the single seam if that ever changes per endpoint.
 */
export function toWireRange(range: LedgerRange): { startDate: string; endDate: string } {
  return { startDate: range.from, endDate: range.to };
}

/** yyyy-mm-dd for a Date, in local time (no UTC round-trip, so no day shift). */
export function ymd(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Shift a yyyy-mm-dd string by whole days without constructing a local-midnight Date. */
export function shiftYmd(s: string, days: number): string {
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** A sane default period: the last 7 days, ending today. */
export function defaultRange(): LedgerRange {
  const today = ymd(new Date());
  return { from: shiftYmd(today, -6), to: today };
}

export function isValidRange(range: LedgerRange): boolean {
  return Boolean(range.from) && Boolean(range.to) && range.from <= range.to;
}

export function rangesEqual(a: LedgerRange | null, b: LedgerRange | null): boolean {
  if (!a || !b) return a === b;
  return a.from === b.from && a.to === b.to;
}

/**
 * 'Jun 11, 2026' from a yyyy-mm-dd string, by string split — never `new Date(iso)`, which parses a
 * bare date as UTC midnight and renders the previous day west of Greenwich.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatYmd(s: string | null | undefined): string {
  if (!s) return '—';
  const parts = s.slice(0, 10).split('-');
  if (parts.length !== 3) return s;
  const [y, m, d] = parts as [string, string, string];
  const mi = Number(m) - 1;
  return `${MONTHS[mi] ?? m} ${Number(d)}, ${y}`;
}

/** 'Jun 11' — the compact form for dense tables. */
export function formatYmdShort(s: string | null | undefined): string {
  if (!s) return '—';
  const parts = s.slice(0, 10).split('-');
  if (parts.length !== 3) return s;
  const [, m, d] = parts as [string, string, string];
  return `${MONTHS[Number(m) - 1] ?? m} ${Number(d)}`;
}

/** An ISO timestamp as 'Jun 11, 2026, 3:04 PM'. Used for revision/audit lines. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Money, always signed-aware and always 2dp. `—` for a genuinely absent value, NOT for zero. */
export function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * One carrier's openings across every section — the row shape the Opening Balances table renders.
 * The API returns one row per (carrier, section); the UI shows one row per carrier.
 */
export interface CarrierOpeningsRow {
  carrierId: string;
  companyName: string;
  clientType: LedgerClientType | null;
  /** Per-section live amounts, plus the revision id so an edit can pass optimistic concurrency. */
  amounts: Partial<Record<LedgerSectionId, { amount: number; asOfDate: string; revisionId: string }>>;
  /** The most recent write across this carrier's sections. */
  updatedAt: string | null;
  updatedBy: string | null;
  sectionsRecorded: number;
}

export function groupOpeningsByCarrier(rows: readonly OpeningBalanceWire[]): CarrierOpeningsRow[] {
  const byCarrier = new Map<string, CarrierOpeningsRow>();
  for (const row of rows) {
    let entry = byCarrier.get(row.carrierId);
    if (!entry) {
      entry = {
        carrierId: row.carrierId,
        companyName: row.companyName ?? '',
        clientType: (row.clientType as LedgerClientType | null) ?? null,
        amounts: {},
        updatedAt: null,
        updatedBy: null,
        sectionsRecorded: 0,
      };
      byCarrier.set(row.carrierId, entry);
    }
    if (!entry.companyName && row.companyName) entry.companyName = row.companyName;
    if (!entry.clientType && row.clientType) entry.clientType = row.clientType as LedgerClientType;
    entry.amounts[row.section] = {
      amount: row.amount,
      asOfDate: row.asOfDate,
      revisionId: row.id,
    };
    entry.sectionsRecorded += 1;
    if (!entry.updatedAt || row.createdAt > entry.updatedAt) {
      entry.updatedAt = row.createdAt;
      entry.updatedBy = row.createdByName;
    }
  }
  return [...byCarrier.values()].sort((a, b) =>
    (a.companyName || a.carrierId).localeCompare(b.companyName || b.carrierId),
  );
}

/** Client-type pill tone, matching the semantic token names used across billing. */
export function clientTypeTone(t: LedgerClientType | string | null): 'info' | 'good' | 'neutral' {
  if (t === 'LOC') return 'info';
  if (t === 'Prepay') return 'good';
  return 'neutral';
}

/**
 * Turn a failed lookup into the message the agent should read. The reasons are deliberately distinct
 * on the wire: "this carrier doesn't exist" and "this carrier is out of scope" call for different
 * actions, and collapsing them into one string sends people looking for a typo that isn't there.
 */
export function lookupMessage(
  reason: string | null | undefined,
  carrierId: string,
): { kind: 'error' | 'notice'; text: string } {
  switch (reason) {
    case 'wex-funded':
      return {
        kind: 'notice',
        text: 'WEX-Funded carriers are outside the Billing Ledger — WEX funds them directly, so no company balance or AR exists.',
      };
    case 'no-type':
      return {
        kind: 'notice',
        text: 'This carrier has no LOC/Prepay type on file. Record a client-type override before entering an opening balance.',
      };
    default:
      return { kind: 'error', text: `No carrier found for ${carrierId}.` };
  }
}

/** Read a message off an unknown thrown value without leaking `[object Object]` into the UI. */
export function errMsg(e: unknown, fallback = 'Something went wrong.'): string {
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === 'string' && e) return e;
  return fallback;
}
