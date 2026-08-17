/**
 * Zoho read layer for the CS Applications list (replaces the `mytrionGetApplications` Deluge
 * dependency for `cs.applications.list` — see applicationsList.ts for the cache/orchestration
 * layer that calls these). Two independent drains:
 *   - `drainApplications()` — the Applications module itself, both tabs (Apps-in-process/Clients
 *     split on `Carrier_ID` is a one-line predicate the caller applies, not a query param here).
 *   - `drainDeals()` — every Deal that carries an `Application_ID`, for the "Agent (Deal)"
 *     enrichment. COQL has no join across unrelated modules and `Applications.Related_Deal` (the
 *     lookup field labeled "Agent (Owner)") is empty on every record checked live — the real match
 *     key is `Applications.Application_ID` = `Deals.Application_ID`, so this drains Deals once and
 *     the caller joins in memory. `Deals.Owner.name` alone is not the display name shown elsewhere
 *     in this app (verified live: a Deal's raw Owner name can be a bare last name, e.g. "Mamurov",
 *     while the org's full display name is "Islombek Mamurov") — `resolveOwnerNames` overlays the
 *     CRM Users list to fix that, falling back to the raw name for a deactivated owner (absent from
 *     `listActiveUsers`).
 *
 * Field lists are exactly what `mapAppRow` (apps/mytrion-crm/.../live.ts) reads — verified against
 * live `/settings/fields` metadata and a live Deluge response; nothing here is speculative. Fields
 * the Deluge response carries but the frontend view-model never reads (Verification_Notes,
 * Tracking_Number, Billing_Form_Y_N, Oldest_Open_Date, Status, Modified_By/Time, Created_Time) are
 * deliberately not selected. `Cards_Ordered` is deliberately not replicated — confirmed dead in the
 * Deluge source itself (set, never filled) and `Cards_Requested` is the field the UI actually reads.
 */
import { zohoCrm, type CrmUser } from './zohoCrm.js';

/** One raw Applications row, keyed exactly as `mapAppRow` expects (plus the `_dealOwner` overlay). */
export interface RawApplicationRow {
  id: string;
  Application_ID: number | null;
  Name: string | null;
  First_Name: string | null;
  Last_Name: string | null;
  Type_of_Business: string | null;
  Stage: string | null;
  WEX_Status: string | null;
  emc: string | null;
  DOT: string | null;
  Phone: string | null;
  Email: string | null;
  Address: string | null;
  City: string | null;
  State: string | null;
  Zip_Code: string | null;
  Credit_Score: number | null;
  Number_of_Trucks: number | null;
  Cards_Requested: number | null;
  Date_Filled: string | null;
  Customer_Service_Notes: string | null;
  Billing_Cycle: string | null;
  Email_to_TA: boolean | null;
  TA_EFS_Added: boolean | null;
  Limits_Added: boolean | null;
  Mobile_Driver_App: boolean | null;
  Chain_Policy: boolean | null;
  Verified: boolean | null;
  Carrier_ID: string | null;
  /** Deal-owner enrichment, joined in from `drainDeals()` by `Application_ID` — never present on
   *  the raw Applications row itself. `null` means no matching Deal (renders "not assigned"). */
  _dealOwner: { id: string; name: string } | null;
  Payment_Type_Billing: string | null;
  Loves_Verification: string | null;
}

const APPLICATION_FIELDS = [
  'id', 'Application_ID', 'Name', 'First_Name', 'Last_Name', 'Type_of_Business', 'Stage',
  'WEX_Status', 'emc', 'DOT', 'Phone', 'Email', 'Address', 'City', 'State', 'Zip_Code',
  'Credit_Score', 'Number_of_Trucks', 'Cards_Requested', 'Date_Filled', 'Customer_Service_Notes',
  'Billing_Cycle', 'Email_to_TA', 'TA_EFS_Added', 'Limits_Added', 'Mobile_Driver_App',
  'Chain_Policy', 'Verified', 'Carrier_ID',
].join(', ');

/** Drain guard — well above the ~12,200 live count (2026-08-13), far below anything that would
 *  make the in-memory snapshot design (applicationsSnapshotCache.ts) unsound. */
const MAX_ROWS = 60_000;
const DRAIN_BUDGET_MS = 60_000;

/**
 * Every Applications row (both tabs). `order by id asc` is deliberate, not `Created_Time desc`:
 * `runCoqlAll`'s own doc-comment warns offset-paging a non-unique order silently duplicates/skips
 * rows across page boundaries, and `id` is the cheapest column guaranteed unique on every module.
 * The visible order is entirely re-derived downstream (applicationsListQuery.ts), so the drain
 * order itself is otherwise irrelevant.
 */
