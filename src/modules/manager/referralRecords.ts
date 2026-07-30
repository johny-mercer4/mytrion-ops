/**
 * Manager Mytrion → Referrals card: read the two Zoho referral custom modules (Parent_Referrers,
 * Child_Referrals) with their FULL field set, for a manager-facing record browser. Read-only.
 *
 * Field list comes from the live catalog (`getModuleFields`, gives labels + types for the UI); the
 * records are then fetched with a COQL SELECT of those fields, drained page by page via
 * `zohoCrm.runCoqlAll` at {@link REFERRAL_PAGE_SIZE} until Zoho runs out — so `total` is the module's
 * real count, not a page length. COQL needs an explicit column list, so system/non-scalar noise is
 * dropped first. Lookups (Parent_Referrer, Owner) come back as `{ name, id }`.
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

/**
 * Rows per COQL page. The card used to fetch ONE page of 200 and call it the total, so a manager
 * looking at 687 parent referrers saw "200 parent referrers" and every child whose parent fell
 * outside that page was reported as unlinked. Now every module is drained page by page at this size
 * until Zoho runs out.
 *
 * 1000 is a deliberate choice, not Zoho's max (2000): COQL credits are tiered (≤200 → 1, ≤1000 → 2,
 * ≤2000 → 3), so 2000/page is marginally cheaper per row, but 1000 keeps a single page well inside
 * the outbound HTTP timeout on a wide 25-column SELECT. Raise it if drains ever get long.
 */
export const REFERRAL_PAGE_SIZE = 1000;

/**
 * Wall-clock budget for one module's drain. The browser sends no AbortSignal and the outbound timeout
 * is per-call, so without this a deep drain could outlive the request that asked for it. On expiry the
 * partial rows come back with `truncated: true` rather than an error.
 */
const REFERRAL_DRAIN_BUDGET_MS = 25_000;

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
  /**
   * The module's TRUE record count. Every page is drained, so this is the real total — not a page
   * length pretending to be one. (A COQL `count(id)` can't supply it: aggregates return
   * SYNTAX_ERROR/"missing clause: group by" on this org, verified live.)
   */
  total: number;
  /** True only when a guard (time budget / 100k offset ceiling) stopped the drain with rows left. */
  truncated: boolean;
  /** COQL calls spent on this module — surfaced so a slow card can be reasoned about. */
  pages: number;
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

/**
 * Optional row budget from `?limit`. Absent / zero / NaN means "no budget — drain everything", which
 * is the opposite of the old behaviour: a malformed `?limit=abc` used to silently fall back to 200 and
 * re-introduce the very truncation this module exists to avoid.
 */
function rowBudget(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  const n = Math.floor(limit);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n;
}

/**
 * Ordering for every referral drain.
 *
 * `id desc` is not decoration — it is what makes offset pagination sound. Created_Time alone is not a
 * total order here (680 of 687 parents share one timestamp from the 2026-07-28 bulk import), and
 * paging through a tie group has no defined row order, so pages could repeat or skip records. The tie
 * break also fixes a live bug: within the tie Zoho was ordering id ASCENDING, so the "newest 200"
 * page actually started at REF-000513 and the genuinely newest record was nowhere on it.
 */
const REFERRAL_ORDER = 'order by Created_Time desc, id desc';

/**
 * Fetch a referral module's full-field records via COQL, draining every page. Read-only. Wraps any
 * Zoho failure as a 502 ZOHO_CRM_ERROR so the route surfaces a clean, retryable error.
 */
