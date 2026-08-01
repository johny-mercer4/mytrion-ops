/**
 * Verification pipeline — DWH deals + current-terms service (read-only). Backs the Sales
 * "Verification Pipeline" tab's server-paginated client list, ordered by freshest application
 * date and enriched where a carrier has reached dim_company.
 * Raw SQL lives here (external read-only integration); it runs through the enforced-read-only DWH
 * pool. Compliance-stage data itself comes from the pipeline provider, not from the DWH.
 */
import { dwh } from '../../integrations/dwh.js';

export type VerificationClientStage = 'in_pipeline' | 'active' | 'closed';

export interface VerificationClient {
  dealId: string | null;
  carrierId: string | null;
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
  country: string | null;
  contactSource: string | null;
  agentName: string;
  attentionCount: number;
  verificationStatus: string | null;
  verificationUpdatedAt: string | null;
}

/** dim_company columns the `owned` CTE must expose for classification + terms + pipeline keys. */
const OWNED_COLS = `company_name, deal_stage, application_id, dot,
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
  deal_name: string | null;
  agent: string | null;
  country: string | null;
  contact_source: string | null;
  appfilldate: Date | string | null;
  total_count: number | string | null;
}

export interface VerificationClientPage {
  clients: VerificationClient[];
  total: number;
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
 * One pipeline-only page of the caller's agent_deals rows, including applications that do not have
 * a carrier_id yet. The DWH table has an agent display name but no Zoho user id, so the
 * server-resolved session/View-as name is the fail-closed owner authority. A lateral lookup reads
 * only each deal's latest dim_company record instead of sorting the entire company dimension.
 */
export async function getAgentVerificationClients(
  _ownerZohoUserId: string,
  agentName: string | undefined,
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<VerificationClientPage> {
  const ownerName = agentName?.trim();
  if (!ownerName) return { clients: [], total: 0 };
  const page = Math.max(options.page ?? 1, 1);
  const pageSize = Math.min(Math.max(options.pageSize ?? 9, 1), 24);
  const offset = (page - 1) * pageSize;
  const search = options.search?.trim().toLowerCase() ?? '';

  const rows = await dwh.query<Row>(
    `with deals as (
       select distinct on (id) id::text as deal_id, carrier_id, deal_name, agent, country,
              contact_source, appfilldate
         from octane.agent_deals
        where id is not null and lower(agent) = lower($1)
        order by id, appfilldate desc nulls last
     ),
     enriched as (
       select c.*, d.deal_id, d.carrier_id, d.deal_name, d.agent, d.country,
              d.contact_source, d.appfilldate
         from deals d
         left join lateral (
           select ${OWNED_COLS}
             from octane.dim_company company
            where company.carrier_id = d.carrier_id
            order by company.update_date desc nulls last
            limit 1
         ) c on true
     ),
     filtered as (
       select *, count(*) over() as total_count
         from enriched
        where not (
          lower(coalesce(deal_stage, '')) = 'card swiped'
          or first_swipe_date is not null
          or coalesce(total_swiped_cards, 0) > 0
        )
          and (
            $2 = ''
            or lower(concat_ws(' ', deal_name, company_name, deal_stage, carrier_id::text))
               like '%' || $2 || '%'
          )
     )
     select *
       from filtered
      order by appfilldate desc nulls last, deal_id desc
      limit $3 offset $4`,
    [ownerName, search, pageSize, offset],
  );

  const clients = rows.map((r) => ({
    dealId: strOrNull(r.deal_id),
    carrierId: strOrNull(r.carrier_id),
    companyName: str(r.deal_name) || str(r.company_name) || '(unnamed application)',
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
    country: strOrNull(r.country),
    contactSource: strOrNull(r.contact_source),
    agentName: str(r.agent),
    attentionCount: 0,
    verificationStatus: null,
    verificationUpdatedAt: null,
  }));
  return { clients, total: rows.length ? num(rows[0]?.total_count) : 0 };
}
