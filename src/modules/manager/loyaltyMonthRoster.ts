/**
 * Marketing Mytrion → Loyalty Program → Export: the month-anchored roster read model.
 *
 * Sits between the month-anchored DWH query (integrations/dwhLoyaltyMonth.ts) and the export route.
 * Its job is the three things the SQL deliberately does not do:
 *
 *  1. RESOLVE THE MONTH. The caller picks a month; this decides which month that actually is, and
 *     refuses a future one. Everything downstream — the basis month, the labels, the filename — is
 *     derived from the single normalized value here, so the file can never be titled July while
 *     holding June's windows.
 *  2. DECIDE WHETHER A STORED TIER APPLIES. `dim_company.tier_name` is the tier a carrier holds
 *     *now*. For the CURRENT month that is the same retained value the board shows through a dormant
 *     month, so it is forwarded and the export matches the board row for row. For any PAST month it
 *     is an anachronism — a carrier that is Gold today was not necessarily Gold in March — so it is
 *     withheld and a dormant carrier exports as not-evaluated. This is the one place that judgement
 *     is made.
 *  3. ATTACH THE MANUAL EXCEPTIONS. `loyalty_client_overrides` has no history either, so a
 *     historical export applies the exception AS CONFIGURED TODAY and ships `updatedAt` alongside it.
 *     A reader comparing that timestamp to the exported month can see for themselves whether the
 *     exception was even in force yet. Silently applying it with no timestamp is what would make the
 *     number unauditable.
 *
 * Tier resolution itself is NOT here, for the same reason `loyaltyRoster.ts` says it is not there:
 * the thresholds live once, in the client's `mytrions/_shared/loyalty.ts`, which Sales and the board
 * already use. A second copy on the server is how two surfaces come to disagree about a tier.
 */
import { ValidationError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  fetchLoyaltyClientsForMonth,
  type LoyaltyMonthClientRow,
} from '../../integrations/dwhLoyaltyMonth.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { loyaltyOverrides, type LoyaltyOverrideView } from './loyaltyOverrides.js';

/**
 * How far back an export may reach. Not a warehouse limit — a deliberate one: beyond three years the
 * mart's fuel-category coding predates the current ULSR/ULSD convention, so the in-network gallons
 * would be measured with a different ruler than the tier thresholds were written against.
 */
export const LOYALTY_EXPORT_MAX_MONTHS_BACK = 36;

/** One exported carrier: the month-anchored metrics plus the manual exception in force. */
export interface LoyaltyMonthClient extends LoyaltyMonthClientRow {
  /**
   * The retained warehouse tier, forwarded ONLY for a current-month export (see the file header).
   * Empty string for every past month — a dormant carrier then has no tier to retain.
   */
  retainedTierName: string;
  /** Manager exception as configured NOW; `updatedAt` on it says when that became true. */
  loyaltyOverride: LoyaltyOverrideView | null;
}

/** Both months an export is about, resolved once and carried everywhere. */
export interface LoyaltyExportPeriod {
  /** The reported month, `YYYY-MM-01`. */
  month: string;
  /** The month that earns the tier — always one month before `month`. */
  basisMonth: string;
  /** e.g. "July 2026". */
  monthLabel: string;
  /** e.g. "June 2026". */
  basisMonthLabel: string;
  /** The 26th→25th billing cycle that closes inside `month`, e.g. "26 Jun – 25 Jul 2026". */
  cycleLabel: string;
  /** False when `month` is the month in progress, so its activity figures are partial. */
  monthComplete: boolean;
}

export interface LoyaltyMonthRosterResult extends LoyaltyExportPeriod {
  clients: LoyaltyMonthClient[];
  total: number;
  fetchedAt: string;
}

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const SHORT_MONTHS = MONTH_LABELS.map((m) => m.slice(0, 3));

