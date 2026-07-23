/**
 * Verification pipeline — DWH deals + current-terms service (read-only). Backs the Sales
 * "Verification Pipeline" tab's client list: the caller's deal-clients ordered by freshest
 * application date (octane.agent_deals.appfilldate), each classified in_pipeline | active | closed
 * from octane.dim_company, and enriched with current terms (credit limit, billing cycle, payment
 * terms/day, card/swipe status). Raw SQL lives here (repo rule 2); runs through the read-only `dwh`
 * pool. The compliance-stage data itself comes from the pipeline PROVIDER (mock this phase), NOT
 * from here — this module never touches the credit_platform verification DB.
 */
import { dwh } from '../../integrations/dwh.js';
import { buildOwnedCte, ownerBinds } from '../../integrations/dwhClientRoster.js';

export type VerificationClientStage = 'in_pipeline' | 'active' | 'closed';

export interface VerificationClient {
  dealId: string | null;
  carrierId: string;
  companyName: string;
  /** yyyy-mm-dd application-fill date (freshest-first sort key). */
  appFillDate: string | null;
  dealStage: string;
  classification: VerificationClientStage;
  /** Current terms (populated for active/LOC clients; null when not yet decided). */
  creditScore: number | null;
  creditLimit: number | null;
  billingCycle: string | null;
  paymentTerms: string | null;
  paymentDay: string | null;
  minimumRequiredBalance: number | null;
  /** Card / swipe status. */
  firstSwipeDate: string | null;
  lastTransactionDate: string | null;
  totalActiveCards: number;
  totalSwipedCards: number;
  activeCardsLast30Days: number;
  isActive: boolean;
  isLocSuspended: boolean;
  isDebtor: boolean;
  /** Keys used to look up the compliance pipeline (provider); from dim_company. */
  applicationId: string | null;
  dot: string | null;
}

/** dim_company columns the `owned` CTE must expose for classification + terms + pipeline keys. */
const OWNED_COLS = `carrier_id, company_name, deal_stage, application_id, dot,
  credit_score, credit_limit, billing_cycle, payment_terms, payment_day, minimum_required_balance,
  first_swipe_date, last_transaction_date, total_active_cards, total_swiped_cards,
  active_cards_last_30_days, is_active, is_loc_suspended, is_debtor`;

interface Row {
  carrier_id: string | number;
  company_name: string | null;
  deal_stage: string | null;
  application_id: number | string | null;
  dot: number | string | null;
  credit_score: number | string | null;
  credit_limit: number | string | null;
  billing_cycle: string | null;
  payment_terms: string | null;
  payment_day: string | null;
  minimum_required_balance: number | string | null;
  first_swipe_date: Date | string | null;
  last_transaction_date: Date | string | null;
  total_active_cards: number | string | null;
  total_swiped_cards: number | string | null;
  active_cards_last_30_days: number | string | null;
  is_active: number | null;
  is_loc_suspended: boolean | null;
  is_debtor: boolean | null;
  deal_id: string | null;
  appfilldate: Date | string | null;
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const strOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s || null;
};
/** yyyy-mm-dd (a DATE comes back as a Date or 'yyyy-mm-dd' string). */
const dateOrNull = (v: Date | string | null): string | null => {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};

/** Classify a deal from its dim_company signals — matches the user's definition. */
function classify(r: Row): VerificationClientStage {
  const stage = str(r.deal_stage).toLowerCase();
  if (stage === 'closed lost' || stage.includes('out of business')) return 'closed';
  // "Existing / using our cards" = Card Swiped (or has actually swiped).
  if (stage === 'card swiped' || r.first_swipe_date != null || num(r.total_swiped_cards) > 0) return 'active';
  return 'in_pipeline';
}

/**
 * The caller's deal-clients, freshest application date first. Owner resolution reuses the roster's
 * id-suffix-first / display-name-fallback authority (buildOwnedCte over dim_company); we then join
 * octane.agent_deals on carrier_id for the Zoho deal id + appfilldate sort key. Empty when the
 * caller has neither a usable id-suffix nor a name (fail-closed).
 *
 * Note: agent_deals rows without a carrier_id (pre-company applications) have no dim_company terms
 * and no pipeline join key, so they are intentionally excluded — the list is the agent's clients
 * that reached a company record.
 */
export async function getAgentVerificationClients(
  ownerZohoUserId: string,
  agentName: string | undefined,
  limit = 300,
): Promise<VerificationClient[]> {
  const { binds, idBindIdx, nameBindIdx } = ownerBinds(ownerZohoUserId, agentName);
  if (idBindIdx === null && nameBindIdx === null) return [];
  const lim = Math.min(Math.max(limit, 1), 1000);

  const rows = await dwh.query<Row>(
    `with ${buildOwnedCte(idBindIdx, nameBindIdx, OWNED_COLS)},
     deals as (
       select distinct on (carrier_id) carrier_id, id::text as deal_id, appfilldate
         from octane.agent_deals
        where carrier_id is not null and id is not null
        order by carrier_id, appfilldate desc nulls last, id desc
     )
     select o.*, d.deal_id, d.appfilldate
       from owned o
       left join deals d on d.carrier_id = o.carrier_id
      order by d.appfilldate desc nulls last, o.company_name asc nulls last
      limit ${lim}`,
    binds,
  );

  return rows.map((r) => ({
    dealId: strOrNull(r.deal_id),
    carrierId: str(r.carrier_id),
    companyName: str(r.company_name) || '(unnamed)',
    appFillDate: dateOrNull(r.appfilldate),
    dealStage: str(r.deal_stage) || '—',
    classification: classify(r),
    creditScore: numOrNull(r.credit_score),
    creditLimit: numOrNull(r.credit_limit),
    billingCycle: strOrNull(r.billing_cycle),
    paymentTerms: strOrNull(r.payment_terms),
    paymentDay: strOrNull(r.payment_day),
    minimumRequiredBalance: numOrNull(r.minimum_required_balance),
    firstSwipeDate: dateOrNull(r.first_swipe_date),
    lastTransactionDate: dateOrNull(r.last_transaction_date),
    totalActiveCards: num(r.total_active_cards),
    totalSwipedCards: num(r.total_swiped_cards),
    activeCardsLast30Days: num(r.active_cards_last_30_days),
    isActive: r.is_active === 1,
    isLocSuspended: r.is_loc_suspended === true,
    isDebtor: r.is_debtor === true,
    applicationId: strOrNull(r.application_id),
    dot: strOrNull(r.dot),
  }));
}
