/**
 * Finance Mytrion → Clients: the company-wide client roster, finance-shaped.
 *
 * Deliberately NOT the Sales/Loyalty roster (integrations/dwhClientRoster.ts). That one scans
 * `mart_transaction_line_items` for gallons and takes ~2.4s over 8k carriers; Finance needs payment
 * terms, credit and debt — not fuel volume — so this touches only `octane.dim_company` +
 * `public.cmp_invoice` and returns in a fraction of the time.
 *
 * Debt rules are copied EXACTLY from the Billing/Sales debtor definition (dwhClientRoster.ts, which
 * in turn mirrors servercrm's `dwhClients.js`) so Finance, Billing and Sales never disagree about
 * who owes what:
 *   - open invoice = status PENDING / PARTIALLY_PAID, still owes ≥ $1, and ≥ 2 days old by create_date
 *   - debt         = Σ outstanding on those
 *   - debt_days    = age of the oldest such invoice
 *
 * ⚠️ `dim_company.debt_amount` / `.is_debtor` / `.is_active` are STALE on the dim (servercrm measured
 * the dim at ~$6M vs ~$13.4M from invoices, and is_active stays 1 long after a carrier stops
 * fuelling) — never read them for money. Config columns on the dim (payment_terms, billing_type,
 * credit_limit) are fine; those are settings, not computed metrics.
 */
import { dwhQuery } from '../../integrations/dwh.js';

/** Matches the shared debtor definition — keep in sync with dwhClientRoster.ts. */
const DEBT_OVERDUE_DAYS = 2;
const DEBT_OPEN_BALANCE_MIN = 1;
/** ≥1 transaction in this window = "active", same as the Sales roster. */
const ACTIVE_DAYS = 10;

/**
 * One client row on the Finance roster — deliberately LEAN.
 *
 * The roster is every carrier (8,045 of them), and the whole tab filters and searches client-side so
 * typing feels instant. Carrying the full profile on every row cost 3.63 MB of JSON; the API does not
 * gzip (`@fastify/compress` is not installed), so that is 3.63 MB on the wire. Trimming to the ten
 * fields the table and its filters actually use roughly halves it, and the rest of the profile is
 * fetched per carrier by `fetchFinanceClientDetail` when a modal opens — a single-row lookup that
 * returns in milliseconds and loads behind the same skeleton as the modal's other tabs.
 */
export interface FinanceClientRow {
  carrierId: string;
  companyName: string;
  /** 'LOC' | 'Prepay' | '' — the payment-type filter. ~62% of carriers have none set. */
  paymentTerms: string;
  /** 'BANK' | 'DIRECT' | 'MERCHANT_CARD' | 'ZELLE' | ''. */
  billingType: string;
  activeCards: number;
  /** Computed from cmp_invoice, NOT dim_company.debt_amount. */
  computedDebt: number;
  computedDebtDays: number;
  openInvoices: number;
  /** True when the carrier owes ≥ $1 on a qualifying invoice. */
  isDebtor: boolean;
  computedIsActive: boolean;
}

/** The rest of a carrier's finance profile — loaded only when its modal opens. */
export interface FinanceClientDetail extends FinanceClientRow {
  contact: string;
  phone: string;
  email: string;
  agentName: string;
  billingCycle: string;
  paymentDay: string;
  creditLimit: number;
  creditScore: number;
  moneyCode: string;
  dot: string;
  isLocSuspended: boolean;
  lastTransactionAt: string | null;
  firstSwipeAt: string | null;
}

