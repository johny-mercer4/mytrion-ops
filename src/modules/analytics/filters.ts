/**
 * Query filters for live analytics snapshots — agent book + date window.
 * Values become parameterized DWH binds (never string-concatenated into SQL).
 */
import { buildOwnedCte, ownerBinds, zohoIdSuffix } from '../../integrations/dwhClientRoster.js';

export const ANALYTICS_DATE_RANGES = ['today', 'last_7_days', 'this_week', 'this_month', 'custom'] as const;
export type AnalyticsDateRange = (typeof ANALYTICS_DATE_RANGES)[number];

export interface AnalyticsFilters {
  /** Zoho user id (session or warehouse — matched on last 12 digits). */
  agentId?: string | null;
  /** Display name fallback when id is missing / unmatched. */
  agentName?: string | null;
  range?: AnalyticsDateRange;
  /** YYYY-MM-DD — used when range=custom. */
  from?: string | null;
  to?: string | null;
}

/** Mutable $1..$n binder for building parameterized SQL fragments. */
export class SqlParams {
  private readonly vals: unknown[] = [];

  add(value: unknown): string {
    this.vals.push(value);
    return `$${this.vals.length}`;
  }

  get values(): readonly unknown[] {
    return this.vals;
  }
}

export function normalizeFilters(raw?: AnalyticsFilters | null): AnalyticsFilters {
  const range = raw?.range && (ANALYTICS_DATE_RANGES as readonly string[]).includes(raw.range)
    ? raw.range
    : 'this_month';
  return {
    agentId: raw?.agentId?.trim() || null,
    agentName: raw?.agentName?.trim() || null,
    range,
    from: raw?.from?.trim() || null,
    to: raw?.to?.trim() || null,
  };
}

/** True when the request is not the default org-wide MTD snapshot. */
export function hasAnalyticsFilters(raw?: AnalyticsFilters | null): boolean {
  const f = normalizeFilters(raw);
  return Boolean(
    f.agentId ||
      f.agentName ||
      f.range !== 'this_month' ||
      f.from ||
      f.to,
  );
}

export function filterCaption(filters: AnalyticsFilters): string {
  const f = normalizeFilters(filters);
  const bits: string[] = [];
  if (f.agentName) bits.push(`agent: ${f.agentName}`);
  else if (f.agentId) bits.push(`agent: ${f.agentId}`);
  if (f.range === 'custom') {
    bits.push(`${f.from ?? '…'} → ${f.to ?? '…'}`);
  }   else if (f.range === 'today') bits.push('today');
  else if (f.range === 'last_7_days') bits.push('last 7 days');
  else if (f.range === 'this_week') bits.push('this week');
  else bits.push('this month');
  return bits.join(' · ');
}

/**
 * Date predicates for a timestamp/date column.
 * `current` = selected window; `previous` = prior equivalent window (for KPI deltas);
 * trend bounds drive generate_series.
 */
export function dateScope(
  col: string,
  filters: AnalyticsFilters,
  p: SqlParams,
): {
  current: string;
  previous: string;
  /** SQL expression for generate_series start (date). */
  trendStart: string;
  /** SQL expression for generate_series end (date). */
  trendEnd: string;
} {
  const f = normalizeFilters(filters);
  switch (f.range) {
    case 'today':
      return {
        current: `${col}::date = current_date`,
        previous: `${col}::date = current_date - interval '1 day'`,
        // Trend matches the KPI window (one day) so a quiet day doesn't show older bars.
        trendStart: `current_date`,
        trendEnd: `current_date`,
      };
    case 'last_7_days':
      return {
        current: `${col}::date >= current_date - interval '6 days' and ${col}::date <= current_date`,
        previous: `${col}::date >= current_date - interval '13 days' and ${col}::date < current_date - interval '6 days'`,
        trendStart: `current_date - interval '6 days'`,
        trendEnd: `current_date`,
      };
    case 'this_week':
      return {
        current: `date_trunc('week', ${col}) = date_trunc('week', current_date) and ${col}::date <= current_date`,
        previous: `date_trunc('week', ${col}) = date_trunc('week', current_date - interval '1 week')`,
        trendStart: `date_trunc('week', current_date)::date`,
        trendEnd: `current_date`,
      };
    case 'custom': {
      const from = f.from ?? new Date().toISOString().slice(0, 10);
      const to = f.to ?? from;
      const fromPh = p.add(from);
      const toPh = p.add(to);
      // Previous window of the same length ending the day before `from`.
      return {
        current: `${col}::date >= ${fromPh}::date and ${col}::date <= ${toPh}::date`,
        previous: `${col}::date >= (${fromPh}::date - (${toPh}::date - ${fromPh}::date + 1)) and ${col}::date < ${fromPh}::date`,
        trendStart: `${fromPh}::date`,
        trendEnd: `${toPh}::date`,
      };
    }
    case 'this_month':
    default:
      return {
        current: `date_trunc('month', ${col}) = date_trunc('month', current_date) and ${col}::date <= current_date`,
        previous: `date_trunc('month', ${col}) = date_trunc('month', current_date - interval '1 month')`,
        // Keep the familiar last-14-days sparkline for the default month view.
        trendStart: `current_date - interval '13 days'`,
        trendEnd: `current_date`,
      };
  }
}

