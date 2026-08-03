/**
 * Standing report runner — parameterized, date-bounded SQL over the read-only DWH.
 *
 * Every report is scoped by the SAME `AnalyticsFilters` the dashboards use (date window + agent),
 * so a report and the dashboard above it cannot disagree about a period. Agent scoping goes through
 * `ownedCarrierCteFor` (dim_company ownership) — the one owner authority — except `pipeline`, which
 * is deal-shaped and uses `pipelineOwnerPred` on `zoho_users` like the pipeline dimension does.
 *
 * `mart_sales_dashboard_card_base` is 1.27M rows: an unfiltered scan is ~3.5s, so every query here
 * stays inside the date window. Rows are capped (`ROW_CAP`) — an export is not a bulk extract, and
 * an uncapped group-by on a bad filter would pin the tiny shared pool.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import {
  dateScope,
  normalizeFilters,
  ownedCarrierCteFor,
  pipelineOwnerPred,
  SqlParams,
  type AnalyticsFilters,
} from '../filters.js';
import { withCte } from '../shared.js';
import { REPORTS, type ReportColumn, type ReportId } from './definitions.js';

/** Hard row ceiling per report — reported back so the UI can say the sheet was truncated. */
const ROW_CAP = 5000;

export interface ReportResult {
  reportId: ReportId;
  title: string;
  sheet: string;
  generatedAt: string;
  columns: ReportColumn[];
  rows: Array<Record<string, string | number | null>>;
  /** True when ROW_CAP clipped the result — never let a partial sheet look complete. */
  truncated: boolean;
}

const MART = 'octane.mart_sales_dashboard_card_base';
/** Still-owed balance, floored at zero so an overpaid invoice cannot net off another. */
const DUE = 'greatest(i.total_amount - coalesce(i.total_paid, 0), 0)';
const OPEN_INVOICE = `i.status in ('PENDING', 'PARTIALLY_PAID') and ${DUE} >= 1`;

const AGE_BUCKET = `case
    when max(i.due_date)::date >= current_date then 'Current'
    when max(i.due_date)::date >= current_date - 7  then '1-7 days'
    when max(i.due_date)::date >= current_date - 30 then '8-30 days'
    when max(i.due_date)::date >= current_date - 60 then '31-60 days'
    else '60+ days'
  end`;

type Row = Record<string, string | number | null>;

function buildFuelVolume(f: AnalyticsFilters): { sql: string; params: readonly unknown[] } {
  const p = new SqlParams();
  const scope = dateScope('m.transaction_day', f, p);
  const owned = ownedCarrierCteFor('m', f, p);
  return {
    sql: withCte(
      owned.cte,
      `select coalesce(nullif(trim(m.company_name), ''), '(unnamed)') as company_name,
              coalesce(m.agent, 'Unassigned') as agent,
              count(distinct m.transaction_id) as transactions,
              count(distinct m.card_number)    as cards,
              round(sum(m.fuel_quantity), 2)   as gallons,
              round(sum(m.line_item_amount), 2) as spend,
              round(sum(m.disc_amount), 2)     as discount,
              case when sum(m.fuel_quantity) > 0
                   then round(sum(m.line_item_amount) / sum(m.fuel_quantity), 3) end as avg_price
       from ${MART} m
       ${owned.joinOn}
       where ${scope.current}
       group by 1, 2
       order by gallons desc nulls last
       limit ${ROW_CAP + 1}`,
    ),
    params: p.values,
  };
}

function buildReceivables(f: AnalyticsFilters): { sql: string; params: readonly unknown[] } {
  const p = new SqlParams();
  const scope = dateScope('i.invoice_date', f, p);
  const owned = ownedCarrierCteFor('i', f, p);
  return {
    sql: withCte(
      owned.cte,
      `select coalesce(nullif(trim(i.company_name), ''), '(unnamed)') as company_name,
              coalesce(i.billing_cycle, '—') as billing_cycle,
              count(*)                                as invoices,
              round(sum(i.total_amount), 2)           as invoiced,
              round(sum(coalesce(i.total_paid, 0)), 2) as paid,
              round(sum(${DUE}), 2)                   as outstanding,
              -- coalesce: a FILTER with no matching rows yields NULL, which would land as a blank
              -- cell in the sheet where the honest answer is zero overdue.
              round(coalesce(sum(${DUE}) filter (where i.due_date::date < current_date), 0), 2) as overdue,
              greatest(max((current_date - i.due_date::date))::int, 0) as oldest_days,
              ${AGE_BUCKET} as bucket
       from public.cmp_invoice i
       ${owned.joinOn}
       where ${OPEN_INVOICE} and ${scope.current}
       group by 1, 2
       order by outstanding desc nulls last
       limit ${ROW_CAP + 1}`,
    ),
    params: p.values,
  };
}

