/**
 * The single place that knows the Zoho CRM `Maintenance` module's field names.
 *
 * The COQL SELECT list, the row mapper, and the canonical picklists all derive from ONE map here.
 * Two hand-kept lists is how a mirror silently stops mirroring a column — the reason
 * `MAINTENANCE_SELECT` is computed, never typed out again.
 *
 * Field reference (35 fields, verified live 2026-07-30): docs/crm-maintenance-module.md.
 * Regenerate with `pnpm tsx scripts/inspectMaintenanceModule.ts`.
 *
 * Casing matters: `Carrier_ID` has a CAPITAL ID here (Zelle/Chase use `Carrier_Id`), and a
 * wrong-cased key is a Zoho no-op rather than an error.
 */
import type { NewMaintenanceCase } from '../../db/schema/maintenance_cases.js';

export const MAINTENANCE_MODULE = 'Maintenance';

/**
 * Every Zoho field we read, in COQL SELECT order.
 *
 * `Used_Products` and `Bonus_Calc` are subforms and are deliberately absent — a subform in a
 * SELECT list 400s the entire query. `Created_By` / `Modified_By` are absent too: this module does
 * not expose them (they are not in the field metadata and never appear on a fetched record), so
 * selecting them would also fail.
 */
export const MAINTENANCE_SELECT = [
  'id',
  'Name',
  'Company',
  'Carrier_ID',
  'Unit_Number',
  'Status',
  'Case_Type',
  'Date',
  'Case_Completion',
  'Driver_Name',
  'Phone',
  'Shop_Number',
  'Parts',
  'Work_Order_ID',
  'Reference_Number',
  'Payment_Method',
  'Payment_Status',
  'Invoiced',
  'Card_Digits',
  'Total_Amount',
  'Completion_Compensation',
  'Half_Completion_Compensation',
  'Lead_Compensation',
  'Owner',
  'Bonus_for_Completion',
  'Bonus_for_Lead',
  'Created_Time',
  'Modified_Time',
] as const;

/**
 * Canonical picklists, from the live module metadata.
 *
 * Held as constants rather than fetched at request time because Postgres — not Zoho — is the source
 * of truth for Maintenance now; the tab must not depend on a Zoho round-trip to render a dropdown.
 * The `/meta` route unions these with the DISTINCT values actually present in the table, so a
 * legacy value on a migrated record stays selectable even if it is no longer offered here.
 */
export const MAINTENANCE_PICKLISTS = {
  status: ['In Process', 'Completed', 'Cancelled'],
  caseType: [
    'Mechanical',
    'PMs',
    'Tire Replacement',
    'DOT Inspection',
    'PMs / Mechanical',
    'PMs / Tire Repairs',
    'PMs and CARB',
    'Tire / Mechanical',
    'Tire Repairs',
  ],
  paymentMethod: ['LOC', 'Prepay / Card', 'Prepay / Zelle', 'Prepay / EFS', 'Selfpay'],
  paymentStatus: ['Paid', 'Pending', 'Not Paid', 'Delay', 'N/A'],
} as const;

/** The one Payment_Method servercrm's prepay ledger counts against the EFS balance. */
export const PREPAY_PAYMENT_METHOD = 'Prepay / EFS';

/**
 * The Payment_Method that hits a LOC carrier's EFS card — the LOC counterpart of
 * PREPAY_PAYMENT_METHOD above. `Prepay / Card`, `Prepay / Zelle` and `Selfpay` are settled outside
 * the card, so they must NOT reach a Customer Balance sub-ledger (Billing Ledger, TZ §5.1/§5.2).
 */
export const LOC_PAYMENT_METHOD = 'LOC';

/** Columns a client may write through the create/update routes. */
export const MAINTENANCE_EDITABLE = [
  'name',
  'companyZohoId',
  'companyName',
  'carrierId',
  'unitNumber',
  'status',
  'caseType',
  'caseDate',
  'caseCompletion',
  'driverName',
  'phone',
  'shopNumber',
  'parts',
  'workOrderId',
  'referenceNumber',
  'paymentMethod',
  'paymentStatus',
  'invoiced',
  'cardDigits',
  'totalAmount',
  'completionCompensation',
  'halfCompletionCompensation',
  'leadCompensation',
  'ownerZohoUserId',
  'ownerName',
  /** "Second agent" on a jointly worked case — splits the bonus 50/50 with the Owner. Migrated
   *  from Zoho's `Bonus_for_Completion`, unused there for split purposes; see csMaintenance.ts. */
  'bonusCompletionUserId',
  'bonusCompletionName',
] as const;

export type MaintenanceEditableField = (typeof MAINTENANCE_EDITABLE)[number];

/** Human labels for the Timeline (CS feedback 2026-07-31) — mirrors the CRM's field labels. */
export const FIELD_LABELS: Record<MaintenanceEditableField, string> = {
  name: 'Company Name',
  companyZohoId: 'Company (CRM link)',
  companyName: 'Company',
  carrierId: 'Carrier ID',
  unitNumber: 'Unit Number',
  status: 'Status',
  caseType: 'Case Type',
  caseDate: 'Date',
  caseCompletion: 'Completion Date',
  driverName: 'Driver Name',
  phone: 'Phone',
  shopNumber: 'Shop Number',
  parts: 'Parts / Work',
  workOrderId: 'Work Order ID',
  referenceNumber: 'Reference Number',
  paymentMethod: 'Payment Method',
  paymentStatus: 'Payment Status',
  invoiced: 'Invoiced',
  cardDigits: 'Card Digits',
  totalAmount: 'Total Amount',
  completionCompensation: 'Completion Compensation',
  halfCompletionCompensation: 'Half-Completion Compensation',
  leadCompensation: 'Lead Compensation',
  ownerZohoUserId: 'Owner (id)',
  ownerName: 'Owner',
  bonusCompletionUserId: 'Second Agent (id)',
  bonusCompletionName: 'Second Agent',
};

