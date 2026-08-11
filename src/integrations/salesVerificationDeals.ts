/**
 * Sales Verification Pipeline source — read-only Zoho CRM Deals via COQL, scoped to one sales agent
 * (the CRM record Owner).
 *
 * This REPLACES the previous `octane.agent_deals` + `octane.dim_company` DWH read. The warehouse was
 * a lagging copy keyed on an agent DISPLAY NAME (no Zoho user id), so a rename or a name that did not
 * match the warehouse silently produced an empty pipeline, and every verification field an agent
 * actually needs — Stage, Application_Stage, Credit_Decision, Credit_Score — lives in Zoho and was
 * either absent from the warehouse or stale. Zoho is the source of truth for the application, so the
 * pipeline reads it directly and is owner-scoped by id.
 *
 * Field API names were verified against this org's live `/settings/fields` metadata AND probed
 * through `/coql`. Two are traps, do not "fix" them:
 *   - the DOT column on Deals is `DOT1` (`DOT` is a Leads field and 400s here);
 *   - `Stage_Modified_Time` exists in field metadata but is NOT COQL-queryable (`INVALID_QUERY`).
 * A single unknown column makes COQL reject the whole query.
 */
import { zohoCrm } from './zohoCrm.js';

/**
 * The application/verification slice of a Deal. `Verification_Decision` is deliberately absent: it is
 * a `fileupload` field (the decision DOCUMENT), not a decision value — the decision itself is
 * `Credit_Decision` + `Application_Status` + the three *_Verification picklists.
 */
const VERIFICATION_DEAL_FIELDS = [
  'id',
  'Deal_Name',
  'Account_Name',
  'Carrier_ID',
  'MC',
  'DOT1',
  'Owner',
  'Stage',
  'Application_Stage',
  'Application_Status',
  'Application_ID',
  'Application_Date',
  'Stage_Last_Updated',
  'Credit_Score',
  'Credit_Limit',
  'Credit_Line_Approved',
  'Credit_Decision',
  'Risk_Score',
  'CreditSafe_Grade',
  'Money_Code_Limit',
  'Billing_Cycle',
  'Payment_Type_Billing',
  'Company_Verification',
  'Billing_Verification',
  'Loves_Verification',
  'Verified',
  'Limits_Added',
  'Reject_reason',
  'Verification_Notes',
  'Cards_Requested',
  'Modified_Time',
].join(', ');

/** One COQL page. The user-facing contract for this feature: 200 rows per Zoho call. */
export const VERIFICATION_COQL_PAGE_SIZE = 200;
/**
 * Cap on how much of an agent's application history one request will drain (5 × 200). An agent's
 * book is well inside this; the cap exists so a mis-scoped call cannot walk the whole org.
 */
export const VERIFICATION_MAX_ROWS = 1000;

export type CrmDealRow = Record<string, unknown>;

export interface VerificationDealsResult {
  rows: CrmDealRow[];
  /** True when the row cap was hit, so `rows.length` is a floor rather than the exact total. */
  truncated: boolean;
  /** COQL calls spent, for cost reasoning in logs. */
  pages: number;
}

/** Zoho ids are numeric strings; refuse anything else so it can't be smuggled into COQL. */
function assertZohoId(value: string, label: string): string {
  if (!/^\d+$/.test(value)) {
    throw new Error(`[verification] invalid ${label}: ${value.slice(0, 40)}`);
  }
  return value;
}

/**
 * Every Deal owned by this agent that HAS an application, freshest application first.
 *
 * `Application_ID > 0` rather than `Application_ID is not null`: same set on an auto-numbered field,
 * and it sidesteps this org's COQL parser rejecting a trailing `is not null` (see the note in
 * salesDataCenter.fetchAgentApplicationStats). Filtering on `Application_Date` instead would silently
 * drop real work — deals sitting in "Application Filled" with a null Application_Date exist.
 *
 * The `order by` ends in `id` on purpose: offset paging over a non-total order duplicates and skips
 * rows, and Application_Date has huge tie groups (every application filled the same day).
 */
export async function fetchAgentVerificationDeals(
  ownerZohoUserId: string,
): Promise<VerificationDealsResult> {
  const uid = assertZohoId(ownerZohoUserId, 'owner id');
  const base =
    `select ${VERIFICATION_DEAL_FIELDS} from Deals ` +
    `where Owner = '${uid}' and Application_ID > 0 ` +
    'order by Application_Date desc, id desc';
  const { rows, truncated, pages } = await zohoCrm.runCoqlAll(base, {
    pageSize: VERIFICATION_COQL_PAGE_SIZE,
    maxRows: VERIFICATION_MAX_ROWS,
  });
  return { rows, truncated, pages };
}

/** Every application Deal ORG-WIDE (no Owner filter), freshest first, capped at VERIFICATION_MAX_ROWS. */
export async function fetchAllVerificationDeals(): Promise<VerificationDealsResult> {
  const base =
    `select ${VERIFICATION_DEAL_FIELDS} from Deals ` +
    `where Application_ID > 0 ` +
    'order by Application_Date desc, id desc';
  const { rows, truncated, pages } = await zohoCrm.runCoqlAll(base, {
    pageSize: VERIFICATION_COQL_PAGE_SIZE,
    maxRows: VERIFICATION_MAX_ROWS,
  });
  return { rows, truncated, pages };
}

/** One Deal's verification slice — the detail pane's own read, so it never trusts a stale list row. */
export async function fetchVerificationDeal(dealId: string): Promise<CrmDealRow | null> {
  const id = assertZohoId(dealId, 'deal id');
  const { rows } = await zohoCrm.runCoql(
    `select ${VERIFICATION_DEAL_FIELDS} from Deals where id = '${id}' limit 0, 1`,
  );
  return rows[0] ?? null;
}
