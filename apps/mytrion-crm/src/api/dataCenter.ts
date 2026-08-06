/**
 * Sales Data Center client (/v1/data-center) — the Data Center tab's Leads / Deals / Rejections,
 * read from Zoho CRM via COQL server-side. Every pull is creator/owner-scoped to the caller's CRM
 * user id (admins may target an agent with ?zoho_user_id, honoured server-side).
 *
 * Rows are raw Zoho COQL records (field API names as-is); the redesign's dataCenterLive adapters
 * map them to view-model shapes. Lookup fields (Owner/Account_Name/Contact_Name) arrive as
 * `{ name, id }` objects.
 */
import { request, requestMultipart } from './transport';
import type { LoyaltyClientOverride } from './loyalty';

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

// ---- Per-record call history + Notes (Zoho Notes module) ----

export interface CallHistoryItem {
  source: 'mytrion' | 'zoho';
  id: string;
  when: string;
  whenTs: number;
  durationSeconds: number | null;
  status: string;
  label: string;
  number: string;
}

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  owner: string;
}

type RecordKind = 'leads' | 'deals';

async function getKeyed<T>(path: string, key: string, zohoUserId?: string): Promise<T[]> {
  const res = (await request('GET', path, {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as Record<string, T[] | undefined>;
  return res[key] ?? [];
}

/** Merged call history for a Lead/Deal (our mytrion_calls + the Zoho Calls), badged by `source`. */
export function listRecordCalls(kind: RecordKind, id: string, zohoUserId?: string): Promise<CallHistoryItem[]> {
  return getKeyed<CallHistoryItem>(`/data-center/${kind}/${id}/calls`, 'calls', zohoUserId);
}

/** Existing Zoho Notes on a Lead/Deal. */
export function listRecordNotes(kind: RecordKind, id: string, zohoUserId?: string): Promise<NoteItem[]> {
  return getKeyed<NoteItem>(`/data-center/${kind}/${id}/notes`, 'notes', zohoUserId);
}

/** Log a Zoho Note (content + optional title + optional attachment) on a Lead/Deal. */
export async function createRecordNote(
  kind: RecordKind,
  id: string,
  input: { content: string; title?: string },
  file?: File | null,
  zohoUserId?: string,
): Promise<{ id: string; hasAttachment: boolean }> {
  const form = new FormData();
  form.append('content', input.content);
  if (input.title) form.append('title', input.title);
  if (file) form.append('file', file, file.name);
  const qs = zohoUserId ? `?zoho_user_id=${encodeURIComponent(zohoUserId)}` : '';
  return (await requestMultipart(`/data-center/${kind}/${id}/notes${qs}`, form, {
    headers: DC_HEADERS,
  })) as { id: string; hasAttachment: boolean };
}

/** Per-day applications-filled counts (by CRM `Application_Date` — "application filled") for the
 *  caller — Home goal bar + streak. Returns an object (not a keyed array), so it bypasses the get()
 *  array-unwrapper. Always pass `zohoUserId` from the session / act-as target (same as Deals). */
export interface AppStats {
  /** 'YYYY-MM-DD' → applications filled that day. */
  days: Record<string, number>;
  total: number;
  windowDays: number;
  truncated: boolean;
}

export async function getAppStats(zohoUserId?: string): Promise<AppStats> {
  const res = (await request('GET', '/data-center/app-stats', {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as Partial<AppStats> | null;
  if (!res || typeof res !== 'object' || res.days == null || typeof res.days !== 'object') {
    throw new Error('App stats response missing days map');
  }
  const days: Record<string, number> = {};
  for (const [k, v] of Object.entries(res.days)) {
    const n = typeof v === 'number' ? v : Number(v);
    if (k && Number.isFinite(n) && n > 0) days[k] = n;
  }
  return {
    days,
    total: typeof res.total === 'number' ? res.total : Object.values(days).reduce((a, b) => a + b, 0),
    windowDays: typeof res.windowDays === 'number' ? res.windowDays : 90,
    truncated: res.truncated === true,
  };
}

/**
 * One client roster row from `GET /data-center/clients` — the Data Center → Clients tab's sole source.
 * Backed by ONE DWH query (dim_company + mart_transaction_line_items + cmp_invoice): carrier metadata,
 * computed debt/activity overlays, and cycle / this-month / prev-month gallons + card counts. Mirrors
 * the backend `AgentClientRow`. Debt is the DWH `cmp_invoice` snapshot (~3h refresh), not live CMP.
 */
export interface AgentClient {
  carrierId: string;
  companyName: string;
  contact: string;
  phone: string;
  producedCards: number;
  activeCards: number;
  lastTierName: string;
  moneyCode: string;
  /** Declared fleet size — reference only; loyalty tracks use monthly transacting cards. */
  trucks: number | null;
  dot: string;
  isLocSuspended: boolean;
  computedIsActive: boolean;
  computedDebt: number;
  computedDebtDays: number;
  /** This billing-cycle (26th→25th) gallons — the "Gallons · Cycle" figure. */
  cycleGallons: number;
  gallonsThisMonth: number;
  inNetworkGallonsThisMonth: number;
  activeCardsThisMonth: number;
  transactionsThisMonth: number;
  gallonsPrevMonth: number;
  inNetworkGallonsPrevMonth: number;
  loyaltyOverride?: LoyaltyClientOverride | null;
  activeCardsPrevMonth: number;
}

/** The caller's full client roster (admins may target an agent via ?zoho_user_id). Route wraps the
 *  array in `{ clients }`. */
export async function getClients(zohoUserId?: string): Promise<AgentClient[]> {
  const res = (await request('GET', '/data-center/clients', {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as { clients?: AgentClient[] };
  return res.clients ?? [];
}

/** One client's fuel cards (octane.dim_card + latest-transaction driver/unit). Owner-scoped server-side. */
export interface ClientCardDetail {
  cardId: string | null;
  cardNumber: string | null;
  cardType: string | null;
  status: string | null;
  balance: string | null;
  unit: string | null;
  driverId: string | null;
  driverName: string | null;
}

export async function getClientCards(carrierId: string): Promise<ClientCardDetail[]> {
  const res = (await request('GET', '/data-center/client-cards', {
    query: { carrierId },
    headers: DC_HEADERS,
  })) as { cards?: ClientCardDetail[] };
  return res.cards ?? [];
}

/** One client's billing terms (octane.dim_company). Owner-scoped server-side. Null when no row. */
export interface ClientBilling {
  billingCycle: string | null;
  billingCycleTag: string | null;
  paymentTerms: string | null;
  paymentDay: string | null;
  creditLimit: string | null;
  minimumRequiredBalance: string | null;
}

export async function getClientBilling(carrierId: string): Promise<ClientBilling | null> {
  const res = (await request('GET', '/data-center/client-billing', {
    query: { carrierId },
    headers: DC_HEADERS,
  })) as { billing?: ClientBilling | null };
  return res.billing ?? null;
}

/** Result of an owner-scoped inline edit — the record id + the exact CRM fields that changed. */
export interface UpdateResult {
  id: string;
  updatedFields: string[];
}

export interface LeadBlueprintField {
  apiName: string;
  label: string;
  dataType: string;
  mandatory: boolean;
  readOnly: boolean;
  value: unknown;
  options: Array<{ label: string; value: string }>;
}

export interface LeadBlueprintTransition {
  id: string;
  name: string;
  nextValue: string;
  type: string;
  criteriaMatched: boolean;
  criteriaMessage: string;
  fields: LeadBlueprintField[];
}

export interface LeadBlueprint {
  process: {
    id: string;
    name: string;
    fieldApiName: string;
    fieldLabel: string;
    currentValue: string;
  };
  transitions: LeadBlueprintTransition[];
}

/** Current Blueprint state and record-specific transitions. Null means Zoho explicitly reported
 *  that this Lead is not in a Blueprint; vendor/permission failures reject the request. */
export async function getLeadBlueprint(id: string, zohoUserId?: string): Promise<LeadBlueprint | null> {
  const res = (await request('GET', `/data-center/leads/${encodeURIComponent(id)}/blueprint`, {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
  })) as { blueprint?: LeadBlueprint | null };
  return res.blueprint ?? null;
}

/** Execute an id from the latest record-specific Blueprint response. The server re-fetches the
 *  Blueprint, checks ownership/criteria/required fields, executes it, and audit-logs the write. */
export function executeLeadBlueprintTransition(
  id: string,
  transitionId: string,
  data: Record<string, string | number | boolean | null>,
  zohoUserId?: string,
): Promise<{ id: string; transitionId: string; status: string }> {
  return request('POST', `/data-center/leads/${encodeURIComponent(id)}/blueprint/${encodeURIComponent(transitionId)}`, {
    query: zohoUserId ? { zoho_user_id: zohoUserId } : {},
    headers: DC_HEADERS,
    body: { data },
  }) as Promise<{ id: string; transitionId: string; status: string }>;
}

/** Editable Lead fields (exact Zoho API names). '' clears a field; DOT is numeric-or-string.
 *  Status + the two reason picklists back the post-call status wizard. */
export type LeadEditFields = Partial<
  Record<
    | 'MC'
    | 'DOT'
    | 'Referral_Source'
    | 'Cell'
    | 'Phone'
    | 'Email'
    | 'Description'
    | 'Status'
    | 'Unqualified_Reason'
    | 'Not_Interested_Reason'
    | 'Application_ID',
    string | number | null
  >
>;
/** Editable Deal fields (exact Zoho API names). */
export type DealEditFields = Partial<Record<'Email' | 'Phone' | 'Cell' | 'Secondary_Email' | 'Description', string | null>>;

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
