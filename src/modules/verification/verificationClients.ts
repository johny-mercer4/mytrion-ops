/**
 * Verification Mytrion → "Existing clients" roster (read-only, `octane.dim_company`).
 *
 * Distinct from `modules/verificationPipeline/service.ts`, which is the SALES redesign's own
 * "Verification Pipeline" tab — the caller's own deal-clients joined to a mock compliance-stage
 * provider. This is the Verification MYTRION's roster: every carrier company-wide, with the
 * payment/credit terms a verification or compliance reviewer needs, and no pipeline-stage mock.
 *
 * One query, no marts, no invoice join — this touches only `dim_company`, so it returns in the same
 * "fraction of a second" range `financeClients.ts` already established for this exact table (see that
 * file's header for why the mart-scanning roster in `dwhClientRoster.ts` is ~2.4s and this is not).
 * The LEAN list row carries every field the cards and the filters need; contact/address/agent detail
 * is fetched separately per carrier only when a card's modal opens, so the roster fetch — cached once
 * client-side — stays small for all ~8,000 rows.
 *
 * `is_debtor` here is read RAW off `dim_company`, unlike Finance's roster (which computes debt from
 * `cmp_invoice` because the dim's own debt fields are stale for MONEY). Verification is asking a
 * different question — "is this carrier flagged as a debtor on file" is a compliance/credit signal,
 * not a ledger balance — and `verificationPipeline/service.ts` already reads the same raw flag for
 * exactly that reason. Don't repurpose this for anything that needs an actual owed amount.
 */
import { dwh } from '../../integrations/dwh.js';

/**
 * One roster row. `companyType` is `dim_company.billing_type` (BANK / DIRECT / MERCHANT_CARD / ZELLE /
 * unset) — the same column Finance's roster shows as "Billing"; verification calls it Company Type
 * because that is how the terms were described when this tab was requested.
 */
export interface VerificationClientRow {
  carrierId: string;
  companyName: string;
  companyType: string;
  paymentTerms: string;
  paymentDay: string;
  minimumRequiredBalance: number | null;
  billingCycleTag: string;
  isDebtor: boolean;
  billingCycle: string;
  /** Only meaningful when `paymentTerms === 'LOC'`; present regardless so a caller can decide. */
  creditLimit: number | null;
  creditScore: number | null;
  isActive: boolean;
}

/** The roster row plus the identity/contact fields only the detail modal needs. */
export interface VerificationClientDetail extends VerificationClientRow {
  contact: string;
  phone: string;
  email: string;
  agentName: string;
  agentEmail: string;
  dot: string;
  address: string;
  city: string;
  state: string;
  moneyCode: string;
  insuranceCoverage: string;
  creditsafeGrade: string;
  firstSwipeAt: string | null;
  lastTransactionAt: string | null;
}

interface Row {
  carrier_id: number | string;
  company_name: string | null;
  billing_type: string | null;
  payment_terms: string | null;
  payment_day: string | null;
  minimum_required_balance: string | number | null;
  billing_cycle_tag: string | null;
  is_debtor: boolean | null;
  billing_cycle: string | null;
  credit_limit: string | number | null;
  credit_score: string | number | null;
  is_active: number | null;
}

interface DetailRow extends Row {
  deal_full_name: string | null;
  agent: string | null;
  deal_phone: string | null;
  contact_phone: string | null;
  deal_email: string | null;
  contact_email: string | null;
  agent_email: string | null;
  dot: string | number | null;
  address: string | null;
  city: string | null;
  state: string | null;
  deal_money_code: string | null;
  comdata_id: string | null;
  insurance_coverage: string | null;
  creditsafe_grade: string | null;
  first_swipe_date: Date | string | null;
  last_transaction_date: Date | string | null;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Naive timestamp → local yyyy-mm-dd, matching the rule `dwhTransactions.ts` established. */
function naiveDate(v: Date | string | null): string | null {
  if (v == null) return null;
  if (!(v instanceof Date)) return String(v).slice(0, 10) || null;
  const p = (x: number): string => String(x).padStart(2, '0');
  return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`;
}

function toRow(r: Row): VerificationClientRow {
  return {
    carrierId: str(r.carrier_id),
    companyName: str(r.company_name) || '(unnamed)',
    companyType: str(r.billing_type),
    paymentTerms: str(r.payment_terms),
    paymentDay: str(r.payment_day),
    minimumRequiredBalance: numOrNull(r.minimum_required_balance),
    billingCycleTag: str(r.billing_cycle_tag),
    isDebtor: r.is_debtor === true,
    billingCycle: str(r.billing_cycle),
    creditLimit: numOrNull(r.credit_limit),
    creditScore: numOrNull(r.credit_score),
    isActive: r.is_active === 1,
  };
}

const COMPANY_COLS = `carrier_id, company_name, billing_type, payment_terms, payment_day,
  minimum_required_balance, billing_cycle_tag, is_debtor, billing_cycle, credit_limit, credit_score,
  is_active`;

/**
 * Every carrier's verification/payment terms, company-name order.
 *
 * `distinct on (carrier_id) … order by update_date desc` keeps the newest dim row per carrier — the
 * same SCD-collapse `financeClients.ts` and `dwhClientRoster.ts` both use, since `dim_company` fans a
 * carrier out across historical rows otherwise.
 */
export async function listVerificationClients(): Promise<VerificationClientRow[]> {
  const rows = await dwh.query<Row>(
    `with company as (
       select distinct on (carrier_id) ${COMPANY_COLS}
         from octane.dim_company
        where carrier_id is not null
        order by carrier_id, update_date desc nulls last
     )
     select * from company
     order by company_name asc nulls last, carrier_id asc`,
  );
  return rows.map(toRow);
}

/**
 * One carrier's full verification profile — the modal's identity/contact section. Returns null for an
 * unknown carrier rather than throwing, so a stale card (deleted between roster load and click) is a
 * quiet empty state, not an error banner.
 */
export async function getVerificationClientDetail(
  carrierId: string,
): Promise<VerificationClientDetail | null> {
  const rows = await dwh.query<DetailRow>(
    `select ${COMPANY_COLS}, deal_full_name, agent, agent_email, deal_phone, contact_phone,
            deal_email, contact_email, dot, address, city, state, deal_money_code, comdata_id,
            insurance_coverage, creditsafe_grade, first_swipe_date, last_transaction_date
       from octane.dim_company
      where carrier_id = $1::bigint
      order by update_date desc nulls last
      limit 1`,
    [carrierId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    ...toRow(r),
    contact: str(r.deal_full_name),
    phone: str(r.deal_phone) || str(r.contact_phone),
    email: str(r.deal_email) || str(r.contact_email),
    agentName: str(r.agent),
    agentEmail: str(r.agent_email),
    dot: str(r.dot),
    address: [str(r.address), str(r.city), str(r.state)].filter(Boolean).join(', '),
    city: str(r.city),
    state: str(r.state),
    moneyCode: str(r.deal_money_code) || str(r.comdata_id),
    insuranceCoverage: str(r.insurance_coverage),
    creditsafeGrade: str(r.creditsafe_grade),
    firstSwipeAt: naiveDate(r.first_swipe_date),
    lastTransactionAt: naiveDate(r.last_transaction_date),
  };
}
