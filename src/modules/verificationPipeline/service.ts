/**
 * Verification pipeline — the agent's applications, read from Zoho CRM Deals (read-only COQL).
 *
 * Previously this read `octane.agent_deals` joined to `octane.dim_company` in the DWH. That source is
 * gone from this path: it was keyed on an agent DISPLAY NAME (the warehouse has no Zoho user id), so
 * an agent whose name did not match got an empty pipeline, and the fields verification actually turns
 * on — Stage, Application_Stage, Application_Status, Credit_Decision, Credit_Score, the three
 * *_Verification picklists — are Zoho fields that were absent or lagging in the warehouse.
 *
 * Zoho paging: `fetchAgentVerificationDeals` drains 200-row COQL pages for the owner (capped), and
 * this module then serves the UI's requested page out of that set, which is what makes an exact
 * `total` possible. Compliance-stage snapshots still come from the pipeline provider — not from here.
 */
import {
  fetchAgentVerificationDeals,
  fetchAllVerificationDeals,
  fetchVerificationDeal,
  type CrmDealRow,
} from '../../integrations/salesVerificationDeals.js';

export type VerificationClientStage = 'in_pipeline' | 'active' | 'closed';

export interface VerificationClient {
  dealId: string | null;
  carrierId: string | null;
  companyName: string;
  /** Zoho `Deal_Name` verbatim (companyName prefers Account_Name, so this keeps deal name searchable). */
  dealName: string;
  /** yyyy-mm-dd `Application_Date` (freshest-first sort key; may be null on a filled application). */
  appFillDate: string | null;
  /** Zoho `Stage` — the deal's position in the sales pipeline. */
  dealStage: string;
  /** Zoho `Application_Stage` — where the APPLICATION sits (Adjudication, Implementation, …). */
  applicationStage: string | null;
  /** Zoho `Application_Status` — the WEX-side status (Pending Decision, Decisioned, …). */
  applicationStatus: string | null;
  /** yyyy-mm-dd `Stage_Last_Updated`. */
  stageUpdatedAt: string | null;
  classification: VerificationClientStage;
  /** `Credit_Decision` free text ("Approved-Requested", "Declined-Prepay/Secured Only", …). */
  creditDecision: string | null;
  /** `Credit_Score`. 0 is treated as "not scored" — the field is 0-filled on undecided applications. */
  creditScore: number | null;
  /** `Credit_Limit` (text in CRM) parsed to a number where possible. */
  creditLimit: number | null;
  /** `Credit_Line_Approved` currency. */
  creditLineApproved: number | null;
  /** `Risk_Score` picklist: High / Medium / Low. */
  riskScore: string | null;
  /** `CreditSafe_Grade` picklist: A–E. */
  creditSafeGrade: string | null;
  moneyCodeLimit: number | null;
  billingCycle: string | null;
  /** `Payment_Type_Billing`: Line of Credit / Prepay / Deposit / Secured Line of Credit. */
  paymentTerms: string | null;
  companyVerification: string | null;
  billingVerification: string | null;
  lovesVerification: string | null;
  verified: boolean;
  limitsAdded: boolean;
  rejectReason: string | null;
  verificationNotes: string | null;
  cardsRequested: number | null;
  applicationId: string | null;
  dot: string | null;
  mc: string | null;
  agentName: string;
  modifiedAt: string | null;
  /** Filled by the route from the live-verification provider. */
  attentionCount: number;
  verificationStatus: string | null;
  verificationUpdatedAt: string | null;
}

export interface VerificationClientPage {
  clients: VerificationClient[];
  total: number;
  /** True when the owner's application history exceeded the drain cap. */
  truncated: boolean;
}

const str = (v: unknown): string => (v == null ? '' : String(v).trim());
const strOrNull = (v: unknown): string | null => {
  const s = str(v);
  return !s || s === '-None-' ? null : s;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
/**
 * A score of 0 means "no score on file", not a credit score of zero — undecided applications come
 * back 0-filled, and rendering "0" next to a real 688 reads as a catastrophic score.
 */
const scoreOrNull = (v: unknown): number | null => {
  const n = numOrNull(v);
  return n == null || n <= 0 ? null : n;
};
const dateOrNull = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.slice(0, 10) : null;
};
/** A Zoho lookup arrives as `{name, id}`. */
const lookupName = (v: unknown): string | null => {
  if (v && typeof v === 'object' && 'name' in v) return strOrNull((v as { name?: unknown }).name);
  return strOrNull(v);
};

/** Stages that mean the client is live on cards — read-only current terms, not an open pipeline. */
const ACTIVE_STAGES = new Set([
  'card swiped',
  'card funded',
  'cards activated',
  'cards delivered',
  'closed won',
]);

/** Classify from Zoho `Stage`. Drives which panel the detail view opens with. */
function classify(row: CrmDealRow): VerificationClientStage {
  const stage = str(row.Stage).toLowerCase();
  if (stage.startsWith('closed lost')) return 'closed';
  if (ACTIVE_STAGES.has(stage)) return 'active';
  return 'in_pipeline';
}

