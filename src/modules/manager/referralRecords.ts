/**
 * Manager Mytrion → Referrals card: read the two Zoho referral custom modules (Parent_Referrers,
 * Child_Referrals) with their FULL field set, for a manager-facing record browser. Read-only.
 *
 * Field list comes from the live catalog (`getModuleFields`, gives labels + types for the UI); the
 * records are then fetched with a single COQL SELECT of those fields (`zohoCrm.runCoql`). COQL needs
 * an explicit column list, so system/non-scalar noise is dropped first. Default fetch limit is 200
 * (COQL caps a page at 2000). Lookups (Parent_Referrer, Owner) come back as `{ name, id }`.
 */
import { zohoCrm } from '../../integrations/zohoCrm.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import { AppError, errorMessage } from '../../lib/errors.js';

/** Referral modules the card exposes, keyed by a SAFE url token — raw module names never leave here. */
export const REFERRAL_MODULES = {
  parents: 'Parent_Referrers',
  children: 'Child_Referrals',
} as const;
export type ReferralModuleKey = keyof typeof REFERRAL_MODULES;

export function isReferralModuleKey(v: string): v is ReferralModuleKey {
  return v === 'parents' || v === 'children';
}

/** Default number of records fetched per module. */
export const DEFAULT_REFERRAL_LIMIT = 200;
/** COQL hard page cap (Zoho CRM v8). */
const MAX_REFERRAL_LIMIT = 2000;

/** One column descriptor for the UI: api name + human label + Zoho data type (+ picklist options). */
export interface ReferralField {
  apiName: string;
  label: string;
  type: string;
  options?: string[];
}

export interface ReferralRecordsResult {
  /** Zoho module api name (e.g. 'Parent_Referrers'). */
  module: string;
  moduleKey: ReferralModuleKey;
  fields: ReferralField[];
  rows: Array<Record<string, unknown>>;
  total: number;
  /** True when more rows exist beyond the fetched limit. */
  truncated: boolean;
}

/**
 * Field api_names never surfaced: pure-system (Tag/Layout/…) plus marketing/multicurrency noise that
 * isn't relevant to referrals and can trip COQL's stricter column rules (Last_Activity_Time, Currency,
 * Exchange_Rate, Email_Opt_Out, Unsubscribed_*).
 */
const NOISE_API_NAMES = new Set([
  'Tag',
  'Record_Image',
  'Locked__s',
  'Layout',
  'Last_Activity_Time',
  'Currency',
  'Exchange_Rate',
  'Email_Opt_Out',
  'Unsubscribed_Mode',
  'Unsubscribed_Time',
]);
/** Non-scalar field types COQL / the browser can't render cleanly. */
const NOISE_TYPES = new Set(['subform', 'multiselectlookup', 'profileimage', 'RRULE', 'event_reminder']);

/** Zoho caps a COQL SELECT around 50 columns — stay under it. */
const MAX_FIELDS = 48;

/** Live, displayable field set for a module (system/non-scalar noise dropped, capped at MAX_FIELDS). */
async function displayFields(module: string): Promise<ReferralField[]> {
  const meta = await zohoCrmRecords.getModuleFields(module);
  const fields: ReferralField[] = [];
  for (const f of meta) {
    const apiName = typeof f.api_name === 'string' ? f.api_name : '';
    if (!apiName || apiName.startsWith('$')) continue;
    const type = typeof f.data_type === 'string' ? f.data_type : '';
    if (NOISE_API_NAMES.has(apiName) || NOISE_TYPES.has(type)) continue;
    const options = Array.isArray(f.pick_list_values)
      ? f.pick_list_values
          .map((p) => (typeof p.display_value === 'string' ? p.display_value : ''))
          .filter((v) => v && v !== '-None-')
      : [];
    fields.push({
      apiName,
      label: typeof f.field_label === 'string' && f.field_label ? f.field_label : apiName,
      type,
      ...(options.length ? { options } : {}),
    });
    if (fields.length >= MAX_FIELDS) break;
  }
  return fields;
}

/** Clamp a caller-supplied limit to [1, 2000], defaulting to 200 for missing / invalid input. */
function clampLimit(limit: number | undefined): number {
  const n = Math.floor(limit ?? DEFAULT_REFERRAL_LIMIT);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REFERRAL_LIMIT;
  return Math.min(n, MAX_REFERRAL_LIMIT);
}