export async function fetchReferralRecords(
  moduleKey: ReferralModuleKey,
  limit?: number,
): Promise<ReferralRecordsResult> {
  const module = REFERRAL_MODULES[moduleKey];
  const maxRows = rowBudget(limit);
  try {
    const fields = await displayFields(module);
    const cols = fields.map((f) => f.apiName).join(', ');
    // COQL requires a WHERE — `id is not null` is the universal match-all predicate.
    const res = await zohoCrm.runCoqlAll(
      `select ${cols} from ${module} where id is not null ${REFERRAL_ORDER}`,
      {
        pageSize: REFERRAL_PAGE_SIZE,
        budgetMs: REFERRAL_DRAIN_BUDGET_MS,
        ...(maxRows !== undefined ? { maxRows } : {}),
      },
    );
    return {
      module,
      moduleKey,
      fields,
      rows: res.rows,
      total: res.rows.length,
      truncated: res.truncated,
      pages: res.pages,
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
  /** True total — drained, same as {@link ReferralRecordsResult.total}. */
  total: number;
  truncated: boolean;
  pages: number;
}

export interface ReferralAssociations {
  leads: LinkedRecords;
  deals: LinkedRecords;
}

export interface ReferralCalculationRecords {
  parents: ReferralRecordsResult;
  children: ReferralRecordsResult;
  associations: ReferralAssociations;
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

const PARENT_CALC_FIELDS: ReferralField[] = [
  { apiName: 'ReferrerId', label: 'Referrer ID', type: 'text' },
  { apiName: 'Name', label: 'Name', type: 'text' },
  { apiName: 'Company_Name', label: 'Company', type: 'text' },
  { apiName: 'Calculation', label: 'Calculation', type: 'picklist' },
  { apiName: 'Deal_Id', label: 'Primary Deal', type: 'lookup' },
];
const CHILD_CALC_FIELDS: ReferralField[] = [
  { apiName: 'Referrer_ID', label: 'Referrer ID', type: 'text' },
  { apiName: 'Name', label: 'Name', type: 'text' },
  { apiName: 'Company_Name', label: 'Company', type: 'text' },
  { apiName: 'Calculation', label: 'Calculation override', type: 'picklist' },
  { apiName: 'Parent_Referrer', label: 'Parent Referrer', type: 'lookup' },
  { apiName: 'Paid', label: 'Child paid', type: 'boolean' },
  { apiName: 'Parent_Paid', label: 'Parent paid', type: 'boolean' },
];

/** Narrow calculation drains use Zoho's full 2,000-row page to complete each live module in one call. */
const REFERRAL_CALC_PAGE_SIZE = 2000;

async function fetchCalculationModule(
  moduleKey: ReferralModuleKey,
  fields: ReferralField[],
): Promise<ReferralRecordsResult> {
  const module = REFERRAL_MODULES[moduleKey];
  const cols = ['id', ...fields.map((field) => field.apiName)].join(', ');
  const result = await zohoCrm.runCoqlAll(
    `select ${cols} from ${module} where id is not null ${REFERRAL_ORDER}`,
    { pageSize: REFERRAL_CALC_PAGE_SIZE, budgetMs: REFERRAL_DRAIN_BUDGET_MS },
  );
  if (result.truncated) {
    throw new Error(`${module} calculation drain was truncated after ${result.rows.length} rows`);
  }
  return {
    module,
    moduleKey,
    fields,
    rows: result.rows,
    total: result.rows.length,
    truncated: false,
    pages: result.pages,
  };
}

/**
 * Complete live calculation input, optimized for the workspace rather than the raw CRM browser.
 *
 * All three independent COQL drains start together. Their narrow projections fit in a single
 * 2,000-row page with today's roster, avoiding the wide metadata + multi-page reads used by the CRM
 * detail browser.
 */
export async function fetchReferralCalculationRecords(): Promise<ReferralCalculationRecords> {
  try {
    const [parents, children, deals] = await Promise.all([
      fetchCalculationModule('parents', PARENT_CALC_FIELDS),
      fetchCalculationModule('children', CHILD_CALC_FIELDS),
      fetchLinked('Deals', DEAL_DISPLAY, undefined, REFERRAL_CALC_PAGE_SIZE),
    ]);
    return {
      parents,
      children,
      associations: {
        leads: {
          module: 'Leads',
          fields: LEAD_DISPLAY,
          rows: [],
          total: 0,
          truncated: false,
          pages: 0,
        },
        deals,
      },
    };
  } catch (err) {
    throw new AppError(`Zoho CRM referral calculation read failed: ${errorMessage(err)}`, {
      statusCode: 502,
      code: 'ZOHO_CRM_ERROR',
      expose: true,
      cause: err,
    });
  }
}

async function fetchLinked(
  module: string,
  display: ReferralField[],
  maxRows: number | undefined,
  pageSize = REFERRAL_PAGE_SIZE,
): Promise<LinkedRecords> {
  const cols = [...display.map((f) => f.apiName), ...LINK_KEYS].join(', ');
  const res = await zohoCrm.runCoqlAll(
    `select ${cols} from ${module} where Parent_Referrer is not null or Child_Referrer is not null ${REFERRAL_ORDER}`,
    {
      pageSize,
      budgetMs: REFERRAL_DRAIN_BUDGET_MS,
      ...(maxRows !== undefined ? { maxRows } : {}),
    },
  );
  return { module, fields: display, rows: res.rows, total: res.rows.length, truncated: res.truncated, pages: res.pages };
}

/**
 * Leads + Deals that reference a referral (via Parent_Referrer / Child_Referrer), for the card to
 * group under each parent/child. Read-only, fully drained. 502 on any Zoho failure.
 *
 * Both sets are empty org-wide today (no Lead or Deal has either referral lookup set), so each drain
 * costs exactly one COQL call that returns nothing — the same cost as the old single-page fetch.
 */
export async function fetchReferralAssociations(limit?: number): Promise<ReferralAssociations> {
  const maxRows = rowBudget(limit);
  try {
    const [leads, deals] = await Promise.all([
      fetchLinked('Leads', LEAD_DISPLAY, maxRows),
      fetchLinked('Deals', DEAL_DISPLAY, maxRows),
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
