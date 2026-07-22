/**
 * Client modal drilldowns — DWH cards + fuel activity (all_time, Load-more via growing limit).
 */
import { callTouchpoint } from '@/api/touchpoints';
import { getClientCards, getClientBilling, type ClientBilling } from '@/api/dataCenter';

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

function maskCard(raw: unknown): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  return digits ? `•••• ${digits.slice(-4)}` : '—';
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

/** A carrier's cards from the DWH (octane.dim_card): masked number + Active/Inactive/Unknown status
 *  + card type, and the unit / driver id / driver name from each card's latest transaction. */
export async function loadClientCards(carrierId: string): Promise<ClientCardVM[]> {
  if (!carrierId) return [];
  const cards = await getClientCards(carrierId);
  return cards.map((c) => {
    const up = String(c.status ?? '').trim().toUpperCase();
    const tone = up === 'ACTIVE' ? 'var(--ok)' : up === 'INACTIVE' ? 'var(--muted)' : 'var(--warn)';
    return {
      num: maskCard(c.cardNumber),
      status: up || 'UNKNOWN',
      tone,
      cardType: c.cardType,
      unit: c.unit,
      driverId: c.driverId,
      driverName: c.driverName,
    };
  });
}

export type ClientBillingVM = ClientBilling;

/** A client's billing terms from octane.dim_company (billing cycle, payment terms/day, credit
 *  limit, minimum balance). Null when the carrier has no dim_company row. */
export async function loadClientBilling(carrierId: string): Promise<ClientBillingVM | null> {
  if (!carrierId) return null;
  return getClientBilling(carrierId);
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
