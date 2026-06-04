/**
 * Zoho CRM metadata analyzer.
 *
 * Pulls the full module + field catalog from Zoho CRM v6 so we can build tools against
 * the real API names (not guesses):
 *   - GET {apiDomain}/crm/v6/settings/modules
 *   - GET {apiDomain}/crm/v6/settings/fields?module={api_name}   (per module, best-effort)
 *
 * Requires a refresh token with at least `ZohoCRM.settings.modules.READ` and
 * `ZohoCRM.settings.fields.READ` scopes. Run: `pnpm meta:zoho-crm`.
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

interface CrmModule {
  api_name: string;
  module_name?: string;
  plural_label?: string;
  singular_label?: string;
  api_supported?: boolean;
  generated_type?: string;
}

interface CrmField {
  api_name: string;
  field_label?: string;
  data_type?: string;
  custom_field?: boolean;
  read_only?: boolean;
  system_mandatory?: boolean;
}

interface ModuleMeta {
  apiName: string;
  label: string;
  apiSupported: boolean;
  fieldCount: number;
  fields: Array<{
    apiName: string;
    label: string;
    dataType: string;
    custom: boolean;
    readOnly: boolean;
    mandatory: boolean;
  }>;
  fieldsError?: string;
}

function crmApiDomain(token: ZohoToken): string {
  return token.apiDomain ?? env.ZOHO_CRM_API_DOMAIN;
}

async function main(): Promise<WrittenPaths> {
  const cfg = resolveZohoConfig('crm');
  const token = await fetchZohoAccessToken(cfg);
  const headers = zohoAuthHeader(token);
  const apiDomain = crmApiDomain(token);

  console.log(`[zoho-crm] fetching modules from ${apiDomain}`);
  const { modules } = await getJson<{ modules: CrmModule[] }>(
    `${apiDomain}/crm/v6/settings/modules`,
    headers,
  );

  const result: ModuleMeta[] = [];
  for (const mod of modules) {
    const apiSupported = mod.api_supported !== false;
    const label = mod.plural_label ?? mod.module_name ?? mod.api_name;
    if (!apiSupported) {
      result.push({ apiName: mod.api_name, label, apiSupported, fieldCount: 0, fields: [] });
      continue;
    }
    const fieldsRes = await tryGetJson<{ fields: CrmField[] }>(
      `${apiDomain}/crm/v6/settings/fields?module=${encodeURIComponent(mod.api_name)}`,
      headers,
    );
    if (!fieldsRes.ok) {
      console.warn(`[zoho-crm] fields for ${mod.api_name} skipped: ${fieldsRes.error}`);
      result.push({
        apiName: mod.api_name,
        label,
        apiSupported,
        fieldCount: 0,
        fields: [],
        fieldsError: fieldsRes.error,
      });
      continue;
    }
    const fields = (fieldsRes.data.fields ?? []).map((f) => ({
      apiName: f.api_name,
      label: f.field_label ?? f.api_name,
      dataType: f.data_type ?? 'unknown',
      custom: f.custom_field === true,
      readOnly: f.read_only === true,
      mandatory: f.system_mandatory === true,
    }));
    result.push({ apiName: mod.api_name, label, apiSupported, fieldCount: fields.length, fields });
    console.log(`[zoho-crm]   ${mod.api_name}: ${fields.length} fields`);
  }

  const json = { service: 'zoho-crm', generatedAt: nowIso(), apiDomain, moduleCount: result.length, modules: result };

  const lines: string[] = [
    '# Zoho CRM metadata',
    '',
    `Generated: ${json.generatedAt}`,
    `API domain: ${apiDomain}`,
    `Modules: ${result.length}`,
    '',
  ];
  for (const m of result) {
    lines.push(`## ${m.label} — \`${m.apiName}\``);
    if (m.fieldsError) {
      lines.push('', `> fields unavailable: ${m.fieldsError}`, '');
      continue;
    }
    if (m.fields.length === 0) {
      lines.push('', '> no fields / not API-supported', '');
      continue;
    }
    lines.push('', '| Field API name | Label | Type | Custom | Mandatory |', '| --- | --- | --- | --- | --- |');
    for (const f of m.fields) {
      lines.push(
        `| \`${f.apiName}\` | ${f.label} | ${f.dataType} | ${f.custom ? 'yes' : ''} | ${f.mandatory ? 'yes' : ''} |`,
      );
    }
    lines.push('');
  }

  return writeMetadata('zoho-crm', json, lines.join('\n'));
}

runAnalyzer('zoho-crm', main);
