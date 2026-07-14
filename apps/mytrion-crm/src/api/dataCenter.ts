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

// The Data Center endpoints are Sales-Mytrion-scoped; assert the department so a signed-in Sales
// agent (whose session carries no department by default) clears the route's sales-access gate.
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
