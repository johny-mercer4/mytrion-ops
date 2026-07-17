/**
 * Agent Sales Dashboard data — mytrionAgentSalesDashboard via dashboard.agent_sales.
 * Keeps the full carrier/tx/activity payloads (no top-8 truncation) so filters match the widget.
 * 5-minute localStorage cache (self-service parity) so tab switches / refresh feel instant.
 */
import { callTouchpoint } from '@/api/touchpoints';
import { readDashCache, SALES_DASH_TTL_MS, writeDashCache } from './dashCache';
import { currentBillingCycle, n } from './dashFormat';

const CACHE_PREFIX = 'mytrion_msd';

export type CompanyStatus = 'active' | 'inactive' | 'stuck';
export type BarFilter = 'all' | 'active' | 'new' | 'unique';
export type ActivityRange = 'recent' | 'all';

export interface SalesCompanyRow {
  carrierId: string;
  name: string;
  activeCards: number;
  newCards: number;
  uniqueCards: number;
  status: CompanyStatus;
  daysSinceTx: number | null;
}

export interface SalesActivityPoint {
  date: string;
  label: string;
  transactions: number;
  activeCards: number;
  newCards: number;
  volume: number;
}

export interface SalesTxRow {
  carrierId: string;
  name: string;
  newCards: number;
  transactions: number;
  volume: number;
  discount: number;
  total: number;
}

export interface SalesDailyCarrierRow {
  date: string;
  carrierId: string;
  activeCards: number | null;
  newCards: number | null;
  uniqueCards: number | null;
  transactions: number;
  volume: number;
  discount: number;
  total: number;
  name: string;
}

export interface SalesDashRaw {
  cycle: { start: string; end: string };
  kpi: Record<string, number>;
  /** Display strings for ratio KPIs (widget shows API string as-is). */
  kpiText: Record<string, string>;
  companies: SalesCompanyRow[];
  activity: SalesActivityPoint[];
  transactions: SalesTxRow[];
  dailyByCarrier: SalesDailyCarrierRow[];
  /** When served from cache (or just written). */
  cachedAt?: string;
  fromCache?: boolean;
}

function resolveStatus(row: Record<string, unknown>): CompanyStatus {
  const raw = String(row.company_status ?? row.status ?? '').toLowerCase();
  if (raw === 'active' || raw === 'inactive' || raw === 'stuck') return raw;
  const days = row.days_since_tx == null || row.days_since_tx === '' ? null : n(row.days_since_tx);
  if (days == null) return 'stuck';
  if (days <= 7) return 'active';
  if (days <= 15) return 'inactive';
  return 'stuck';
}

