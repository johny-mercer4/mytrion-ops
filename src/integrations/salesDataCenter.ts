/**
 * Sales Data Center — read-only Zoho CRM pulls via COQL, scoped to one sales agent (the CRM
 * record Owner). Backs the Sales Mytrion "Data Center" tab's Leads + Deals. (Rejection reports come
 * from Zoho Desk — see zohoDesk.listRejectionReportTickets — not from CRM.)
 *
 * Both queries filter `Owner = '<zohoUserId>'` (the org's live COQL convention — a bare `Owner`
 * compared to the user-id string; see the servercrm reference). Field API names were verified
 * against the live org's field metadata (`/settings/fields`) and by probing `/coql` directly — do
 * not edit them blindly, a single unknown column makes COQL 400 the whole query (`INVALID_QUERY`).
 */
import { runCoql } from './zohoCrm.js';

/** Selected Lead fields (validated queryable). Lookups (Owner) come back as `{name,id}`. */
const LEAD_FIELDS =
  'id, Company, Full_Name, Designation, Phone, Email, Annual_Revenue, Trucks, Lead_Source, ' +
  'Status, Rating, Last_Activity_Time, Modified_Time, Created_Time, utm_source, Converted__s, Description';

/** Selected Deal fields (validated queryable). Account_Name/Contact_Name are lookups (`{name,id}`). */
const DEAL_FIELDS =
  'id, Deal_Name, Account_Name, Amount, Credit_Line_Approved, Cards_Requested, Stage, Probability, ' +
  'Closing_Date, Contact_Name, First_name, Last_Name, Phone, Cell, Email, Application_ID, Carrier_ID, ' +
  'Application_Date, Created_Time, utm_source, Modified_Time, Description';

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