/** `YYYY-MM-01` for a UTC year/month pair. Month index may be out of range; Date normalizes it. */
function monthIso(year: number, monthIndex: number): string {
  const d = new Date(Date.UTC(year, monthIndex, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function monthLabel(iso: string): string {
  const [y, m] = iso.split('-');
  return `${MONTH_LABELS[Number(m) - 1] ?? m} ${y}`;
}

/**
 * "26 Jun – 25 Jul 2026" for the cycle closing in `iso`'s month — the same 26th→25th period
 * `lib/salesCycle.ts` defines, stated for a chosen month instead of for today.
 */
function cycleLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  const start = new Date(Date.UTC(y as number, (m as number) - 2, 26));
  const end = new Date(Date.UTC(y as number, (m as number) - 1, 25));
  return (
    `${start.getUTCDate()} ${SHORT_MONTHS[start.getUTCMonth()]} – ` +
    `${end.getUTCDate()} ${SHORT_MONTHS[end.getUTCMonth()]} ${end.getUTCFullYear()}`
  );
}

/**
 * Normalize + bounds-check a requested month against `today`, and derive everything that follows.
 *
 * Rejects rather than clamps. A silently clamped month is the worst outcome available here: the
 * caller asked for one period, the spreadsheet is titled with another, and nobody notices until a
 * bonus is paid off it.
 */
export function resolveLoyaltyExportPeriod(
  requestedMonth: string,
  today: Date = new Date(),
): LoyaltyExportPeriod {
  const match = /^(\d{4})-(\d{2})-01$/.exec(requestedMonth.trim());
  if (!match) {
    throw new ValidationError(
      `Export month must be the first of a month as YYYY-MM-01 (received '${requestedMonth}').`,
    );
  }
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new ValidationError(`'${requestedMonth}' is not a real month.`);
  }
  const month = monthIso(year, monthIndex);
  const currentMonth = monthIso(today.getUTCFullYear(), today.getUTCMonth());
  if (month > currentMonth) {
    throw new ValidationError(
      `${monthLabel(month)} has not started yet — the latest month available is ${monthLabel(currentMonth)}.`,
    );
  }
  const earliest = monthIso(today.getUTCFullYear(), today.getUTCMonth() - LOYALTY_EXPORT_MAX_MONTHS_BACK);
  if (month < earliest) {
    throw new ValidationError(
      `${monthLabel(month)} is beyond the ${LOYALTY_EXPORT_MAX_MONTHS_BACK}-month export window (earliest is ${monthLabel(earliest)}).`,
    );
  }
  const basisMonth = monthIso(year, monthIndex - 1);
  return {
    month,
    basisMonth,
    monthLabel: monthLabel(month),
    basisMonthLabel: monthLabel(basisMonth),
    cycleLabel: cycleLabel(month),
    monthComplete: month < currentMonth,
  };
}

interface CacheEntry {
  result: LoyaltyMonthRosterResult;
  expiresAt: number;
}
/**
 * A month's roster is a two-month mart scan across every carrier, and the export UI reads it once to
 * preview and again per format. Cached per (tenant, month) for two minutes so Excel-then-CSV is one
 * warehouse read. Keyed by tenant because the override overlay is tenant-scoped.
 */
const CACHE_TTL_MS = 2 * 60_000;
const CACHE_MAX = 24;
const cache = new Map<string, CacheEntry>();

/** Test hook — drop every cached month. */
export function clearLoyaltyMonthRosterCache(): void {
  cache.clear();
}

/**
 * Every carrier measured against `requestedMonth`, with the exception overlay attached.
 *
 * `force` bypasses the snapshot for an explicit Refresh. Override storage failing degrades to the
 * automatic program (as on the board) rather than blanking the export — the warehouse figures are
 * the export's substance and a pending migration must not withhold them.
 */
export async function fetchLoyaltyMonthRoster(
  ctx: TenantContext,
  requestedMonth: string,
  options: { force?: boolean; today?: Date } = {},
): Promise<LoyaltyMonthRosterResult> {
  const period = resolveLoyaltyExportPeriod(requestedMonth, options.today ?? new Date());
  const key = `${ctx.tenantId}:${period.month}`;
  const cached = cache.get(key);
  if (!options.force && cached && cached.expiresAt > Date.now()) return cached.result;

  const [rows, overrides] = await Promise.all([
    fetchLoyaltyClientsForMonth(period.month),
    loyaltyOverrides(ctx),
  ]);
  const clients: LoyaltyMonthClient[] = rows.map((row) => ({
    ...row,
    // The judgement documented in the file header: a stored tier is only true of the current month.
    retainedTierName: period.monthComplete ? '' : row.currentStoredTierName,
    loyaltyOverride: overrides.get(row.carrierId) ?? null,
  }));
  const result: LoyaltyMonthRosterResult = {
    ...period,
    clients,
    total: clients.length,
    fetchedAt: new Date().toISOString(),
  };

  if (cache.has(key)) cache.delete(key);
  cache.set(key, { result, expiresAt: Date.now() + CACHE_TTL_MS });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value as string | undefined;
    if (!oldest) break;
    cache.delete(oldest);
  }
  logger.debug(
    { month: period.month, carriers: clients.length, tenantId: ctx.tenantId },
    'loyalty month roster built',
  );
  return result;
}