function mapSalesDash(d: {
  cycle?: { start?: string; end?: string };
  kpi?: Record<string, unknown>;
  cardsByCompany?: Array<Record<string, unknown>>;
  dailyActivity?: Array<Record<string, unknown>>;
  cardActivity?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  dailyTransactionsByCarrier?: Array<Record<string, unknown>>;
}): SalesDashRaw {
  const kpiRaw = (d.kpi ?? {}) as Record<string, unknown>;
  const kpi: Record<string, number> = {};
  const kpiText: Record<string, string> = {};
  for (const [k, v] of Object.entries(kpiRaw)) {
    kpi[k] = n(v);
    kpiText[k] = v == null ? '' : String(v);
  }
  const cycle = d.cycle ?? {};
  const companies = (d.cardsByCompany ?? []).map((row) => ({
    carrierId: String(row.carrier_id ?? ''),
    name: String(row.carrier_name ?? row.carrier_id ?? '—'),
    activeCards: n(row.active_cards),
    newCards: n(row.new_cards),
    uniqueCards: n(row.unique_cards),
    status: resolveStatus(row),
    daysSinceTx: row.days_since_tx == null || row.days_since_tx === '' ? null : n(row.days_since_tx),
  }));
  const activity = ((d.cardActivity ?? d.dailyActivity ?? []) as Record<string, unknown>[]).map((b) => {
    const date = String(b.activity_month ?? '').slice(0, 10);
    return {
      date,
      label: String(b.month_label ?? date).slice(0, 12),
      transactions: n(b.transactions),
      activeCards: n(b.active_cards),
      newCards: n(b.new_cards),
      volume: n(b.volume),
    };
  });
  const transactions = (d.transactions ?? []).map((row) => ({
    carrierId: String(row.carrier_id ?? ''),
    name: String(row.carrier_name ?? '—'),
    newCards: n(row.new_cards),
    transactions: n(row.transactions),
    volume: n(row.volume),
    discount: n(row.discount),
    total: n(row.total),
  }));
  const dailyByCarrier = (d.dailyTransactionsByCarrier ?? []).map((r) => ({
    date: String(r.date ?? '').slice(0, 10),
    carrierId: String(r.carrier_id ?? ''),
    activeCards: r.active_cards == null ? null : n(r.active_cards),
    newCards: r.new_cards == null ? null : n(r.new_cards),
    uniqueCards: r.unique_cards == null ? null : n(r.unique_cards),
    transactions: n(r.transactions),
    volume: n(r.volume),
    discount: n(r.discount),
    total: n(r.total),
    name: String(r.carrier_name ?? r.carrier_id ?? '—'),
  }));
  return {
    cycle: { start: String(cycle.start ?? '—'), end: String(cycle.end ?? '—') },
    kpi,
    kpiText,
    companies,
    activity,
    transactions,
    dailyByCarrier,
  };
}

/** Load sales dash; serves ≤5min cache unless `force`. */
export async function loadSalesDashRaw(opts: { force?: boolean } = {}): Promise<SalesDashRaw> {
  if (!opts.force) {
    const hit = readDashCache<SalesDashRaw>(CACHE_PREFIX, SALES_DASH_TTL_MS);
    if (hit) {
      return { ...hit.data, cachedAt: hit.cachedAt.toISOString(), fromCache: true };
    }
  }
  const res = await callTouchpoint('dashboard.agent_sales', {});
  if (res.success === false) throw new Error(res.error || 'Sales dashboard failed to load');
  const mapped = mapSalesDash(res.data ?? {});
  const cachedAt = writeDashCache(CACHE_PREFIX, mapped);
  return { ...mapped, cachedAt: cachedAt.toISOString(), fromCache: false };
}

export function filterActivity(
  activity: SalesActivityPoint[],
  range: ActivityRange,
): SalesActivityPoint[] {
  const sorted = [...activity].sort((a, b) => a.date.localeCompare(b.date));
  if (range !== 'recent') return sorted;
  const { start, end } = currentBillingCycle();
  const isDaily = activity.length > 24;
  return sorted.filter((m) => {
    const d = new Date(`${m.date}T00:00:00`);
    if (Number.isNaN(d.getTime())) return false;
    if (isDaily) return d >= start && d <= end;
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    return monthStart <= end && monthEnd >= start;
  });
}

export interface BarRow extends SalesCompanyRow {
  displayValue: number;
}

