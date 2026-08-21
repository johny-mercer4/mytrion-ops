/**
 * Data Center Blacklist → Debtors. Read-only DWH.
 *
 * Resolve `carrier_id` from `octane.dim_company` on the keys Billing already joins
 * (DOT / email / phone / name). `dim_company` has no MC column — MC goes through
 * `octane.stg_zoho_deals.mc` (newest snapshot per carrier) then the same invoice roll-up.
 *
 * Debtor law for this desk is company-wide, not Collection-only and not the Finance/Sales
 * ≥ $1 bar: outstanding (total_amount − total_paid) > $100. Age ≥ 2 days stays only to
 * drop same-day invoice noise from the finance CTE. If those two ever conflict, > $100 wins.
 * Never read `dim_company.is_debtor`.
 */
import { dwh } from '../integrations/dwh.js';

/** The money bar the UI and tests must pin. Not $1. */
export const VERIFICATION_DEBTOR_OUTSTANDING_MIN = 100;

/**
 * Same-day invoices are noise on a live CMP feed. This is NOT the debtor definition.
 * The defining predicate is {@link DEBTOR_HAVING_SQL}.
 */
export const VERIFICATION_DEBTOR_MIN_AGE_DAYS = 2;

export const DEBTOR_OUTSTANDING_SQL =
  'greatest(i.total_amount - coalesce(i.total_paid, 0), 0)';

/** Open book — status + still unpaid. No $1 floor. */
export const DEBTOR_OPEN_INVOICE_SQL = `i.status in ('PENDING', 'PARTIALLY_PAID')
          and coalesce(i.total_paid, 0) < i.total_amount
          and i.create_date is not null
          and (current_date - i.create_date::date) >= ${VERIFICATION_DEBTOR_MIN_AGE_DAYS}
          and i.carrier_id is not null`;

/** Client is a debtor when the roll-up exceeds $100 — the unified company law. */
export const DEBTOR_HAVING_SQL = `coalesce(sum(${DEBTOR_OUTSTANDING_SQL}), 0) > ${VERIFICATION_DEBTOR_OUTSTANDING_MIN}`;

export const VERIFICATION_DEBTOR_SEARCH_LIMIT = 25;

export type DebtorSearchBy = 'dot' | 'mc' | 'email' | 'phone' | 'name';

const COMPANY_COLS = `c.carrier_id, c.company_name, c.deal_name, c.deal_full_name,
              c.deal_email, c.contact_email, c.deal_secondary_email,
              c.deal_phone, c.contact_phone, c.cell, c.dot`;

const DEBT_CTE = `debt as (
       select i.carrier_id,
              coalesce(sum(${DEBTOR_OUTSTANDING_SQL}), 0) as debt,
              max((current_date - i.create_date::date)::int) as debt_days,
              count(*) as open_invoices
         from public.cmp_invoice i
        where ${DEBTOR_OPEN_INVOICE_SQL}
        group by i.carrier_id
       having ${DEBTOR_HAVING_SQL}
     )`;

const SELECT_TAIL = `select ${COMPANY_COLS},
            d.debt as computed_debt,
            d.debt_days as computed_debt_days,
            d.open_invoices
       from company c
       join debt d on d.carrier_id = c.carrier_id
      order by d.debt desc, c.company_name asc nulls last, c.carrier_id asc
      limit ${VERIFICATION_DEBTOR_SEARCH_LIMIT}`;

/** SCD collapse — newest dim row per carrier. */
const DIM_NEWEST = `select distinct on (carrier_id)
              carrier_id, company_name, deal_name, deal_full_name,
              deal_email, contact_email, deal_secondary_email,
              deal_phone, contact_phone, cell, dot
         from octane.dim_company
        where carrier_id is not null`;

export const DEBTOR_SEARCH_SQL: Record<DebtorSearchBy, string> = {
  dot: `with company as (
       ${DIM_NEWEST}
          and nullif(regexp_replace(coalesce(dot::text, ''), '\\D', '', 'g'), '') = $1
        order by carrier_id, update_date desc nulls last
     ),
     ${DEBT_CTE}
     ${SELECT_TAIL}`,
  mc: `with matched as (
       select distinct on (carrier_id) carrier_id
         from octane.stg_zoho_deals
        where carrier_id is not null
          and nullif(regexp_replace(coalesce(mc, ''), '\\D', '', 'g'), '') = $1
        order by carrier_id, valid_from desc nulls last
     ),
     company as (
       select distinct on (c.carrier_id)
              ${COMPANY_COLS}
         from octane.dim_company c
         join matched m on m.carrier_id = c.carrier_id
        order by c.carrier_id, c.update_date desc nulls last
     ),
     ${DEBT_CTE}
     ${SELECT_TAIL}`,
  email: `with company as (
       ${DIM_NEWEST}
          and (
            lower(coalesce(deal_email, '')) = $1
            or lower(coalesce(contact_email, '')) = $1
            or lower(coalesce(deal_secondary_email, '')) = $1
          )
        order by carrier_id, update_date desc nulls last
     ),
     ${DEBT_CTE}
     ${SELECT_TAIL}`,
  phone: `with company as (
       ${DIM_NEWEST}
          and (
            nullif(regexp_replace(coalesce(deal_phone, ''), '\\D', '', 'g'), '') = $1
            or nullif(regexp_replace(coalesce(contact_phone, ''), '\\D', '', 'g'), '') = $1
            or nullif(regexp_replace(coalesce(cell, ''), '\\D', '', 'g'), '') = $1
          )
        order by carrier_id, update_date desc nulls last
     ),
     ${DEBT_CTE}
     ${SELECT_TAIL}`,
  name: `with company as (
       ${DIM_NEWEST}
          and (
            lower(btrim(coalesce(company_name, ''))) = $1
            or lower(btrim(coalesce(deal_name, ''))) = $1
          )
        order by carrier_id, update_date desc nulls last
     ),
     ${DEBT_CTE}
     ${SELECT_TAIL}`,
};

export async function searchVerificationDebtors(
  by: DebtorSearchBy,
  needle: string,
): Promise<Record<string, unknown>[]> {
  return dwh.query<Record<string, unknown>>(DEBTOR_SEARCH_SQL[by], [needle]);
}