interface Row {
  carrier_id: number | string;
  company_name: string | null;
  deal_full_name: string | null;
  agent: string | null;
  deal_phone: string | null;
  contact_phone: string | null;
  deal_email: string | null;
  payment_terms: string | null;
  billing_type: string | null;
  billing_cycle: string | null;
  payment_day: string | null;
  credit_limit: string | number | null;
  credit_score: string | number | null;
  deal_money_code: string | null;
  comdata_id: string | null;
  dot: string | number | null;
  total_active_cards: string | number | null;
  is_loc_suspended: boolean | null;
  first_swipe_date: Date | string | null;
  computed_debt: string | number | null;
  computed_debt_days: string | number | null;
  open_invoices: string | number | null;
  computed_is_active: boolean | null;
  last_transaction_date: Date | string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/**
 * Naive timestamps stay naive. `last_transaction_date` is `timestamp without time zone`; `pg` parses
 * it using the SERVER's zone, so calling toISOString() would shift it hours. Read the local parts —
 * exactly the rule dwhTransactions.ts established.
 */
function naiveDate(v: Date | string | null): string | null {
  if (v == null) return null;
  if (!(v instanceof Date)) return String(v);
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}

/**
 * Every carrier with its finance profile and computed debt, heaviest debt first.
 *
 * `distinct on (carrier_id) … order by update_date desc` keeps the NEWEST dim row per carrier —
 * dim_company is an SCD, so without it a carrier fans out across historical rows.
 */
export async function fetchFinanceClients(): Promise<FinanceClientRow[]> {
  const rows = await dwhQuery<Row>(
    `with company as (
       select distinct on (carrier_id)
              carrier_id, company_name, payment_terms, billing_type, total_active_cards,
              last_transaction_date
         from octane.dim_company
        where carrier_id is not null
        order by carrier_id, update_date desc nulls last
     ),
     debt as (
       select carrier_id,
              coalesce(sum(greatest(total_amount - coalesce(total_paid, 0), 0)), 0) as debt,
              max((current_date - create_date::date)::int)                          as debt_days,
              count(*)                                                              as open_invoices
         from public.cmp_invoice
        where status in ('PENDING', 'PARTIALLY_PAID')
          and coalesce(total_paid, 0) < total_amount
          and greatest(total_amount - coalesce(total_paid, 0), 0) >= ${DEBT_OPEN_BALANCE_MIN}
          and create_date is not null
          and (current_date - create_date::date) >= ${DEBT_OVERDUE_DAYS}
          and carrier_id is not null
        group by carrier_id
     )
     select c.*,
            coalesce(d.debt, 0)                                                     as computed_debt,
            d.debt_days                                                             as computed_debt_days,
            coalesce(d.open_invoices, 0)                                            as open_invoices,
            coalesce(c.last_transaction_date >= now() - interval '${ACTIVE_DAYS} days', false)
                                                                                    as computed_is_active
       from company c
       left join debt d on d.carrier_id = c.carrier_id
      order by coalesce(d.debt, 0) desc, c.company_name asc nulls last, c.carrier_id asc`,
  );

  return rows.map(toRow);
}

/** Shared row projection — the list and the detail read must never diverge on debt/status. */
function toRow(r: Row): FinanceClientRow {
  const debt = num(r.computed_debt);
  return {
    carrierId: str(r.carrier_id),
    companyName: str(r.company_name) || '(unnamed)',
    paymentTerms: str(r.payment_terms),
    billingType: str(r.billing_type),
    activeCards: num(r.total_active_cards),
    computedDebt: debt,
    computedDebtDays: num(r.computed_debt_days),
    openInvoices: num(r.open_invoices),
    isDebtor: debt >= DEBT_OPEN_BALANCE_MIN,
    computedIsActive: r.computed_is_active === true,
  };
}

/**
 * One carrier's full finance profile — the modal's Details tab.
 *
 * Recomputes debt with the SAME cmp_invoice predicate as the roster rather than trusting whatever
 * the client passed in, so an open modal can never show a debt figure that contradicts the row it
 * was opened from. Returns null for an unknown carrier.
 */
export async function fetchFinanceClientDetail(carrierId: string): Promise<FinanceClientDetail | null> {
  const rows = await dwhQuery<Row>(
    `with company as (
       select distinct on (carrier_id)
              carrier_id, company_name, deal_full_name, agent, deal_phone, contact_phone, deal_email,
              payment_terms, billing_type, billing_cycle, payment_day, credit_limit, credit_score,
              deal_money_code, comdata_id, dot, total_active_cards, is_loc_suspended,
              last_transaction_date, first_swipe_date
         from octane.dim_company
        where carrier_id = $1::bigint
        order by carrier_id, update_date desc nulls last
     ),
     debt as (
       select carrier_id,
              coalesce(sum(greatest(total_amount - coalesce(total_paid, 0), 0)), 0) as debt,
              max((current_date - create_date::date)::int)                          as debt_days,
              count(*)                                                              as open_invoices
         from public.cmp_invoice
        where carrier_id = $1::bigint
          and status in ('PENDING', 'PARTIALLY_PAID')
          and coalesce(total_paid, 0) < total_amount
          and greatest(total_amount - coalesce(total_paid, 0), 0) >= ${DEBT_OPEN_BALANCE_MIN}
          and create_date is not null
          and (current_date - create_date::date) >= ${DEBT_OVERDUE_DAYS}
        group by carrier_id
     )
     select c.*,
            coalesce(d.debt, 0)          as computed_debt,
            d.debt_days                  as computed_debt_days,
            coalesce(d.open_invoices, 0) as open_invoices,
            coalesce(c.last_transaction_date >= now() - interval '${ACTIVE_DAYS} days', false)
                                         as computed_is_active
       from company c
       left join debt d on d.carrier_id = c.carrier_id`,
    [carrierId],
  );

  const r = rows[0];
  if (!r) return null;
  return {
    ...toRow(r),
    contact: str(r.deal_full_name),
    phone: str(r.deal_phone) || str(r.contact_phone),
    email: str(r.deal_email),
    agentName: str(r.agent),
    billingCycle: str(r.billing_cycle),
    paymentDay: str(r.payment_day),
    creditLimit: num(r.credit_limit),
    creditScore: num(r.credit_score),
    moneyCode: str(r.deal_money_code) || str(r.comdata_id),
    dot: str(r.dot),
    isLocSuspended: r.is_loc_suspended === true,
    lastTransactionAt: naiveDate(r.last_transaction_date),
    firstSwipeAt: naiveDate(r.first_swipe_date),
  };
}