export async function drainApplications(): Promise<{ rows: RawApplicationRow[]; truncated: boolean }> {
  // COQL rejects a query with no WHERE clause at all (confirmed live) — `id is not null` is an
  // always-true condition that satisfies the syntax requirement without narrowing the result.
  const res = await zohoCrm.runCoqlAll(
    `select ${APPLICATION_FIELDS} from Applications where id is not null order by id asc`,
    { pageSize: 2000, maxRows: MAX_ROWS, budgetMs: DRAIN_BUDGET_MS },
  );
  const rows = res.rows.map((r) => ({
    id: String(r.id),
    Application_ID: numOrNull(r.Application_ID),
    Name: strOrNull(r.Name),
    First_Name: strOrNull(r.First_Name),
    Last_Name: strOrNull(r.Last_Name),
    Type_of_Business: strOrNull(r.Type_of_Business),
    Stage: strOrNull(r.Stage),
    WEX_Status: strOrNull(r.WEX_Status),
    emc: strOrNull(r.emc),
    DOT: strOrNull(r.DOT),
    Phone: strOrNull(r.Phone),
    Email: strOrNull(r.Email),
    Address: strOrNull(r.Address),
    City: strOrNull(r.City),
    State: strOrNull(r.State),
    Zip_Code: strOrNull(r.Zip_Code),
    Credit_Score: numOrNull(r.Credit_Score),
    Number_of_Trucks: numOrNull(r.Number_of_Trucks),
    Cards_Requested: numOrNull(r.Cards_Requested),
    Date_Filled: strOrNull(r.Date_Filled),
    Customer_Service_Notes: strOrNull(r.Customer_Service_Notes),
    Billing_Cycle: strOrNull(r.Billing_Cycle),
    Email_to_TA: boolOrNull(r.Email_to_TA),
    TA_EFS_Added: boolOrNull(r.TA_EFS_Added),
    Limits_Added: boolOrNull(r.Limits_Added),
    Mobile_Driver_App: boolOrNull(r.Mobile_Driver_App),
    Chain_Policy: boolOrNull(r.Chain_Policy),
    Verified: boolOrNull(r.Verified),
    Carrier_ID: strOrNull(r.Carrier_ID),
    _dealOwner: null,
    Payment_Type_Billing: null,
    Loves_Verification: null,
  }));
  return { rows, truncated: res.truncated };
}

export interface DealEnrichment {
  owner: { id: string; name: string } | null;
  Payment_Type_Billing: string | null;
  Loves_Verification: string | null;
}

function dealEnrichmentOf(r: Record<string, unknown>): DealEnrichment {
  const owner = r.Owner as { id?: unknown; name?: unknown } | null;
  return {
    owner: owner?.id ? { id: String(owner.id), name: strOrNull(owner.name) ?? '' } : null,
    Payment_Type_Billing: strOrNull(r.Payment_Type_Billing),
    Loves_Verification: strOrNull(r.Loves_Verification),
  };
}

/** Every Deal that carries an `Application_ID`, keyed for the in-memory join. */
export async function drainDeals(): Promise<{ byApplicationId: Map<number, DealEnrichment>; truncated: boolean }> {
  const res = await zohoCrm.runCoqlAll(
    `select Application_ID, Owner, Payment_Type_Billing, Loves_Verification from Deals where Application_ID is not null order by id asc`,
    { pageSize: 2000, maxRows: MAX_ROWS, budgetMs: DRAIN_BUDGET_MS },
  );
  const byApplicationId = new Map<number, DealEnrichment>();
  for (const r of res.rows) {
    const appId = numOrNull(r.Application_ID);
    if (appId === null) continue;
    byApplicationId.set(appId, dealEnrichmentOf(r));
  }
  return { byApplicationId, truncated: res.truncated };
}

/** Zoho COQL's `in (...)` operator is capped at 100 values. */
const NAME_IN_BATCH_SIZE = 100;

/**
 * Fallback join for Applications whose `Application_ID` matched no Deal — mirrors the old
 * `mytrionGetApplications` Deluge function's own second-phase match (exact `Deals.Deal_Name`
 * equality against the Application's company `Name`), batched the same way it was: `IN (...)`
 * clauses of up to 100 names. First Deal returned for a given name wins (parity with the old
 * function, which had the same "first match" rule on its side of this join). Callers must exclude
 * names containing an apostrophe before calling — same restriction the old Deluge function placed
 * on itself, since neither side of this ports Zoho COQL string-literal escaping.
 */
export async function matchDealsByName(names: string[]): Promise<Map<string, DealEnrichment>> {
  const byName = new Map<string, DealEnrichment>();
  for (let i = 0; i < names.length; i += NAME_IN_BATCH_SIZE) {
    const batch = names.slice(i, i + NAME_IN_BATCH_SIZE);
    const clause = batch.map((n) => `'${n}'`).join(',');
    const res = await zohoCrm.runCoql(
      `select Deal_Name, Owner, Payment_Type_Billing, Loves_Verification from Deals where Deal_Name in (${clause}) limit 0,200`,
    );
    for (const r of res.rows) {
      const name = strOrNull(r.Deal_Name);
      if (!name || byName.has(name)) continue;
      byName.set(name, dealEnrichmentOf(r));
    }
  }
  return byName;
}

/**
 * A Deal's raw `Owner.name` can be a bare last name, or entirely missing once its owner is
 * deactivated (verified live: one deal returned `Owner: {id, name: null}` for a departed agent) —
 * overlay `listUsersForNameResolution()` (active + deactivated) to get the same full name the old
 * Deluge enrichment showed. Best-effort: any lookup failure just keeps the raw (possibly blank or
 * abbreviated) Deal Owner name rather than failing the whole list.
 */
export async function resolveOwnerNames(
  owners: Array<{ id: string; name: string }>,
): Promise<Map<string, string>> {
  const byId = new Map(owners.map((o) => [o.id, o.name]));
  if (byId.size === 0) return byId; // nothing to resolve — skip the Users API round-trip
  try {
    const users: CrmUser[] = await zohoCrm.listUsersForNameResolution();
    for (const u of users) {
      if (byId.has(u.zohoUserId) && u.name) byId.set(u.zohoUserId, u.name);
    }
  } catch {
    // Best-effort overlay — the raw (possibly abbreviated) Deal Owner name is still a real name.
  }
  return byId;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = typeof v === 'object' ? null : String(v);
  return s && s.length > 0 ? s : null;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (v === null || v === undefined) return null;
  return v === true || v === 'true';
}
