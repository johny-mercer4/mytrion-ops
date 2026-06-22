/**
 * Zoho CRM metadata analyzer.
 *
 * Pulls the full module + field catalog from Zoho CRM so we can build tools (and ground RAG)
 * against the real API names — including picklist values, lookup targets, and relationships,
 * which COQL filters and joins depend on. ZOHO_CRM_API_DOMAIN is the full versioned root:
 *   - GET {root}/org                                       (org profile)
 *   - GET {root}/users?type=AllUsers                       (users, best-effort)
 *   - GET {root}/settings/modules                          (modules)
 *   - GET {root}/settings/fields?module={api_name}         (fields incl. pick_list_values, per module)
 *   - GET {root}/settings/related_lists?module={api_name}  (relationships, per module, best-effort)
 *
 * Requires a refresh token with at least `ZohoCRM.settings.modules.READ`,
 * `ZohoCRM.settings.fields.READ`, `ZohoCRM.settings.related_lists.READ`, `ZohoCRM.users.READ`,
 * `ZohoCRM.org.READ`. Run: `pnpm meta:zoho-crm`.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { getJson, tryGetJson } from './lib/http.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';
import {
  fetchZohoAccessToken,
  resolveZohoConfig,
  zohoAuthHeader,
  type ZohoToken,
} from './lib/zohoAuth.js';

/** Cap on picklist values rendered into the markdown (all are kept in JSON). */
const MAX_PICKLIST_IN_MD = 25;

interface CrmModule {
  api_name: string;
  module_name?: string;
  plural_label?: string;
  singular_label?: string;
  api_supported?: boolean;
  generated_type?: string;
  /** 'custom' for user-created modules; 'default'/'web'/'linking'/'subform' otherwise. */
  // (generated_type is the closest signal Zoho exposes for "is this a custom module".)
}

interface CrmPickListValue {
  display_value?: string;
  actual_value?: string;
}

interface CrmField {
  api_name: string;
  field_label?: string;
  data_type?: string;
  custom_field?: boolean;
  read_only?: boolean;
  system_mandatory?: boolean;
  length?: number;
  pick_list_values?: CrmPickListValue[];
  /** Present on lookup fields — the target module this field references. */
  lookup?: { module?: { api_name?: string } | string };
}

interface FieldMeta {
  apiName: string;
  label: string;
  dataType: string;
  custom: boolean;
  readOnly: boolean;
  mandatory: boolean;
  length?: number;
  picklistValues?: string[];
  lookupModule?: string;
}

interface RelatedListMeta {
  apiName: string;
  module: string;
  label: string;
}

interface ModuleMeta {
  apiName: string;
  label: string;
  apiSupported: boolean;
  custom: boolean;
  generatedType: string;
  fieldCount: number;
  fields: FieldMeta[];
  relatedLists: RelatedListMeta[];
  fieldsError?: string;
  relatedListsError?: string;
}

/** Full versioned CRM API root. Prefer the configured base; else derive from the token. */
function crmBase(token: ZohoToken): string {
  const configured = env.ZOHO_CRM_API_DOMAIN.replace(/\/+$/, '');
  if (configured) return configured;
  if (token.apiDomain) return `${token.apiDomain.replace(/\/+$/, '')}/crm/v8`;
  throw new Error('[zoho-crm] no CRM API base — set ZOHO_CRM_API_DOMAIN');
}

function lookupModuleOf(f: CrmField): string | undefined {
  const m = f.lookup?.module;
  if (!m) return undefined;
  return typeof m === 'string' ? m : m.api_name;
}

function mapField(f: CrmField): FieldMeta {
  const meta: FieldMeta = {
    apiName: f.api_name,
    label: f.field_label ?? f.api_name,
    dataType: f.data_type ?? 'unknown',
    custom: f.custom_field === true,
    readOnly: f.read_only === true,
    mandatory: f.system_mandatory === true,
  };
  if (typeof f.length === 'number') meta.length = f.length;
  const picklist = (f.pick_list_values ?? [])
    .map((p) => p.display_value ?? p.actual_value ?? '')
    .filter((v) => v !== '');
  if (picklist.length > 0) meta.picklistValues = picklist;
  const lookup = lookupModuleOf(f);
  if (lookup) meta.lookupModule = lookup;
  return meta;
}

interface CrmUser {
  id: string;
  full_name?: string;
  email?: string;
  role?: { name?: string };
  profile?: { name?: string };
  status?: string;
}