function buildPipeline(f: AnalyticsFilters): { sql: string; params: readonly unknown[] } {
  const p = new SqlParams();
  const scope = dateScope('coalesce(zd.application_date, zd.created_time)', f, p);
  const owner = pipelineOwnerPred('zu', f, p);
  const whereOwner = owner ? `and ${owner}` : '';
  // Stage order mirrors the pipeline dimension so the funnel means the same thing in both places.
  const reached = (from: number) => `count(*) filter (where case zd.stage
      when 'Application Sent' then 1 when 'Application Filled' then 2 when 'CS Validation' then 3
      when 'Billing Form Sent' then 4 when 'Billing Form Filled' then 5 when 'EFS Processing' then 6
      when 'Vendor Validation' then 7 when 'Cards Sent' then 8 when 'Cards Activated' then 9
      when 'Card Funded' then 10 when 'Card Swiped' then 11 else 99 end between ${from} and 11)`;
  return {
    sql: `select coalesce(zu.full_name, 'Unassigned') as agent,
                 count(*) as deals,
                 ${reached(2)}  as app_filled,
                 ${reached(8)}  as cards_sent,
                 ${reached(11)} as card_swiped,
                 case when count(*) > 0 then round(${reached(8)}::numeric  / count(*), 4) end as to_cards_pct,
                 case when count(*) > 0 then round(${reached(11)}::numeric / count(*), 4) end as to_swipe_pct
          from public.zoho_deals zd
          left join (select distinct id, full_name from zoho_users) zu on zd.owner = zu.id
          where ${scope.current}
            ${whereOwner}
          group by 1
          order by deals desc
          limit ${ROW_CAP + 1}`,
    params: p.values,
  };
}

function buildAgentPerf(f: AnalyticsFilters): { sql: string; params: readonly unknown[] } {
  const p = new SqlParams();
  const scope = dateScope('m.transaction_day', f, p);
  const newScope = dateScope('m.first_transaction_date', f, p);
  const owned = ownedCarrierCteFor('m', f, p);
  // Book size + debt are point-in-time from the dim; volume is the window. Both keyed on agent.
  return {
    sql: withCte(
      owned.cte,
      `with activity as (
         select coalesce(m.agent, 'Unassigned') as agent,
                count(distinct m.carrier_id)  as companies,
                count(distinct m.card_number) as cards,
                count(distinct m.card_number) filter (where ${newScope.current}) as new_cards,
                round(sum(m.fuel_quantity), 2)    as gallons,
                round(sum(m.line_item_amount), 2) as revenue
         from ${MART} m
         ${owned.joinOn}
         where ${scope.current}
         group by 1
       ),
       book as (
         select coalesce(c.agent, 'Unassigned') as agent,
                count(distinct c.carrier_id) as book_size,
                round(sum(coalesce(c.debt_amount, 0)), 2) as debt
         from octane.dim_company c
         where c.carrier_id is not null
         group by 1
       )
       select a.agent, a.companies, a.cards, a.new_cards, a.gallons, a.revenue,
              coalesce(b.book_size, 0) as book_size, coalesce(b.debt, 0) as debt
       from activity a
       left join book b on lower(b.agent) = lower(a.agent)
       order by a.gallons desc nulls last
       limit ${ROW_CAP + 1}`,
    ),
    params: p.values,
  };
}

