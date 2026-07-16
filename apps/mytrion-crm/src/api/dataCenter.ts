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
