/**
 * Sales Data Center client (/v1/data-center) — the Data Center tab's Leads / Deals / Rejections,
 * read from Zoho CRM via COQL server-side. Every pull is creator/owner-scoped to the caller's CRM
 * user id (admins may target an agent with ?zoho_user_id, honoured server-side).
 *
 * Rows are raw Zoho COQL records (field API names as-is); the redesign's dataCenterLive adapters
 * map them to view-model shapes. Lookup fields (Owner/Account_Name/Contact_Name) arrive as
 * `{ name, id }` objects.
 */
import { request } from './transport';
import type { LoyaltyStat } from '@/mytrions/sales/redesign/loyalty';

// LEGACY assertion — the server now derives department access from the verified session (Zoho
// profile/role), so this header is IGNORED for signed-in users. Kept only so the
// FF_SESSION_DEPT_AUTHORITATIVE=0 rollback (and unverified API-key dev calls) stay functional;
// remove together with the flag.
const DC_HEADERS = { 'x-department-access': 'sales' } as const;

export type CrmRow = Record<string, unknown>;

async function get(path: string, zohoUserId?: string): Promise<CrmRow[]> {
  const res = (await request('GET', path, {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as Record<string, CrmRow[] | undefined>;
  // Each endpoint returns a single keyed array ({leads}|{deals}|{rejections}); take the first.
  const first = Object.values(res).find(Array.isArray);
  return first ?? [];
}

export function listLeads(zohoUserId?: string): Promise<CrmRow[]> {
  return get('/data-center/leads', zohoUserId);
}

export function listDeals(zohoUserId?: string): Promise<CrmRow[]> {
  return get('/data-center/deals', zohoUserId);
}

export function listRejections(zohoUserId?: string): Promise<CrmRow[]> {
  return get('/data-center/rejections', zohoUserId);
}

/** Per-day applications-filled counts (by CRM `Application_Date`) for the caller — Home goal bar +
 *  streak. Returns an object (not a keyed array), so it bypasses the get() array-unwrapper. */
export interface AppStats {
  /** 'YYYY-MM-DD' → applications filled that day. */
  days: Record<string, number>;
  total: number;
  windowDays: number;
  truncated: boolean;
}

export async function getAppStats(zohoUserId?: string): Promise<AppStats> {
  return (await request('GET', '/data-center/app-stats', {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as AppStats;
}

/** Per-client (carrierId) loyalty stats for the caller — Data Center → Clients tier + rewards. The
 *  route wraps the map in `{ stats }`; unwrap to the raw carrierId→stat record. */
export type LoyaltyStats = Record<string, LoyaltyStat>;

export async function getLoyaltyStats(zohoUserId?: string): Promise<LoyaltyStats> {
  const res = (await request('GET', '/data-center/loyalty-stats', {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as { stats?: LoyaltyStats };
  return res.stats ?? {};
}

/** Result of an owner-scoped inline edit — the record id + the exact CRM fields that changed. */
export interface UpdateResult {
  id: string;
  updatedFields: string[];
}

/** Editable Lead fields (exact Zoho API names). '' clears a field; DOT is numeric-or-string. */
export type LeadEditFields = Partial<
  Record<'MC' | 'DOT' | 'Referral_Source' | 'Cell' | 'Phone' | 'Email' | 'Description', string | number | null>
>;
/** Editable Deal fields (exact Zoho API names). */
export type DealEditFields = Partial<Record<'Email' | 'Phone' | 'Description', string | null>>;

/** Owner-scoped edit of a Lead (server re-checks the record Owner). Admins acting-as an agent pass
 *  their impersonation `zohoUserId` so the owner check targets that agent's records. */
export function updateLead(id: string, changes: LeadEditFields, zohoUserId?: string): Promise<UpdateResult> {
  return request('PATCH', `/data-center/leads/${encodeURIComponent(id)}`, {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
    body: changes,
  }) as Promise<UpdateResult>;
}

/** Owner-scoped edit of a Deal (Email/Phone/Notes). */
export function updateDeal(id: string, changes: DealEditFields, zohoUserId?: string): Promise<UpdateResult> {
  return request('PATCH', `/data-center/deals/${encodeURIComponent(id)}`, {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
    body: changes,
  }) as Promise<UpdateResult>;
}
