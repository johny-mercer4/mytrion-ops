/**
 * Applications save orchestration — the server-side port of the CS widget's
 * saveModal/toggleBool flow (zoho-octane app/mytrion-customer-service/js/components/
 * applications-panel.js):
 *   1) fetch the full record (Edit_History subform + linked Deal id),
 *   2) validate + allowlist the requested changes, resolve exact field casing,
 *   3) APPEND Edit_History audit rows (Who_Edited is session-authoritative),
 *   4) update the Application,
 *   5) mirror changed fields to the linked Deal via DEAL_FIELD_MAP (best-effort).
 */
import { AppError, NotFoundError } from '../../lib/errors.js';
import { zohoCrmRecords } from '../../integrations/zohoCrmRecords.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { resolveWritePayload } from './fieldResolver.js';

/** Application → Deal field mirror (ported verbatim from the widget/spreadsheet map). */
const DEAL_FIELD_MAP: Readonly<Record<string, string>> = Object.freeze({
  Name: 'Deal_Name',
  First_Name: 'First_name',
  Last_Name: 'Last_Name',
  Email: 'Email',
  Phone: 'Phone',
  emc: 'MC',
  DOT: 'DOT1',
  Type_of_Business: 'Business_Type',
  Number_of_Trucks: 'Trucks1',
  Carrier_ID: 'Carrier_ID',
  Credit_Score: 'Credit_Score',
  Oldest_Open_Date: 'Oldest_Open_Date',
  Billing_Cycle: 'Billing_Cycle',
  Verification_Notes: 'Verification_Notes',
  Verified: 'Verified',
  Stage: 'Application_Stage',
  TA_EFS_Added: 'TA_EFS_Added',
  Email_to_TA: 'Email_to_TA',
  // Ambiguous app-side casings both mirror to the same Deal field (widget parity); the
  // lookup is done case-insensitively below so whichever casing resolves still mirrors.
  Limits_added: 'Limits_Added',
  Mobile_Driver_App: 'Mobile_driver_app',
  Chain_policy: 'Chain_policy',
  Billing_Form_Y_N: 'Billing_Verification',
  Cards_Requested: 'Cards_Requested',
  Payment_Type_Billing: 'Payment_Type_Billing',
  Loves_Verification: 'Loves_Verification',
  Zip_Code: 'Zip_Code',
});

const dealFieldByLower = new Map(
  Object.entries(DEAL_FIELD_MAP).map(([k, v]) => [k.toLowerCase(), v]),
);

/** The onboarding pipeline tick-boxes (widget order). Casing resolved live at write time. */
export const ONBOARDING_FIELDS = [
  'Email_to_TA',
  'TA_EFS_Added',
  'Limits_added',
  'Mobile_Driver_App',
  'Chain_policy',
] as const;

type FieldKind = 'text' | 'boolean' | 'number' | 'date' | 'email' | 'phone';

/**
 * Editable-field allowlist (real CRM API names from the mytrionGetApplications select
 * list + CS_APPS_EXTRA_FIELDS). Anything else is rejected before touching Zoho.
 */
const EDITABLE_FIELDS: Readonly<Record<string, FieldKind>> = {
  Name: 'text',
  First_Name: 'text',
  Last_Name: 'text',
  Email: 'email',
  Phone: 'phone',
  Address: 'text',
  City: 'text',
  State: 'text',
  Zip_Code: 'text',
  emc: 'text',
  DOT: 'text',
  Carrier_ID: 'text',
  Tracking_Number: 'text',
  Customer_Service_Notes: 'text',
  Verification_Notes: 'text',
  Stage: 'text',
  Status: 'text',
  WEX_Status: 'text',
  Type_of_Business: 'text',
  Payment_Type_Billing: 'text',
  Loves_Verification: 'text',
  Billing_Cycle: 'text',
  Billing_Form_Y_N: 'text',
  Credit_Score: 'number',
  Number_of_Trucks: 'number',
  Cards_Requested: 'number',
  Date_Filled: 'date',
  Oldest_Open_Date: 'date',
  Verified: 'boolean',
  Email_to_TA: 'boolean',
  TA_EFS_Added: 'boolean',
  Limits_added: 'boolean',
  Mobile_Driver_App: 'boolean',
  Chain_policy: 'boolean',
};

const editableByLower = new Map(
  Object.entries(EDITABLE_FIELDS).map(([k, v]) => [k.toLowerCase(), { name: k, kind: v }]),
);

function reject(message: string): never {
  throw new AppError(message, { statusCode: 400, code: 'VALIDATION_ERROR', expose: true });
}

