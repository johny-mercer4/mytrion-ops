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

/** Selected Lead fields (validated queryable against live `/coql`). Lookups come back as `{name,id}`. */
const LEAD_FIELDS =
  'id, Company, Full_Name, Designation, Phone, Cell, Email, Annual_Revenue, Trucks, Lead_Source, ' +
  'Status, Unqualified_Reason, Not_Interested_Reason, Rating, MC, DOT, Referral_Source, Referred_By, ' +
  'Registration_Time, Web_Registration_Date, ' +
  'Last_Activity_Time, Modified_Time, Created_Time, utm_source, Converted__s, Description';

/** Selected Deal fields (validated queryable). Account_Name/Contact_Name are lookups (`{name,id}`). */
const DEAL_FIELDS =
  'id, Deal_Name, Account_Name, Amount, Credit_Line_Approved, Cards_Requested, Stage, Probability, ' +
  'Closing_Date, Contact_Name, First_name, Last_Name, Phone, Cell, Email, Secondary_Email, Application_ID, Carrier_ID, ' +
  'Application_Date, Created_Time, utm_source, Modified_Time, Description';

export type CrmRow = Record<string, unknown>;

/** Zoho user ids are numeric strings; refuse anything else so it can't be smuggled into COQL. */
function assertOwnerId(ownerId: string): string {
  if (!/^\d+$/.test(ownerId)) {
    throw new Error(`[data-center] invalid owner id: ${ownerId.slice(0, 40)}`);
  }
  return ownerId;
}

/** Bound the row count. COQL accepts up to 2000 rows per query (bulk), so pull the full set. */
function clampLimit(limit: number): number {
  return Math.min(2000, Math.max(1, Math.trunc(limit) || 2000));
}

/** The agent's Leads (newest-modified first). */
export async function fetchAgentLeads(ownerId: string, limit = 2000): Promise<CrmRow[]> {
  const uid = assertOwnerId(ownerId);
  const q = `select ${LEAD_FIELDS} from Leads where Owner = '${uid}' order by Modified_Time desc limit 0, ${clampLimit(limit)}`;
  return (await runCoql(q)).rows;
}

/** The agent's Deals (newest-modified first). */
export async function fetchAgentDeals(ownerId: string, limit = 2000): Promise<CrmRow[]> {
  const uid = assertOwnerId(ownerId);
  const q = `select ${DEAL_FIELDS} from Deals where Owner = '${uid}' order by Modified_Time desc limit 0, ${clampLimit(limit)}`;
  return (await runCoql(q)).rows;
}

/**
 * Applications-filled per calendar day for one agent, read from the CRM `Application_Date` field
 * (a `date` field → values come back as 'YYYY-MM-DD'). Powers the Home daily-goal bar + streak.
 * Owner-scoped like the other pulls; one COQL query, bucketed server-side into a day→count map.
 */
export interface AgentAppStats {
  /** 'YYYY-MM-DD' → applications filled that day (only non-empty days present). */
  days: Record<string, number>;
  /** Total applications in the window. */
  total: number;
  /** Trailing window size in days. */
  windowDays: number;
  /** True if the 2000-row cap was hit (oldest days may be incomplete — recent days are exact). */
  truncated: boolean;
}

const APP_STATS_WINDOW_DAYS = 90;
const NY_TZ = 'America/New_York';

/**
 * yyyy-MM-dd for `n` NY-calendar days ago. Steps back in UTC (no DST) off today's NY date, so the
 * `since` bound never drifts across a day boundary on a DST-transition morning.
 */
function nyDaysAgoIso(n: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: NY_TZ }).format(new Date());
  const base = Date.parse(`${today}T00:00:00Z`) - n * 86_400_000;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(base));
}

/** The agent's per-day application-fill counts over the trailing window (by `Application_Date`). */
export async function fetchAgentApplicationStats(
  ownerId: string,
  windowDays = APP_STATS_WINDOW_DAYS,
): Promise<AgentAppStats> {
  const uid = assertOwnerId(ownerId);
  const since = nyDaysAgoIso(Math.max(1, Math.trunc(windowDays)));
  // `Application_Date >= since` also excludes null dates (null is never >= a value). Mirror the prod
  // COQL shape exactly — bare `Owner = '<uid>'` and the offset-form `limit 0, N` (a bare `limit N`
  // and a trailing `is not null` both 400 on this org's parser).
  const q = `select Application_Date from Deals where Owner = '${uid}' and Application_Date >= '${since}' order by Application_Date desc limit 0, 2000`;
  const { rows, moreRecords } = await runCoql(q);
  const days: Record<string, number> = {};
  for (const row of rows) {
    const raw = row.Application_Date;
    const day = typeof raw === 'string' ? raw.slice(0, 10) : '';
    if (day) days[day] = (days[day] ?? 0) + 1;
  }
  return { days, total: rows.length, windowDays, truncated: moreRecords === true };
}

/**
 * A Deal's Owner id (lookup `Owner` comes back as `{name,id}`), or null when the deal doesn't
 * exist. Backs the ticket-create ownership check: a non-admin may only file tickets on their
 * own deals. Record ids are numeric strings — reuse the owner-id assertion so a caller-supplied
 * dealId can't be smuggled into COQL.
 */
export async function fetchDealOwnerId(dealId: string): Promise<string | null> {
  const id = assertOwnerId(dealId);
  const { rows } = await runCoql(`select Owner from Deals where id = '${id}' limit 0, 1`);
  const owner = rows[0]?.Owner;
  if (owner && typeof owner === 'object' && 'id' in owner) {
    return String((owner as { id: unknown }).id ?? '') || null;
  }
  return null;
}

/**
 * A Lead's Owner id — mirror of {@link fetchDealOwnerId} for the Lead inline-edit ownership check
 * (a non-admin may only edit their own leads). Returns null when the lead doesn't exist.
 */
export async function fetchLeadOwnerId(leadId: string): Promise<string | null> {
  const id = assertOwnerId(leadId);
  const { rows } = await runCoql(`select Owner from Leads where id = '${id}' limit 0, 1`);
  const owner = rows[0]?.Owner;
  if (owner && typeof owner === 'object' && 'id' in owner) {
    return String((owner as { id: unknown }).id ?? '') || null;
  }
  return null;
}