async function main(): Promise<WrittenPaths> {
  const cfg = resolveZohoConfig('crm');
  const token = await fetchZohoAccessToken(cfg);
  const headers = zohoAuthHeader(token);
  const apiDomain = crmBase(token);

  // Org profile + users (best-effort: a token without these scopes still produces a useful catalog).
  const orgRes = await tryGetJson<{ org?: Array<Record<string, unknown>> }>(`${apiDomain}/org`, headers);
  const org = orgRes.ok ? (orgRes.data.org?.[0] ?? {}) : {};
  if (!orgRes.ok) console.warn(`[zoho-crm] org skipped: ${orgRes.error}`);

  const usersRes = await tryGetJson<{ users?: CrmUser[] }>(`${apiDomain}/users?type=AllUsers`, headers);
  const users = usersRes.ok
    ? (usersRes.data.users ?? []).map((u) => ({
        id: u.id,
        name: u.full_name ?? '',
        email: u.email ?? '',
        role: u.role?.name ?? '',
        profile: u.profile?.name ?? '',
        status: u.status ?? '',
      }))
    : [];
  if (!usersRes.ok) console.warn(`[zoho-crm] users skipped: ${usersRes.error}`);

  console.log(`[zoho-crm] fetching modules from ${apiDomain}`);
  const { modules } = await getJson<{ modules: CrmModule[] }>(`${apiDomain}/settings/modules`, headers);

  const result: ModuleMeta[] = [];
  for (const mod of modules) {
    const apiSupported = mod.api_supported !== false;
    const label = mod.plural_label ?? mod.module_name ?? mod.api_name;
    const generatedType = mod.generated_type ?? 'default';
    const base: ModuleMeta = {
      apiName: mod.api_name,
      label,
      apiSupported,
      custom: generatedType === 'custom',
      generatedType,
      fieldCount: 0,
      fields: [],
      relatedLists: [],
    };
    if (!apiSupported) {
      result.push(base);
      continue;
    }

    const fieldsRes = await tryGetJson<{ fields: CrmField[] }>(
      `${apiDomain}/settings/fields?module=${encodeURIComponent(mod.api_name)}`,
      headers,
    );
    if (fieldsRes.ok) {
      base.fields = (fieldsRes.data.fields ?? []).map(mapField);
      base.fieldCount = base.fields.length;
    } else {
      base.fieldsError = fieldsRes.error;
      console.warn(`[zoho-crm] fields for ${mod.api_name} skipped: ${fieldsRes.error}`);
    }

    const relRes = await tryGetJson<{ related_lists?: Array<{ api_name?: string; module?: { api_name?: string } | string; display_label?: string }> }>(
      `${apiDomain}/settings/related_lists?module=${encodeURIComponent(mod.api_name)}`,
      headers,
    );
    if (relRes.ok) {
      base.relatedLists = (relRes.data.related_lists ?? [])
        .map((r) => {
          const relModule = typeof r.module === 'string' ? r.module : (r.module?.api_name ?? '');
          return { apiName: r.api_name ?? '', module: relModule, label: r.display_label ?? '' };
        })
        .filter((r) => r.apiName !== '' || r.module !== '');
    } else {
      base.relatedListsError = relRes.error;
    }

    result.push(base);
    console.log(`[zoho-crm]   ${mod.api_name}: ${base.fieldCount} fields, ${base.relatedLists.length} related lists`);
  }

  const customModules = result.filter((m) => m.custom).map((m) => m.apiName);
  const json = {
    service: 'zoho-crm',
    generatedAt: nowIso(),
    apiDomain,
    org,
    userCount: users.length,
    users,
    moduleCount: result.length,
    customModules,
    modules: result,
  };

  const lines: string[] = [
    '# Zoho CRM metadata',
    '',
    `Generated: ${json.generatedAt}`,
    `API domain: ${apiDomain}`,
    `Modules: ${result.length} (custom: ${customModules.length}) · Users: ${users.length}`,
    '',
  ];
  if (typeof org.company_name === 'string') lines.push(`Org: ${org.company_name}`, '');
  if (customModules.length > 0) lines.push(`Custom modules: ${customModules.map((m) => `\`${m}\``).join(', ')}`, '');
  if (users.length > 0) {
    lines.push('## Users', '', '| Name | Email | Role | Profile | Status |', '| --- | --- | --- | --- | --- |');
    for (const u of users) lines.push(`| ${u.name} | ${u.email} | ${u.role} | ${u.profile} | ${u.status} |`);
    lines.push('');
  }
  for (const m of result) {
    lines.push(`## ${m.label} — \`${m.apiName}\`${m.custom ? ' _(custom)_' : ''}`);
    if (m.fieldsError) {
      lines.push('', `> fields unavailable: ${m.fieldsError}`, '');
    } else if (m.fields.length === 0) {
      lines.push('', '> no fields / not API-supported', '');
    } else {
      lines.push('', '| Field API name | Label | Type | Custom | Mandatory | Lookup→ | Picklist values |');
      lines.push('| --- | --- | --- | --- | --- | --- | --- |');
      for (const f of m.fields) {
        const pick = f.picklistValues
          ? f.picklistValues.slice(0, MAX_PICKLIST_IN_MD).join(', ') +
            (f.picklistValues.length > MAX_PICKLIST_IN_MD ? `, …(+${f.picklistValues.length - MAX_PICKLIST_IN_MD})` : '')
          : '';
        lines.push(
          `| \`${f.apiName}\` | ${f.label} | ${f.dataType} | ${f.custom ? 'yes' : ''} | ${f.mandatory ? 'yes' : ''} | ${f.lookupModule ? `\`${f.lookupModule}\`` : ''} | ${pick} |`,
        );
      }
      lines.push('');
    }
    if (m.relatedLists.length > 0) {
      lines.push(`Related lists: ${m.relatedLists.map((r) => `\`${r.apiName || r.module}\``).join(', ')}`, '');
    }
  }

  return writeMetadata('zoho-crm', json, lines.join('\n'));
}

runAnalyzer('zoho-crm', main);