/**
 * Pipeline / zoho_deals owner filter against a `zoho_users` alias.
 * Id-suffix wins when present; otherwise exact case-insensitive name.
 */
export function pipelineOwnerPred(zuAlias: string, filters: AnalyticsFilters, p: SqlParams): string {
  const f = normalizeFilters(filters);
  const suffix = f.agentId ? zohoIdSuffix(f.agentId) : '';
  if (suffix) {
    const ph = p.add(suffix);
    return `lpad(right(${zuAlias}.id::text, 12), 12, '0') = lpad(${ph}, 12, '0')`;
  }
  if (f.agentName) {
    const ph = p.add(f.agentName);
    return `lower(${zuAlias}.full_name) = lower(${ph})`;
  }
  return '';
}

/**
 * Carrier ownership CTE (dim_company id-suffix-first, name fallback) with the join written against
 * an arbitrary table alias — transactions use `t`, billing `bh`, receivables `i`.
 * Returns empty strings when no agent filter — callers join only when `cte` is non-empty.
 */
export function ownedCarrierCteFor(
  alias: string,
  filters: AnalyticsFilters,
  p: SqlParams,
  cols = 'carrier_id, agent, agent_zoho_user_id',
): { cte: string; joinOn: string } {
  const f = normalizeFilters(filters);
  if (!f.agentId && !f.agentName) return { cte: '', joinOn: '' };

  const { binds, idBindIdx, nameBindIdx } = ownerBinds(f.agentId ?? '', f.agentName ?? undefined);
  if (idBindIdx === null && nameBindIdx === null) return { cte: '', joinOn: '' };

  // Remap ownerBinds' 1-based indices into this SqlParams sequence.
  const remap = new Map<number, number>();
  for (let i = 0; i < binds.length; i++) {
    p.add(binds[i]);
    remap.set(i + 1, p.values.length);
  }
  const mappedId = idBindIdx !== null ? (remap.get(idBindIdx) ?? null) : null;
  const mappedName = nameBindIdx !== null ? (remap.get(nameBindIdx) ?? null) : null;
  return {
    cte: buildOwnedCte(mappedId, mappedName, cols),
    joinOn: `join owned o on o.carrier_id = ${alias}.carrier_id`,
  };
}

/** Ownership CTE joined on the transactions mart alias (`t.carrier_id`). */
export function ownedCarrierCte(
  filters: AnalyticsFilters,
  p: SqlParams,
  cols = 'carrier_id, agent, agent_zoho_user_id',
): { cte: string; joinOn: string } {
  return ownedCarrierCteFor('t', filters, p, cols);
}

/** Same ownership CTE, join alias for billing (`bh.carrier_id`). */
export function ownedCarrierCteBilling(
  filters: AnalyticsFilters,
  p: SqlParams,
): { cte: string; joinOn: string } {
  return ownedCarrierCteFor('bh', filters, p);
}

export { zohoIdSuffix };
