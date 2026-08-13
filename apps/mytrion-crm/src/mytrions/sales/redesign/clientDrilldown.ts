/**
 * Client modal drilldowns — cards from live EFS; fuel activity still from DWH marts
 * (all_time, Load-more via growing limit).
 */
import { callTouchpoint } from '@/api/touchpoints';
import { getClientCards, getClientBilling, type ClientBilling, type ClientCardDetail } from '@/api/dataCenter';
import { CARD_MASK_DIGITS } from './autoLive';

const n = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);
const galFmt = (v: unknown): string => n(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = (v: unknown): string => {
  const x = n(v);
  return x < 0
    ? `-$${Math.abs(x).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : `$${x.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
};
function relTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mins = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function cardDigits(raw: unknown): string {
  return String(raw ?? '').replace(/\D/g, '');
}

/** Last-6, the Sales-wide card standard (see `maskCard` in autoLive). */
function maskCard(raw: unknown): string {
  const digits = cardDigits(raw);
  return digits ? `•••• ${digits.slice(-CARD_MASK_DIGITS)}` : '—';
}

function statusTone(up: string): string {
  return up === 'ACTIVE' ? 'var(--ok)' : up === 'INACTIVE' ? 'var(--muted)' : 'var(--warn)';
}

function displayStatus(raw: unknown): string {
  const up = String(raw ?? '').trim().toUpperCase();
  return up || 'UNKNOWN';
}

/** Match a DWH card against an EFS digit key (exact, then last-6). */
function lookupDwhCard(
  dwhByDigits: Map<string, ClientCardDetail>,
  digits: string,
): ClientCardDetail | undefined {
  if (!digits) return undefined;
  const exact = dwhByDigits.get(digits);
  if (exact) return exact;
  if (digits.length < 6) return undefined;
  const tail = digits.slice(-6);
  for (const [key, card] of dwhByDigits) {
    if (key.length >= 6 && key.slice(-6) === tail) return card;
  }
  return undefined;
}

function strOrNull(raw: unknown): string | null {
  const v = String(raw ?? '').trim();
  return v || null;
}

function toVm(
  cardNumber: unknown,
  statusRaw: unknown,
  extras: Pick<ClientCardVM, 'cardType' | 'unit' | 'driverId' | 'driverName'>,
): ClientCardVM {
  const status = displayStatus(statusRaw);
  return {
    num: maskCard(cardNumber),
    status,
    tone: statusTone(status),
    ...extras,
  };
}

export interface ClientCardVM {
  num: string;
  status: string;
  tone: string;
  cardType: string | null;
  unit: string | null;
  driverId: string | null;
  driverName: string | null;
}

/**
 * Carrier cards for the Sales client modal — same ground truth as Automations / mini-app fleet.
 * Live EFS owns the roster + status/unit/driver (so C-1 / C-26 show immediately). DWH only
 * contributes `cardType` and is the fallback when EFS is down or returns no rows.
 */
export async function loadClientCards(carrierId: string): Promise<ClientCardVM[]> {
  if (!carrierId) return [];
  const [dwhResult, efsResult] = await Promise.allSettled([
    getClientCards(carrierId),
    callTouchpoint('efs.cards', { carrierId }),
  ]);
  if (dwhResult.status === 'rejected' && efsResult.status === 'rejected') {
    throw dwhResult.reason;
  }

  const dwhCards: ClientCardDetail[] = dwhResult.status === 'fulfilled' ? dwhResult.value : [];
  const efsRows: Array<Record<string, unknown>> = efsResult.status === 'fulfilled'
    ? ((efsResult.value.data ?? []) as Array<Record<string, unknown>>)
    : [];

  const dwhByDigits = new Map<string, ClientCardDetail>();
  for (const c of dwhCards) {
    const digits = cardDigits(c.cardNumber);
    if (digits) dwhByDigits.set(digits, c);
  }

  if (efsRows.length > 0) {
    return efsRows
      .map((row) => {
        const rawNum = row.card_number ?? row.cardNumber;
        const digits = cardDigits(rawNum);
        if (!digits) return null;
        const dwh = lookupDwhCard(dwhByDigits, digits);
        return toVm(rawNum, row.status, {
          cardType: dwh?.cardType ?? null,
          unit: strOrNull(row.unit_number ?? row.unitNumber) ?? dwh?.unit ?? null,
          driverId: strOrNull(row.driver_id ?? row.driverId) ?? dwh?.driverId ?? null,
          driverName: strOrNull(row.driver_name ?? row.driverName) ?? dwh?.driverName ?? null,
        });
      })
      .filter((row): row is ClientCardVM => row != null);
  }

  return dwhCards.map((c) => toVm(c.cardNumber, c.status, {
    cardType: c.cardType,
    unit: c.unit,
    driverId: c.driverId,
    driverName: c.driverName,
  }));
}

export type ClientBillingVM = ClientBilling;

/** A client's billing terms from octane.dim_company (billing cycle, payment terms/day, credit
 *  limit, minimum balance). Null when the carrier has no dim_company row. */
export async function loadClientBilling(carrierId: string): Promise<ClientBillingVM | null> {
  if (!carrierId) return null;
  return getClientBilling(carrierId);
}

/** Live EFS available balance for the client modal Overview tile (same source as C-8). */
export interface ClientEfsBalanceVM {
  /** Formatted `$…` for display, or `—` when the amount is missing. */
  display: string;
  paymentTerms: string | null;
  /** Soft upstream note when EFS itself errored but a fallback figure may still exist. */
  efsError: string | null;
}

export async function loadClientEfsBalance(carrierId: string): Promise<ClientEfsBalanceVM> {
  if (!carrierId) {
    return { display: '—', paymentTerms: null, efsError: null };
  }
  const bal = await callTouchpoint('dwh.carrier_balance', { carrierId });
  const raw = bal.efs_balance ?? bal.balance;
  const amount = raw != null && String(raw).trim() !== '' && Number.isFinite(Number(raw))
    ? Number(raw)
    : null;
  const terms = bal.payment_terms != null && String(bal.payment_terms).trim()
    ? String(bal.payment_terms).trim()
    : null;
  const efsError = bal.efs_error != null && String(bal.efs_error).trim()
    ? String(bal.efs_error).trim()
    : null;
  return {
    display: amount == null ? '—' : money(amount),
    paymentTerms: terms,
    efsError,
  };
}

export interface ClientActivityVM {
  title: string;
  sub: string;
  tone: string;
}

export interface ClientActivityPage {
  rows: ClientActivityVM[];
  /** True when servercrm reports more_records (or we filled the requested page). */
  hasMore: boolean;
  limit: number;
}

export const CLIENT_ACTIVITY_PAGE = 20;

function mapActivityRow(r: Record<string, unknown>): ClientActivityVM {
  const gal = n(r.line_item_fuel_quantity ?? r.fuel_quantity);
  const amt = r.line_item_amount ?? r.amount;
  const card = maskCard(r.card_number);
  const loc = String(r.location_name ?? r.merchant_name ?? r.location ?? '').trim();
  const date = r.transaction_date ? relTime(String(r.transaction_date)) : '';
  const title = gal > 0 ? `${galFmt(gal)} gal fueled` : 'Fuel transaction';
  const sub = [date, amt != null ? money(amt) : '', card !== '—' ? `Card ${card}` : '', loc]
    .filter(Boolean)
    .join(' · ');
  return { title, sub, tone: 'var(--violet)' };
}

/**
 * Carrier fuel-card activity (DWH line items). Uses `all_time` so Load more can surface older
 * transactions; each call re-fetches with a larger `limit` (servercrm has no offset).
 */
export async function loadClientActivity(
  carrierId: string,
  limit = CLIENT_ACTIVITY_PAGE,
): Promise<ClientActivityPage> {
  if (!carrierId) return { rows: [], hasMore: false, limit: CLIENT_ACTIVITY_PAGE };
  const capped = Math.min(Math.max(limit, 1), 5000);
  const res = await callTouchpoint('dwh.transactions', {
    carrierId,
    range: 'all_time',
    limit: capped,
  });
  const raw = (res.data ?? []) as Array<Record<string, unknown>>;
  const pg = (res.pagination ?? {}) as Record<string, unknown>;
  const hasMore =
    pg.more_records === true ||
    pg.has_more === true ||
    raw.length >= capped;
  return {
    rows: raw.map(mapActivityRow),
    hasMore,
    limit: capped,
  };
}