export function filterCompanies(opts: {
  companies: SalesCompanyRow[];
  statusFilter: CompanyStatus | null;
  barFilter: BarFilter;
  companyQ: string;
  selectedDates: Set<string> | null;
  dailyByCarrier: SalesDailyCarrierRow[];
}): BarRow[] {
  const { statusFilter, barFilter, companyQ, selectedDates, dailyByCarrier } = opts;
  let list = [...opts.companies];
  if (statusFilter) list = list.filter((c) => c.status === statusFilter);
  const q = companyQ.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (c) => c.name.toLowerCase().includes(q) || c.carrierId.toLowerCase().includes(q),
    );
  }

  const dayMode = !!(selectedDates && selectedDates.size && dailyByCarrier.length);
  const has = { active: false, neu: false, unique: false };
  const daySum = new Map<string, { active: number; neu: number; unique: number }>();
  if (dayMode && selectedDates) {
    for (const r of dailyByCarrier) {
      if (!selectedDates.has(r.date)) continue;
      const cur = daySum.get(r.carrierId) ?? { active: 0, neu: 0, unique: 0 };
      if (r.activeCards != null) {
        cur.active += r.activeCards;
        has.active = true;
      }
      if (r.newCards != null) {
        cur.neu += r.newCards;
        has.neu = true;
      }
      if (r.uniqueCards != null) {
        cur.unique += r.uniqueCards;
        has.unique = true;
      }
      daySum.set(r.carrierId, cur);
    }
    list = list.filter((c) => daySum.has(c.carrierId));
  }

  const rows: BarRow[] = list.map((co) => {
    const d = dayMode ? daySum.get(co.carrierId) : null;
    const activeCards = d && has.active ? d.active : co.activeCards;
    const newCards = d && has.neu ? d.neu : co.newCards;
    const uniqueCards = d && has.unique ? d.unique : co.uniqueCards;
    const displayValue =
      barFilter === 'active' ? activeCards : barFilter === 'new' ? newCards : uniqueCards;
    return { ...co, activeCards, newCards, uniqueCards, displayValue };
  });
  rows.sort((a, b) => b.displayValue - a.displayValue);
  return rows;
}

export function filterTransactions(opts: {
  transactions: SalesTxRow[];
  txQ: string;
  selectedDates: Set<string> | null;
  dailyByCarrier: SalesDailyCarrierRow[];
}): SalesTxRow[] {
  const { txQ, selectedDates, dailyByCarrier } = opts;
  const q = txQ.trim().toLowerCase();
  if (selectedDates && selectedDates.size && dailyByCarrier.length) {
    const acc = new Map<string, SalesTxRow>();
    for (const r of dailyByCarrier) {
      if (!selectedDates.has(r.date)) continue;
      const prev = acc.get(r.carrierId) ?? {
        carrierId: r.carrierId,
        name: r.name,
        newCards: 0,
        transactions: 0,
        volume: 0,
        discount: 0,
        total: 0,
      };
      prev.newCards += r.newCards ?? 0;
      prev.transactions += r.transactions;
      prev.volume += r.volume;
      prev.discount += r.discount;
      prev.total += r.total;
      acc.set(r.carrierId, prev);
    }
    let rows = [...acc.values()];
    if (q) {
      rows = rows.filter(
        (r) => r.name.toLowerCase().includes(q) || r.carrierId.toLowerCase().includes(q),
      );
    }
    return rows.sort((a, b) => b.volume - a.volume);
  }
  let rows = opts.transactions;
  if (q) {
    rows = rows.filter(
      (r) => r.name.toLowerCase().includes(q) || r.carrierId.toLowerCase().includes(q),
    );
  }
  return rows;
}

export function cycleTotals(transactions: SalesTxRow[]): { volume: number; transactions: number } {
  return transactions.reduce(
    (acc, r) => ({
      volume: acc.volume + r.volume,
      transactions: acc.transactions + r.transactions,
    }),
    { volume: 0, transactions: 0 },
  );
}

export function txTotals(rows: SalesTxRow[]): SalesTxRow | null {
  if (!rows.length) return null;
  return rows.reduce(
    (acc, r) => ({
      carrierId: '',
      name: 'Total',
      newCards: acc.newCards + r.newCards,
      transactions: acc.transactions + r.transactions,
      volume: acc.volume + r.volume,
      discount: acc.discount + r.discount,
      total: acc.total + r.total,
    }),
    { carrierId: '', name: 'Total', newCards: 0, transactions: 0, volume: 0, discount: 0, total: 0 },
  );
}

export function statusColor(status: CompanyStatus): string {
  if (status === 'active') return 'var(--ok)';
  if (status === 'inactive') return 'var(--orange)';
  return 'var(--danger)';
}