function buildBillingRecon(f: AnalyticsFilters): { sql: string; params: readonly unknown[] } {
  const p = new SqlParams();
  const scope = dateScope('i.invoice_date', f, p);
  const owned = ownedCarrierCteFor('i', f, p);
  // Payments are joined per invoice, so aggregate them first — joining rows would multiply invoiced.
  return {
    sql: withCte(
      owned.cte,
      `with pay as (
         select p.invoice_id,
                sum(p.amount) filter (where coalesce(p.is_failed, false) = false) as collected,
                count(*)      filter (where coalesce(p.is_failed, false) = false) as payments,
                count(*)      filter (where p.is_failed) as failed_payments
         from public.cmp_invoice_payment p
         group by 1
       )
       select coalesce(nullif(trim(i.company_name), ''), '(unnamed)') as company_name,
              coalesce(i.billing_cycle, '—') as billing_cycle,
              count(*) as invoices,
              round(sum(i.total_amount), 2) as invoiced,
              round(sum(coalesce(pay.collected, 0)), 2) as collected,
              round(sum(i.total_amount) - sum(coalesce(pay.collected, 0)), 2) as gap,
              coalesce(sum(pay.payments), 0)::int as payments,
              coalesce(sum(pay.failed_payments), 0)::int as failed_payments
       from public.cmp_invoice i
       left join pay on pay.invoice_id = i.id
       ${owned.joinOn}
       where i.status <> 'CANCELLED' and ${scope.current}
       group by 1, 2
       order by gap desc nulls last
       limit ${ROW_CAP + 1}`,
    ),
    params: p.values,
  };
}

function buildClientHealth(f: AnalyticsFilters): { sql: string; params: readonly unknown[] } {
  const p = new SqlParams();
  const scope = dateScope('m.transaction_day', f, p);
  const owned = ownedCarrierCteFor('m', f, p);
  return {
    sql: withCte(
      owned.cte,
      `with activity as (
         select m.carrier_id,
                round(sum(m.fuel_quantity), 2)    as gallons,
                round(sum(m.line_item_amount), 2) as spend
         from ${MART} m
         ${owned.joinOn}
         where ${scope.current}
         group by 1
       ),
       latest as (
         select distinct on (c.carrier_id)
                c.carrier_id, c.company_name, c.agent, c.tier_name, c.trucks,
                c.total_active_cards, c.debt_amount, c.max_debt_days, c.last_transaction_date
         from octane.dim_company c
         where c.carrier_id is not null
         order by c.carrier_id, c.update_date desc nulls last
       )
       select coalesce(nullif(trim(l.company_name), ''), '(unnamed)') as company_name,
              coalesce(l.agent, 'Unassigned') as agent,
              coalesce(l.tier_name, '—')      as tier_name,
              coalesce(l.trucks, 0)::int              as trucks,
              coalesce(l.total_active_cards, 0)::int  as active_cards,
              a.gallons, a.spend,
              round(coalesce(l.debt_amount, 0), 2) as debt,
              coalesce(l.max_debt_days, 0)::int    as debt_days,
              to_char(l.last_transaction_date, 'YYYY-MM-DD') as last_transaction
       from activity a
       join latest l on l.carrier_id = a.carrier_id
       order by a.gallons desc nulls last
       limit ${ROW_CAP + 1}`,
    ),
    params: p.values,
  };
}

const BUILDERS: Record<ReportId, (f: AnalyticsFilters) => { sql: string; params: readonly unknown[] }> = {
  'fuel-volume': buildFuelVolume,
  receivables: buildReceivables,
  pipeline: buildPipeline,
  'agent-perf': buildAgentPerf,
  'billing-recon': buildBillingRecon,
  'client-health': buildClientHealth,
};

/** pg returns numerics as strings — coerce declared numeric columns so Excel gets real numbers. */
function coerce(rows: Row[], columns: ReportColumn[]): Row[] {
  const numeric = new Set(
    columns.filter((c) => c.type !== 'text' && c.type !== 'date').map((c) => c.key),
  );
  return rows.map((r) => {
    const out: Row = {};
    for (const [k, v] of Object.entries(r)) {
      if (v == null) out[k] = null;
      else if (numeric.has(k)) {
        const n = Number(v);
        out[k] = Number.isFinite(n) ? n : null;
      } else out[k] = typeof v === 'number' ? v : String(v);
    }
    return out;
  });
}

export async function runAnalyticsReport(
  reportId: ReportId,
  filters?: AnalyticsFilters | null,
): Promise<ReportResult> {
  const f = normalizeFilters(filters);
  const def = REPORTS[reportId];
  const { sql, params } = BUILDERS[reportId](f);
  const raw = await dwhQuery<Row>(sql, params);
  const truncated = raw.length > ROW_CAP;
  return {
    reportId,
    title: def.title,
    sheet: def.sheet,
    generatedAt: new Date().toISOString(),
    columns: def.columns,
    rows: coerce(truncated ? raw.slice(0, ROW_CAP) : raw, def.columns),
    truncated,
  };
}