/** Id-only fields whose paired `*Name` field already renders the same change meaningfully — the
 *  Timeline skips these so it doesn't show a bare Zoho/CRM id next to the readable name change. */
const HISTORY_SKIP_FIELDS = new Set<MaintenanceEditableField>([
  'companyZohoId',
  'ownerZohoUserId',
  'bonusCompletionUserId',
]);

export interface MaintenanceHistoryChangeEntry {
  field: string;
  label: string;
  from: string | null;
  to: string | null;
}

/**
 * One Timeline entry's `changes` list. `before` is the row's prior values (null on create, where
 * every field the patch sets reads as "from blank"); `patch` is exactly what the request wrote
 * (already coerced by `pickEditable`), so this only reports fields the save actually touched.
 */
export function diffMaintenanceCase(
  before: Partial<Record<MaintenanceEditableField, unknown>> | null,
  patch: Partial<Record<MaintenanceEditableField, unknown>>,
): MaintenanceHistoryChangeEntry[] {
  const out: MaintenanceHistoryChangeEntry[] = [];
  for (const [field, to] of Object.entries(patch) as [MaintenanceEditableField, unknown][]) {
    if (HISTORY_SKIP_FIELDS.has(field)) continue;
    const from = before ? (before[field] ?? null) : null;
    const fromStr = from === null || from === undefined ? null : String(from);
    const toStr = to === null || to === undefined ? null : String(to);
    if (fromStr === toStr) continue;
    out.push({ field, label: FIELD_LABELS[field] ?? field, from: fromStr, to: toStr });
  }
  return out;
}

// ── value coercion ─────────────────────────────────────────────────────────────

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || s === '-None-' ? null : s;
};

/**
 * Currency → a fixed-2 string, because NUMERIC round-trips as a string in Drizzle.
 *
 * This org returns currency as a plain JS number (`500.0`, `2.5`), but a multicurrency setting can
 * start returning `"1,234.50"` instead — strip separators rather than let `Number()` produce NaN.
 */
export const money = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n.toFixed(2) : null;
};

/** Zoho dates are bare `YYYY-MM-DD`; a datetime would carry an offset we must not keep. */
const ymd = (v: unknown): string | null => {
  const s = str(v);
  return s ? s.slice(0, 10) : null;
};

/** Datetimes carry an offset (`2026-07-29T09:39:37-04:00`) — parse as an instant. */
const instant = (v: unknown): Date | null => {
  const s = str(v);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

const bool = (v: unknown): boolean | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
};

interface ZohoLookup {
  id?: unknown;
  name?: unknown;
}
const lookup = (v: unknown): ZohoLookup => (v && typeof v === 'object' ? (v as ZohoLookup) : {});

/**
 * One COQL row → one `maintenance_cases` insert.
 *
 * Pure on purpose: no I/O, so it is unit-testable and so the caller can map an entire drain,
 * collecting per-record errors, before issuing a single batched write.
 *
 * @param ownerNames  Zoho user id → FULL name. COQL returns `Owner.name` as the LAST NAME ONLY
 *   ("Example", "Chen") — verified against the directory. Falls back to the COQL name so a
 *   deactivated or out-of-directory owner never renders blank.
 * @throws when the row carries no `id` — the natural key. The caller reports that record and keeps
 *   writing the rest.
 */
export function mapMaintenanceRow(
  row: Record<string, unknown>,
  ownerNames: Map<string, string>,
): NewMaintenanceCase {
  const zohoRecordId = str(row.id);
  if (!zohoRecordId) throw new Error('Maintenance row has no id');

  const company = lookup(row.Company);
  const owner = lookup(row.Owner);
  const ownerId = str(owner.id);
  const bonusCompletion = lookup(row.Bonus_for_Completion);
  const bonusLead = lookup(row.Bonus_for_Lead);

  return {
    zohoRecordId,
    source: 'zoho_migration',

    name: str(row.Name),
    companyZohoId: str(company.id),
    companyName: str(company.name),
    carrierId: str(row.Carrier_ID),
    unitNumber: str(row.Unit_Number),

    status: str(row.Status),
    caseType: str(row.Case_Type),
    caseDate: ymd(row.Date),
    caseCompletion: ymd(row.Case_Completion),

    driverName: str(row.Driver_Name),
    phone: str(row.Phone),
    shopNumber: str(row.Shop_Number),
    parts: str(row.Parts),
    workOrderId: str(row.Work_Order_ID),
    referenceNumber: str(row.Reference_Number),

    paymentMethod: str(row.Payment_Method),
    paymentStatus: str(row.Payment_Status),
    invoiced: bool(row.Invoiced),
    cardDigits: str(row.Card_Digits),

    totalAmount: money(row.Total_Amount),
    completionCompensation: money(row.Completion_Compensation),
    halfCompletionCompensation: money(row.Half_Completion_Compensation),
    leadCompensation: money(row.Lead_Compensation),

    ownerZohoUserId: ownerId,
    ownerName: (ownerId ? ownerNames.get(ownerId) : null) ?? str(owner.name),
    bonusCompletionUserId: str(bonusCompletion.id),
    bonusCompletionName: str(bonusCompletion.name),
    bonusLeadUserId: str(bonusLead.id),
    bonusLeadName: str(bonusLead.name),

    createdTime: instant(row.Created_Time),
    modifiedTime: instant(row.Modified_Time),

    raw: row,
  };
}