/**
 * Fetch a referral module's full-field records via COQL (single page, default 200). Read-only. Wraps
 * any Zoho failure as a 502 ZOHO_CRM_ERROR so the route surfaces a clean, retryable error.
 */
export async function fetchReferralRecords(
  moduleKey: ReferralModuleKey,
  limit?: number,
): Promise<ReferralRecordsResult> {
  const module = REFERRAL_MODULES[moduleKey];
  const cap = clampLimit(limit);
  try {
    const fields = await displayFields(module);
    const cols = fields.map((f) => f.apiName).join(', ');
    // COQL requires a WHERE — `id is not null` is the universal match-all predicate.
    const res = await zohoCrm.runCoql(
      `select ${cols} from ${module} where id is not null order by Created_Time desc limit 0, ${cap}`,
    );
    return {
      module,
      moduleKey,
      fields,
      rows: res.rows,
      total: res.rows.length,
      truncated: res.moreRecords,
    };
  } catch (err) {
    throw new AppError(`Zoho CRM read failed for ${module}: ${errorMessage(err)}`, {
      statusCode: 502,
      code: 'ZOHO_CRM_ERROR',
      expose: true,
      cause: err,
    });
  }
}

// --- Referral ↔ Leads/Deals associations ---------------------------------------------------------
// Leads and Deals point at a parent (Parent_Referrer) and/or a child (Child_Referrer). The card
// surfaces, per parent/child, the Leads and Deals that reference it. We fetch the referral-linked
// Leads/Deals once (a curated column set + the two lookup keys) and the UI groups them by lookup id.

/** A curated Leads/Deals slice returned for the associations view. */
export interface LinkedRecords {
  module: string;
  fields: ReferralField[];
  rows: Array<Record<string, unknown>>;
  total: number;
  truncated: boolean;
}

export interface ReferralAssociations {
  leads: LinkedRecords;
  deals: LinkedRecords;
}

/** Display columns for linked Leads (concise — this is context, not the primary record). */
const LEAD_DISPLAY: ReferralField[] = [
  { apiName: 'Full_Name', label: 'Name', type: 'text' },
  { apiName: 'Company', label: 'Company', type: 'text' },
  { apiName: 'Email', label: 'Email', type: 'email' },
  { apiName: 'Phone', label: 'Phone', type: 'phone' },
  { apiName: 'Created_Time', label: 'Created', type: 'datetime' },
];
/** Display columns for linked Deals. */
const DEAL_DISPLAY: ReferralField[] = [
  { apiName: 'Deal_Name', label: 'Deal', type: 'text' },
  { apiName: 'Carrier_ID', label: 'Carrier ID', type: 'text' },
  { apiName: 'Stage', label: 'Stage', type: 'picklist' },
  { apiName: 'Amount', label: 'Amount', type: 'currency' },
  { apiName: 'Created_Time', label: 'Created', type: 'datetime' },
];
/** Lookup keys selected for grouping on the client (not shown as columns). */
const LINK_KEYS = ['Parent_Referrer', 'Child_Referrer', 'id'] as const;

async function fetchLinked(module: string, display: ReferralField[], cap: number): Promise<LinkedRecords> {
  const cols = [...display.map((f) => f.apiName), ...LINK_KEYS].join(', ');
  const res = await zohoCrm.runCoql(
    `select ${cols} from ${module} where Parent_Referrer is not null or Child_Referrer is not null order by Created_Time desc limit 0, ${cap}`,
  );
  return { module, fields: display, rows: res.rows, total: res.rows.length, truncated: res.moreRecords };
}

/**
 * Leads + Deals that reference a referral (via Parent_Referrer / Child_Referrer), for the card to
 * group under each parent/child. Read-only; default limit 200 per module. 502 on any Zoho failure.
 */
export async function fetchReferralAssociations(limit?: number): Promise<ReferralAssociations> {
  const cap = clampLimit(limit);
  try {
    const [leads, deals] = await Promise.all([
      fetchLinked('Leads', LEAD_DISPLAY, cap),
      fetchLinked('Deals', DEAL_DISPLAY, cap),
    ]);
    return { leads, deals };
  } catch (err) {
    throw new AppError(`Zoho CRM read failed for referral associations: ${errorMessage(err)}`, {
      statusCode: 502,
      code: 'ZOHO_CRM_ERROR',
      expose: true,
      cause: err,
    });
  }
}