/** Map one COQL row onto the DTO the Sales tab renders. */
export function toVerificationClient(row: CrmDealRow): VerificationClient {
  return {
    dealId: strOrNull(row.id),
    carrierId: strOrNull(row.Carrier_ID),
    companyName: lookupName(row.Account_Name) ?? str(row.Deal_Name) ?? '',
    dealName: str(row.Deal_Name),
    appFillDate: dateOrNull(row.Application_Date),
    dealStage: str(row.Stage) || '—',
    applicationStage: strOrNull(row.Application_Stage),
    applicationStatus: strOrNull(row.Application_Status),
    stageUpdatedAt: dateOrNull(row.Stage_Last_Updated),
    classification: classify(row),
    creditDecision: strOrNull(row.Credit_Decision),
    creditScore: scoreOrNull(row.Credit_Score),
    creditLimit: numOrNull(row.Credit_Limit),
    creditLineApproved: numOrNull(row.Credit_Line_Approved),
    riskScore: strOrNull(row.Risk_Score),
    creditSafeGrade: strOrNull(row.CreditSafe_Grade),
    moneyCodeLimit: numOrNull(row.Money_Code_Limit),
    billingCycle: strOrNull(row.Billing_Cycle),
    paymentTerms: strOrNull(row.Payment_Type_Billing),
    companyVerification: strOrNull(row.Company_Verification),
    billingVerification: strOrNull(row.Billing_Verification),
    lovesVerification: strOrNull(row.Loves_Verification),
    verified: row.Verified === true,
    limitsAdded: row.Limits_Added === true,
    rejectReason: strOrNull(row.Reject_reason),
    verificationNotes: strOrNull(row.Verification_Notes),
    cardsRequested: numOrNull(row.Cards_Requested),
    applicationId: strOrNull(row.Application_ID),
    dot: strOrNull(row.DOT1),
    mc: /^[A-Za-z]{0,3}[-\s]?\d{3,}$/.test(str(row.MC)) ? str(row.MC) : null,
    agentName: lookupName(row.Owner) ?? '',
    modifiedAt: strOrNull(row.Modified_Time),
    attentionCount: 0,
    verificationStatus: null,
    verificationUpdatedAt: null,
  };
}

/** Fields a free-text search should look at. */
function haystack(client: VerificationClient): string {
  return [
    client.companyName,
    client.dealName,
    client.dealStage,
    client.applicationStage,
    client.applicationStatus,
    client.creditDecision,
    client.carrierId,
    client.applicationId,
    client.dot,
    client.mc,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/**
 * One page of the caller's applications, freshest application date first.
 *
 * Owner scoping is by Zoho user id — the caller resolves it, and an id that is not the session's own
 * is only reachable through the route's admin/act-as check.
 */
function paginate(
  clients: VerificationClient[],
  truncated: boolean,
  page?: number,
  pageSize?: number,
): VerificationClientPage {
  const p = Math.max(page ?? 1, 1);
  const ps = Math.min(Math.max(pageSize ?? 9, 1), 24);
  const offset = (p - 1) * ps;
  return { clients: clients.slice(offset, offset + ps), total: clients.length, truncated };
}

/** All matched applications for one agent (search-filtered, NOT paginated) — for state filtering. */
export async function listAgentVerificationDeals(
  ownerZohoUserId: string,
  options: { search?: string } = {},
): Promise<{ clients: VerificationClient[]; truncated: boolean }> {
  const owner = ownerZohoUserId?.trim();
  if (!owner) return { clients: [], truncated: false };
  const search = options.search?.trim().toLowerCase() ?? '';
  const { rows, truncated } = await fetchAgentVerificationDeals(owner);
  const all = rows.map(toVerificationClient);
  return { clients: search ? all.filter((client) => haystack(client).includes(search)) : all, truncated };
}

export async function getAgentVerificationClients(
  ownerZohoUserId: string,
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<VerificationClientPage> {
  const { clients, truncated } = await listAgentVerificationDeals(
    ownerZohoUserId,
    options.search ? { search: options.search } : {},
  );
  return paginate(clients, truncated, options.page, options.pageSize);
}

/** All applications org-wide (admin), search-filtered, NOT paginated — for state filtering. */
export async function listAllVerificationDeals(
  options: { search?: string } = {},
): Promise<{ clients: VerificationClient[]; truncated: boolean }> {
  const search = options.search?.trim().toLowerCase() ?? '';
  const { rows, truncated } = await fetchAllVerificationDeals();
  const all = rows.map(toVerificationClient);
  return { clients: search ? all.filter((client) => haystack(client).includes(search)) : all, truncated };
}

/** One page of ALL applications org-wide (admin roster); the route gates who may call it. */
export async function getAllVerificationClients(
  options: { page?: number; pageSize?: number; search?: string } = {},
): Promise<VerificationClientPage> {
  const { clients, truncated } = await listAllVerificationDeals(options.search ? { search: options.search } : {});
  return paginate(clients, truncated, options.page, options.pageSize);
}

/** One application's verification slice, read fresh from Zoho (detail pane). */
export async function getVerificationClient(dealId: string): Promise<VerificationClient | null> {
  const row = await fetchVerificationDeal(dealId);
  return row ? toVerificationClient(row) : null;
}
