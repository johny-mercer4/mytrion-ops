/**
 * Zoho People forms/components helpers for metadata + bulk scripts.
 * Field keys from the live API are lowercase (`labelname`, `comptype`, `ismandatory`) —
 * older analyzer code looked for camelCase and produced empty apiName/type.
 */
import { tryGetJson } from './http.js';

export interface PeopleForm {
  formLinkName?: string;
  displayName?: string;
  formName?: string;
  componentName?: string;
  componentId?: number | string;
  iscustom?: boolean;
  isVisible?: boolean;
  viewDetails?: { view_Id?: number | string; view_Name?: string };
}

/** Raw /components row — accept both documented lowercase and occasional camelCase. */
export interface PeopleComponent {
  labelname?: string;
  labelName?: string;
  displayname?: string;
  displayName?: string;
  comptype?: string;
  type?: string;
  ismandatory?: boolean | string;
  mandatory?: boolean | string;
  formcomponentid?: number | string;
  maxLength?: number;
  Options?: Array<string | { value?: string; name?: string; Id?: string }>;
  options?: Array<string | { value?: string; name?: string; Id?: string }>;
  pickListValues?: Array<string | { value?: string; name?: string; Id?: string }>;
}

export interface PeopleFieldMeta {
  apiName: string;
  label: string;
  dataType: string;
  mandatory: boolean;
  componentId?: string;
  maxLength?: number;
  options?: string[];
}

export interface PeopleFormMeta {
  apiName: string;
  displayName: string;
  isCustom: boolean;
  viewName?: string;
  fieldCount: number;
  fields: PeopleFieldMeta[];
  error?: string;
}

export function formApiName(f: PeopleForm): string {
  return (f.formLinkName ?? f.componentName ?? f.formName ?? '').trim();
}

export function formDisplayName(f: PeopleForm): string {
  return (f.displayName ?? f.formName ?? formApiName(f)).trim();
}

function asBool(v: boolean | string | undefined): boolean {
  return v === true || v === 'true';
}

function componentOptions(c: PeopleComponent): string[] {
  const raw = c.options ?? c.Options ?? c.pickListValues ?? [];
  return raw
    .map((o) => (typeof o === 'string' ? o : (o.value ?? o.name ?? o.Id ?? '')))
    .filter((v) => v !== '');
}

export function mapComponent(c: PeopleComponent): PeopleFieldMeta {
  const apiName = (c.labelname ?? c.labelName ?? '').trim();
  const label = (c.displayname ?? c.displayName ?? apiName).trim();
  const dataType = (c.comptype ?? c.type ?? 'unknown').trim() || 'unknown';
  const field: PeopleFieldMeta = {
    apiName,
    label,
    dataType,
    mandatory: asBool(c.ismandatory ?? c.mandatory),
  };
  if (c.formcomponentid !== undefined) field.componentId = String(c.formcomponentid);
  if (typeof c.maxLength === 'number') field.maxLength = c.maxLength;
  const options = componentOptions(c);
  if (options.length > 0) field.options = options;
  return field;
}

/** Match --module values against formLinkName or displayName (case-insensitive). */
export function filterForms(forms: PeopleForm[], modules: string[]): PeopleForm[] {
  if (modules.length === 0) return forms;
  const wanted = modules.map((m) => m.toLowerCase());
  const matched = forms.filter((f) => {
    const api = formApiName(f).toLowerCase();
    const label = formDisplayName(f).toLowerCase();
    return wanted.some((w) => w === api || w === label);
  });
  const found = new Set(
    matched.flatMap((f) => [formApiName(f).toLowerCase(), formDisplayName(f).toLowerCase()]),
  );
  const missing = wanted.filter((w) => !found.has(w));
  if (missing.length > 0) {
    throw new Error(
      `[zoho-people] unknown module(s): ${missing.join(', ')}. ` +
        `Known formLinkNames: ${forms.map(formApiName).filter(Boolean).sort().join(', ')}`,
    );
  }
  return matched;
}

export async function listPeopleForms(
  base: string,
  headers: Record<string, string>,
): Promise<PeopleForm[]> {
  const formsRes = await tryGetJson<{ response?: { result?: PeopleForm[] }; forms?: PeopleForm[] }>(
    `${base}/forms`,
    headers,
  );
  if (!formsRes.ok) {
    throw new Error(`[zoho-people] forms list failed: ${formsRes.error}`);
  }
  return formsRes.data.forms ?? formsRes.data.response?.result ?? [];
}

export async function fetchFormFields(
  base: string,
  headers: Record<string, string>,
  formLinkName: string,
): Promise<{ fields: PeopleFieldMeta[]; error?: string }> {
  const compRes = await tryGetJson<{
    response?: { result?: PeopleComponent[] };
    components?: PeopleComponent[];
  }>(`${base}/forms/${encodeURIComponent(formLinkName)}/components`, headers);
  if (!compRes.ok) {
    return { fields: [], error: compRes.error };
  }
  const components = compRes.data.components ?? compRes.data.response?.result ?? [];
  return { fields: components.map(mapComponent) };
}

export function toFormMeta(f: PeopleForm, fields: PeopleFieldMeta[], error?: string): PeopleFormMeta {
  const apiName = formApiName(f);
  return {
    apiName,
    displayName: formDisplayName(f),
    isCustom: f.iscustom === true,
    ...(f.viewDetails?.view_Name ? { viewName: f.viewDetails.view_Name } : {}),
    fieldCount: fields.length,
    fields,
    ...(error ? { error } : {}),
  };
}

export interface FlatPeopleRecord {
  recordId: string;
  fields: Record<string, unknown>;
}

/** Flatten `{ "<id>": [ {fields} ] }` rows from getRecords into { recordId, fields }. */
export function flattenGetRecordsResult(result: unknown): FlatPeopleRecord[] {
  if (!Array.isArray(result)) return [];
  const out: FlatPeopleRecord[] = [];
  for (const row of result) {
    if (!row || typeof row !== 'object') continue;
    for (const [recordId, payload] of Object.entries(row as Record<string, unknown>)) {
      const fieldsArr = Array.isArray(payload) ? payload : [];
      const fields =
        fieldsArr[0] && typeof fieldsArr[0] === 'object' && fieldsArr[0] !== null
          ? (fieldsArr[0] as Record<string, unknown>)
          : {};
      out.push({ recordId, fields });
    }
  }
  return out;
}