/** Per-field validation mirroring the widget's saveModal rules. Returns the write value. */
function validateFieldValue(field: string, kind: FieldKind, value: unknown): unknown {
  if (value === null || value === '') return value; // clearing a field is allowed
  switch (kind) {
    case 'boolean':
      if (typeof value !== 'boolean') reject(`${field} must be a boolean`);
      return value;
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) reject(`${field} must be a number`);
      if (field === 'Credit_Score' && (n < 1 || n > 100)) {
        reject('CreditSafe Score must be between 1 and 100');
      }
      return n;
    }
    case 'email':
      if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        reject('Invalid email format');
      }
      return value;
    case 'phone': {
      const digits = String(value).replace(/\D/g, '');
      if (digits.length !== 10) reject('Phone must be exactly 10 digits');
      return digits;
    }
    case 'date':
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) {
        reject(`${field} must be a yyyy-mm-dd date`);
      }
      return value;
    default:
      if (typeof value !== 'string') reject(`${field} must be a string`);
      if ((value as string).length > 2000) reject(`${field} is too long`);
      return value;
  }
}

/** The widget's Edited_On format ("Jul 16, 2026, 08:45 PM"), pinned to the org timezone. */
function editedOnStamp(): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/Chicago',
  }).format(new Date());
}

export interface SaveApplicationResult {
  id: string;
  updatedFields: string[];
  dealId: string | null;
  dealSyncedFields: number;
  /** Non-fatal problems (e.g. Deal mirror failed) the UI should surface as a warning. */
  warning?: string;
}

/**
 * Validate + persist a set of Application changes with Edit_History append and Deal
 * mirror. `changes` keys may arrive in any casing — matched against the allowlist
 * case-insensitively, then resolved to the module's exact casing before the write.
 */
export async function saveApplication(
  ctx: TenantContext,
  appId: string,
  changes: Record<string, unknown>,
): Promise<SaveApplicationResult> {
  const entries = Object.entries(changes);
  if (entries.length === 0) reject('No changes supplied');
  if (entries.length > 40) reject('Too many fields in one save');

  // 1) Allowlist + validate (logical names) --------------------------------------------
  const validated: Record<string, unknown> = {};
  for (const [rawKey, rawValue] of entries) {
    const match = editableByLower.get(rawKey.toLowerCase());
    if (!match) reject(`Field '${rawKey}' is not editable from the CS panel`);
    validated[match.name] = validateFieldValue(match.name, match.kind, rawValue);
  }

  // 2) Full record: Edit_History must be APPENDED and the Deal id discovered ----------
  const full = await zohoCrmRecords.getRecord('Applications', appId);
  if (!full) throw new NotFoundError(`Application ${appId} not found`);

  // 3) Exact-casing resolution against live metadata (silent-no-op guard) --------------
  const resolved = await resolveWritePayload('Applications', validated);

  const history = Array.isArray(full.Edit_History)
    ? (JSON.parse(JSON.stringify(full.Edit_History)) as Array<Record<string, unknown>>)
    : [];
  const who = ctx.userName ?? 'Unknown';
  const editedOn = editedOnStamp();
  for (const [field, value] of Object.entries(resolved)) {
    history.push({
      Column_Name: field,
      Who_Edited: who,
      New_Value: String(value ?? ''),
      Edited_On: editedOn,
    });
  }

  // 4) Application update ---------------------------------------------------------------
  await zohoCrmRecords.updateRecord('Applications', appId, {
    ...resolved,
    Edit_History: history,
  });

  // 5) Deal mirror (best-effort — the widget warns, never fails the save) ---------------
  const relatedDeal = full.Related_Deal as { id?: string } | null | undefined;
  const dealName = full.Deal_Name as { id?: string } | null | undefined;
  const dealId = relatedDeal?.id ?? dealName?.id ?? null;
  let dealSyncedFields = 0;
  let warning: string | undefined;
  if (dealId) {
    const dealChanges: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(validated)) {
      const dealField = dealFieldByLower.get(field.toLowerCase());
      if (dealField) dealChanges[dealField] = value;
    }
    if (Object.keys(dealChanges).length > 0) {
      try {
        const dealResolved = await resolveWritePayload('Deals', dealChanges);
        await zohoCrmRecords.updateRecord('Deals', dealId, dealResolved);
        dealSyncedFields = Object.keys(dealResolved).length;
      } catch (err) {
        warning = `Application saved, but the Deal mirror failed: ${
          err instanceof Error ? err.message : String(err)
        }`;
      }
    }
  }

  return {
    id: appId,
    updatedFields: Object.keys(resolved),
    dealId,
    dealSyncedFields,
    ...(warning ? { warning } : {}),
  };
}
