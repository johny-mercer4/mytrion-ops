/**
 * Company Dashboard — mytrioncompanydashboard via dashboard.company.
 * Targets are client-side defaults matching the self-service widget.
 */
import { callTouchpoint } from '@/api/touchpoints';
import { COMPANY_DASH_TTL_MS, readDashCache, writeDashCache } from './dashCache';
import { n } from './dashFormat';

const CACHE_PREFIX = 'mytrion_cdb';

export const COMPANY_TARGETS = {
  fills_today: 15,
  fills_this_week: 105,
  fills_this_month: 450,
  gallons_today: null as number | null,
  gallons_this_week: null as number | null,
  gallons_this_month: 6_700_000,
};

export interface CompanyDashRaw {
  asOf: string;
  weekStart: string;
  fillsToday: number;
  fillsWeek: number;
  fillsMonth: number;
  gallonsToday: number;
  gallonsWeek: number;
  gallonsMonth: number;
  cachedAt?: string;
  fromCache?: boolean;
}

export async function loadCompanyDashRaw(opts: { force?: boolean } = {}): Promise<CompanyDashRaw> {
  if (!opts.force) {
    const hit = readDashCache<CompanyDashRaw>(CACHE_PREFIX, COMPANY_DASH_TTL_MS);
    if (hit) return { ...hit.data, cachedAt: hit.cachedAt.toISOString(), fromCache: true };
  }
  const res = await callTouchpoint('dashboard.company', {});
  if (res.status && res.status !== 'success') {
    throw new Error('Company dashboard failed to load');
  }
  const d = res.data ?? {};
  const mapped: CompanyDashRaw = {
    asOf: String(d.as_of ?? ''),
    weekStart: String(d.week_start ?? ''),
    fillsToday: n(d.fills_today),
    fillsWeek: n(d.fills_this_week),
    fillsMonth: n(d.fills_this_month),
    gallonsToday: n(d.gallons_today),
    gallonsWeek: n(d.gallons_this_week),
    gallonsMonth: n(d.gallons_this_month),
  };
  const cachedAt = writeDashCache(CACHE_PREFIX, mapped);
  return { ...mapped, cachedAt: cachedAt.toISOString(), fromCache: false };
}

const ARC = Math.PI * 42;

export function gaugeDash(value: number, target: number | null): string {
  if (target == null) return `0 ${ARC.toFixed(2)}`;
  const pct = target > 0 ? Math.min(value / target, 1) : 0;
  return `${(pct * ARC).toFixed(2)} ${ARC.toFixed(2)}`;
}

export function gaugePct(value: number, target: number | null): number | null {
  if (target == null) return null;
  return target > 0 ? (value / target) * 100 : 0;
}
