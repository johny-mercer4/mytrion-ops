/**
 * Receivables dimension — invoicing, collections and open AR aging (backs the Finance dashboard).
 *
 * Previously Finance reused the `billing` dimension, so it rendered the exact same top-up block
 * under a different sidebar label. The two are genuinely different questions:
 *   - `billing`     — money clients PUT IN (top-up history, wallet balances).
 *   - `receivables` — money clients still OWE against issued invoices (AR, aging, collections).
 *
 * Amount rules mirror dwhClientRoster's debt definition so Finance and the Clients roster cannot
 * disagree: an invoice is open when status is PENDING/PARTIALLY_PAID and it still owes >= $1.
 * Outstanding/overdue/aging are point-in-time (the current book), NOT date-window filtered —
 * an aging report scoped to "today" would be meaningless. Invoiced/collected are window figures.
 */
import { dwhQuery } from '../../../integrations/dwh.js';
import {
  dateScope,
  normalizeFilters,
  ownedCarrierCteFor,
  SqlParams,
  type AnalyticsFilters,
} from '../filters.js';
import {
  captionFor,
  fmtCount,
  fmtMoney,
  num,
  softQuery,
  toTrend,
  withCte,
  type DayRow,
} from '../shared.js';
import type { AnalyticsBlock, BreakdownItem, BreakdownTone, KpiStat, LeaderboardRow } from '../types.js';
/**
 * `DUE` / `OPEN_INVOICE` / `PAYMENT_OK` and friends now live in the Billing Ledger's arRules.ts. They
 * were inlined here first; the Ledger's AR sub-ledger has to mean exactly the same thing by "owed", so
 * there is one definition and two consumers. `tests/unit/ledger-aging.test.ts` asserts this file's
 * output is unchanged by the extraction.
 */
import {
  DUE,
  INVOICE_DATE,
  OPEN_INVOICE,
  PAYMENT_DATE,
  PAYMENT_OK,
} from '../../billing/ledger/arRules.js';


/** Ordered oldest-last so the breakdown reads Current → 60+ rather than by size. */
const AGING_BUCKET_SQL = `case
    when i.due_date is null or i.due_date::date >= current_date then 'Current'
    when i.due_date::date >= current_date - 7  then '1-7 days'
    when i.due_date::date >= current_date - 30 then '8-30 days'
    when i.due_date::date >= current_date - 60 then '31-60 days'
    else '60+ days'
  end`;
const AGING_ORDER_SQL = `case
    when i.due_date is null or i.due_date::date >= current_date then 1
    when i.due_date::date >= current_date - 7  then 2
    when i.due_date::date >= current_date - 30 then 3
    when i.due_date::date >= current_date - 60 then 4
    else 5
  end`;

const AGING_TONES: Record<string, BreakdownTone> = {
  Current: 'good',
  '1-7 days': 'teal',
  '8-30 days': 'amber',
  '31-60 days': 'warn',
  '60+ days': 'bad',
};

interface InvoicedRow {
  cur_amount: unknown;
  prev_amount: unknown;
  cur_count: unknown;
}
interface CollectedRow {
  cur_amount: unknown;
  prev_amount: unknown;
}
interface OpenRow {
  open_invoices: unknown;
  outstanding: unknown;
  overdue: unknown;
  overdue_carriers: unknown;
}
interface DebtorRow {
  company: string | null;
  outstanding: unknown;
  invoices: unknown;
  oldest_days: unknown;
}

