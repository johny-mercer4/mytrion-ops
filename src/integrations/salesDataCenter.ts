/**
 * Sales Data Center — read-only Zoho CRM pulls via COQL, scoped to one sales agent (the CRM
 * record Owner). Backs the Sales Mytrion "Data Center" tab (Leads / Deals / Rejections).
 *
 * All three queries filter `Owner = '<zohoUserId>'` (the org's live COQL convention — a bare
 * `Owner` compared to the user-id string; see the servercrm reference). Rejections come from the
 * Deals module (the Applications module carries no Owner), filtered to lost/declined states.
 *
 * Field API names + the rejection-state values were verified against the live org's field
 * metadata (`/settings/fields`) and by probing `/coql` directly — do not edit them blindly, a
 * single unknown column makes COQL 400 the whole query (`INVALID_QUERY`).
 */
import { runCoql } from './zohoCrm.js';

/** Selected Lead fields (validated queryable). Lookups (Owner) come back as `{name,id}`. */
const LEAD_FIELDS =
  'id, Company, Full_Name, Designation, Phone, Email, Annual_Revenue, Trucks, Lead_Source, ' +
  'Status, Rating, Last_Activity_Time, Modified_Time, Description';

/** Selected Deal fields (validated queryable). Account_Name/Contact_Name are lookups (`{name,id}`). */
const DEAL_FIELDS =
  'id, Deal_Name, Account_Name, Amount, Credit_Line_Approved, Cards_Requested, Stage, Probability, ' +
  'Closing_Date, Contact_Name, First_name, Last_Name, Phone, Cell, Email, Application_ID, Carrier_ID, ' +
  'Modified_Time, Description';

/** Selected Deal fields for the rejection report. */
const REJECTION_FIELDS =
  'id, Deal_Name, Account_Name, Application_ID, Reason_For_Loss__s, Reject_reason, Credit_Decision, ' +
  'Application_Status, Stage, Modified_Time, Carrier_ID';

/** Deal states that mean "rejected/declined" for the rejection report. */
const REJECTED_STAGES = ['Closed Lost', 'Closed Lost to Competition'];
const REJECTED_APP_STATUSES = ['Disqualified', 'Closed/Lost', 'Closed/Fraud'];

export type CrmRow = Record<string, unknown>;

/** Zoho user ids are numeric strings; refuse anything else so it can't be smuggled into COQL. */
function assertOwnerId(ownerId: string): string {
  if (!/^\d+$/.test(ownerId)) {
    throw new Error(`[data-center] invalid owner id: ${ownerId.slice(0, 40)}`);
  }
  return ownerId;
}

/** Bound the row count to COQL's per-page max (200). */
function clampLimit(limit: number): number {
  return Math.min(200, Math.max(1, Math.trunc(limit) || 200));
}

/** The agent's Leads (newest-modified first). */
export async function fetchAgentLeads(ownerId: string, limit = 200): Promise<CrmRow[]> {
  const uid = assertOwnerId(ownerId);
  const q = `select ${LEAD_FIELDS} from Leads where Owner = '${uid}' order by Modified_Time desc limit 0, ${clampLimit(limit)}`;
  return (await runCoql(q)).rows;
}

/** The agent's Deals (newest-modified first). */
export async function fetchAgentDeals(ownerId: string, limit = 200): Promise<CrmRow[]> {
  const uid = assertOwnerId(ownerId);
  const q = `select ${DEAL_FIELDS} from Deals where Owner = '${uid}' order by Modified_Time desc limit 0, ${clampLimit(limit)}`;
  return (await runCoql(q)).rows;
}

/** The agent's rejected/declined Deals (the rejection report). */
export async function fetchAgentRejections(ownerId: string, limit = 200): Promise<CrmRow[]> {
  const uid = assertOwnerId(ownerId);
  const stages = REJECTED_STAGES.map((s) => `'${s}'`).join(', ');
  const statuses = REJECTED_APP_STATUSES.map((s) => `'${s}'`).join(', ');
  const where = `Owner = '${uid}' and ((Stage in (${stages})) or (Application_Status in (${statuses})))`;
  const q = `select ${REJECTION_FIELDS} from Deals where ${where} order by Modified_Time desc limit 0, ${clampLimit(limit)}`;
  return (await runCoql(q)).rows;
}