export async function computeReceivables(filters: AnalyticsFilters): Promise<AnalyticsBlock> {
  const f = normalizeFilters(filters);

  const invP = new SqlParams();
  const invScope = dateScope(INVOICE_DATE, f, invP);
  const invOwned = ownedCarrierCteFor('i', f, invP);
  // CANCELLED invoices were never really billed — excluding them keeps "Invoiced" a revenue figure.
  const invSql = withCte(
    invOwned.cte,
    `select
       sum(i.total_amount) filter (where ${invScope.current})  as cur_amount,
       sum(i.total_amount) filter (where ${invScope.previous}) as prev_amount,
       count(*) filter (where ${invScope.current})             as cur_count
     from public.cmp_invoice i
     ${invOwned.joinOn}
     where i.status <> 'CANCELLED'
       and ((${invScope.current}) or (${invScope.previous}))`,
  );

  const payP = new SqlParams();
  const payScope = dateScope(PAYMENT_DATE, f, payP);
  const payOwned = ownedCarrierCteFor('i', f, payP);
  // Only join the invoice when we need it for ownership — an unscoped collections total does not.
  const payJoin = payOwned.cte
    ? `join public.cmp_invoice i on i.id = p.invoice_id
     ${payOwned.joinOn}`
    : '';
  const paySql = withCte(
    payOwned.cte,
    `select
       sum(p.amount) filter (where ${payScope.current})  as cur_amount,
       sum(p.amount) filter (where ${payScope.previous}) as prev_amount
     from public.cmp_invoice_payment p
     ${payJoin}
     where ${PAYMENT_OK}
       and ((${payScope.current}) or (${payScope.previous}))`,
  );

  const openP = new SqlParams();
  const openOwned = ownedCarrierCteFor('i', f, openP);
  const openSql = withCte(
    openOwned.cte,
    `select count(*) as open_invoices,
            sum(${DUE}) as outstanding,
            sum(${DUE}) filter (where i.due_date::date < current_date) as overdue,
            count(distinct i.carrier_id) filter (where i.due_date::date < current_date) as overdue_carriers
     from public.cmp_invoice i
     ${openOwned.joinOn}
     where ${OPEN_INVOICE}`,
  );

  const ageP = new SqlParams();
  const ageOwned = ownedCarrierCteFor('i', f, ageP);
  const ageSql = withCte(
    ageOwned.cte,
    `select ${AGING_BUCKET_SQL} as bucket, ${AGING_ORDER_SQL} as bucket_order, sum(${DUE}) as amount
     from public.cmp_invoice i
     ${ageOwned.joinOn}
     where ${OPEN_INVOICE}
     group by 1, 2
     order by 2`,
  );

  const debtorP = new SqlParams();
  const debtorOwned = ownedCarrierCteFor('i', f, debtorP);
  const debtorSql = withCte(
    debtorOwned.cte,
    `select coalesce(nullif(trim(i.company_name), ''), '(unnamed)') as company,
            sum(${DUE}) as outstanding,
            count(*) as invoices,
            greatest(max((current_date - i.due_date::date))::int, 0) as oldest_days
     from public.cmp_invoice i
     ${debtorOwned.joinOn}
     where ${OPEN_INVOICE}
     group by 1
     order by 2 desc
     limit 5`,
  );

  const dailyP = new SqlParams();
  const dailyScope = dateScope(PAYMENT_DATE, f, dailyP);
  const dailyOwned = ownedCarrierCteFor('i', f, dailyP);
  const dailyJoin = dailyOwned.cte
    ? `join public.cmp_invoice i on i.id = p.invoice_id
       ${dailyOwned.joinOn}`
    : '';
  const dailyInner = withCte(
    dailyOwned.cte,
    `select ${PAYMENT_DATE}::date as day, round(sum(p.amount)) as total
     from public.cmp_invoice_payment p
     ${dailyJoin}
     where ${PAYMENT_OK}
       and ${PAYMENT_DATE}::date >= (${dailyScope.trendStart})::date
       and ${PAYMENT_DATE}::date <= (${dailyScope.trendEnd})::date
     group by 1`,
  );
  // generate_series sits outside the owned CTE — wrap the aggregate as a subquery.
  const dailySql = `select to_char(d.day, 'Mon DD') as day_label, coalesce(c.total, 0) as value
     from generate_series(${dailyScope.trendStart}, ${dailyScope.trendEnd}, interval '1 day') as d(day)
     left join (${dailyInner}) c on c.day = d.day::date
     order by d.day`;

  // Parallelism capped at 2 per round — the shared DWH pool is tiny (max ~5).
  const [invoiced, collected] = await Promise.all([
    softQuery<InvoicedRow>('receivables.invoiced', () =>
      dwhQuery<InvoicedRow>(invSql, invP.values),
    ),
    softQuery<CollectedRow>('receivables.collected', () =>
      dwhQuery<CollectedRow>(paySql, payP.values),
    ),
  ]);
  const [open, aging] = await Promise.all([
    softQuery<OpenRow>('receivables.open', () => dwhQuery<OpenRow>(openSql, openP.values)),
    softQuery<{ bucket: string; bucket_order: unknown; amount: unknown }>(
      'receivables.aging',
      () =>
        dwhQuery<{ bucket: string; bucket_order: unknown; amount: unknown }>(ageSql, ageP.values),
    ),
  ]);
  const [debtors, daily] = await Promise.all([
    softQuery<DebtorRow>('receivables.debtors', () =>
      dwhQuery<DebtorRow>(debtorSql, debtorP.values),
    ),
    softQuery<DayRow>('receivables.daily', () => dwhQuery<DayRow>(dailySql, dailyP.values)),
  ]);

  const inv = invoiced[0];
  const col = collected[0];
  const o = open[0];
  const outstanding = num(o?.outstanding);
  const overdue = num(o?.overdue);

  const kpis: KpiStat[] = [
    {
      label: 'Invoiced',
      value: fmtMoney(num(inv?.cur_amount)),
      delta: {
        prev: num(inv?.prev_amount),
        current: num(inv?.cur_amount),
        higherIsBetter: true,
      },
    },
    {
      label: 'Collected',
      value: fmtMoney(num(col?.cur_amount)),
      delta: {
        prev: num(col?.prev_amount),
        current: num(col?.cur_amount),
        higherIsBetter: true,
      },
    },
    {
      label: 'Outstanding',
      value: fmtMoney(outstanding),
      hint: `${fmtCount(num(o?.open_invoices))} open invoices · now`,
    },
    {
      label: 'Overdue',
      value: fmtMoney(overdue),
      hint: `${fmtCount(num(o?.overdue_carriers))} carriers past due`,
    },
  ];

  const breakdown: BreakdownItem[] = aging.map((a) => ({
    label: a.bucket,
    value: Math.round(num(a.amount)),
    tone: AGING_TONES[a.bucket] ?? 'neutral',
  }));

  const leaderboard: LeaderboardRow[] = debtors.map((d) => ({
    name: d.company ?? '(unnamed)',
    col1: Math.round(num(d.outstanding)),
    col2: num(d.invoices),
    col3: num(d.oldest_days) > 0 ? `${num(d.oldest_days)}d` : 'Current',
  }));

  return {
    label: 'Finance',
    caption: captionFor('Invoicing, collections and open receivables', f),
    kpis,
    trendLabel: 'Collected $ / day',
    trend: toTrend(daily),
    breakdownLabel: 'Open AR by age',
    breakdown,
    leaderboardLabel: 'Largest outstanding balances',
    leaderboardCols: ['Outstanding', 'Invoices', 'Oldest'],
    leaderboard,
  };
}
