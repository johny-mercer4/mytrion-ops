/**
 * zohoMetadataFetcher — fetch field metadata for one Zoho module by API name.
 *
 * Given a service (`crm` | `desk`) and a module API name, returns every field's
 * `api_name` / `apiName` and data type. Uses PROD credentials from `.env`
 * (`ZOHO_CRM_*` / `ZOHO_DESK_*` — not the sandbox refresh token).
 *
 * Endpoints (from official docs):
 *   CRM  GET {ZOHO_CRM_API_DOMAIN}/settings/fields?module={api_name}
 *        scope ZohoCRM.settings.fields.READ
 *        docs  https://www.zoho.com/crm/developer/docs/api/v8/field-meta.html
 *   Desk GET {ZOHO_DESK_BASE_URL}/organizationFields?module={api_name}
 *        headers Authorization + orgId
 *        scope Desk.basic.READ
 *        docs  https://desk.zoho.com/DeskAPIDocument#OrganizationFields
 *
 * Usage:
 *   pnpm meta:fetch -- crm Leads
 *   pnpm meta:fetch -- desk tickets
 *   pnpm meta:fetch -- crm Deals --write
 *   pnpm meta:fetch -- desk contacts --json
 *
 * Flags:
 *   --json     print only the fields array as JSON (no banner)
 *   --write    also write metadataScripts/output/zoho-{service}-{module}.{json,md}
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { getJson } from './lib/http.js';
import { nowIso, writeMetadata } from './lib/output.js';
import {
  fetchZohoAccessToken,
  resolveZohoConfig,
  zohoAuthHeader,
  type ZohoToken,
} from './lib/zohoAuth.js';

type Service = 'crm' | 'desk';

interface FieldRow {
  apiName: string;
  dataType: string;
  label?: string;
  jsonType?: string;
  custom?: boolean;
  mandatory?: boolean;
  readOnly?: boolean;
  length?: number;
  /** CRM: lookup target module. Desk: related module name when present. */
  lookupModule?: string;
  /** Picklist / allowed values (truncated in markdown; full in JSON). */
  picklistValues?: string[];
}

interface FetchResult {
  service: Service;
  module: string;
  fetchedAt: string;
  fieldCount: number;
  fields: FieldRow[];
}

const DESK_MODULES = new Set([
  'tickets',
  'contacts',
  'accounts',
  'tasks',
  'calls',
  'events',
  'contracts',
  'products',
]);

function usage(exitCode = 1): never {
  console.error(`Usage: pnpm meta:fetch -- <crm|desk> <ModuleApiName> [--json] [--write]

Examples:
  pnpm meta:fetch -- crm Leads
  pnpm meta:fetch -- desk tickets
  pnpm meta:fetch -- crm Deals --write --json

Uses PROD Zoho credentials from .env (ZOHO_CRM_REFRESH_TOKEN / ZOHO_DESK_REFRESH_TOKEN).`);
  process.exit(exitCode);
}

function parseArgs(argv: string[]): {
  service: Service;
  module: string;
  jsonOnly: boolean;
  write: boolean;
} {
  const positional: string[] = [];
  let jsonOnly = false;
  let write = false;
  for (const arg of argv) {
    if (arg === '--') continue; // pnpm/npm sometimes forward the separator
    if (arg === '--json') jsonOnly = true;
    else if (arg === '--write') write = true;
    else if (arg === '--help' || arg === '-h') usage(0);
    else if (arg.startsWith('-')) {
      console.error(`Unknown flag: ${arg}`);
      usage(1);
    } else positional.push(arg);
  }
  if (positional.length < 2) usage(1);
  const serviceRaw = positional[0]!.toLowerCase();
  if (serviceRaw !== 'crm' && serviceRaw !== 'desk') {
    console.error(`Service must be "crm" or "desk", got "${positional[0]}"`);
    usage(1);
  }
  return { service: serviceRaw, module: positional[1]!, jsonOnly, write };
}

function crmBase(token: ZohoToken): string {
  const configured = env.ZOHO_CRM_API_DOMAIN.replace(/\/+$/, '');
  if (configured) return configured;
  if (token.apiDomain) return `${token.apiDomain.replace(/\/+$/, '')}/crm/v8`;
  throw new Error('[zohoMetadataFetcher] set ZOHO_CRM_API_DOMAIN');
}

interface CrmField {
  api_name?: string;
  field_label?: string;
  display_label?: string;
  data_type?: string;
  json_type?: string;
  custom_field?: boolean;
  read_only?: boolean;
  system_mandatory?: boolean;
  length?: number;
  pick_list_values?: Array<{ display_value?: string; actual_value?: string }>;
  lookup?: { module?: { api_name?: string } | string };
}

interface DeskField {
  apiName?: string;
  name?: string;
  displayLabel?: string;
  type?: string;
  isCustomField?: boolean;
  isMandatory?: boolean;
  maxLength?: number;
  allowedValues?: Array<string | { value?: string; name?: string }>;
  module?: { name?: string; apiName?: string };
}

function mapCrmField(f: CrmField): FieldRow | null {
  const apiName = f.api_name?.trim();
  if (!apiName) return null;
  const row: FieldRow = {
    apiName,
    dataType: f.data_type ?? 'unknown',
    label: f.field_label ?? f.display_label ?? apiName,
  };
  if (f.json_type) row.jsonType = f.json_type;
  if (f.custom_field === true) row.custom = true;
  if (f.system_mandatory === true) row.mandatory = true;
  if (f.read_only === true) row.readOnly = true;
  if (typeof f.length === 'number') row.length = f.length;
  const lookup = f.lookup?.module;
  const lookupName = typeof lookup === 'string' ? lookup : lookup?.api_name;
  if (lookupName) row.lookupModule = lookupName;
  const picks = (f.pick_list_values ?? [])
    .map((p) => p.actual_value ?? p.display_value ?? '')
    .filter((v) => v !== '');
  if (picks.length > 0) row.picklistValues = picks;
  return row;
}

function mapDeskField(f: DeskField): FieldRow | null {
  const apiName = (f.apiName ?? f.name ?? '').trim();
  if (!apiName) return null;
  const row: FieldRow = {
    apiName,
    dataType: f.type ?? 'unknown',
    label: f.displayLabel ?? f.name ?? apiName,
  };
  if (f.isCustomField === true) row.custom = true;
  if (f.isMandatory === true) row.mandatory = true;
  if (typeof f.maxLength === 'number') row.length = f.maxLength;
  const deskModule = f.module?.apiName ?? f.module?.name;
  if (deskModule) row.lookupModule = deskModule;
  const values = (f.allowedValues ?? [])
    .map((v) => (typeof v === 'string' ? v : (v.value ?? v.name ?? '')))
    .filter((v) => v !== '');
  if (values.length > 0) row.picklistValues = values;
  return row;
}

async function fetchCrmFields(moduleApiName: string): Promise<FetchResult> {
  const cfg = resolveZohoConfig('crm');
  const token = await fetchZohoAccessToken(cfg);
  const base = crmBase(token);
  const url = `${base}/settings/fields?module=${encodeURIComponent(moduleApiName)}`;
  console.error(`[zohoMetadataFetcher] CRM PROD → GET ${url}`);
  const body = await getJson<{ fields?: CrmField[] }>(url, zohoAuthHeader(token));
  const fields = (body.fields ?? [])
    .map(mapCrmField)
    .filter((f): f is FieldRow => f !== null)
    .sort((a, b) => a.apiName.localeCompare(b.apiName));
  return {
    service: 'crm',
    module: moduleApiName,
    fetchedAt: nowIso(),
    fieldCount: fields.length,
    fields,
  };
}

async function fetchDeskFields(moduleApiName: string): Promise<FetchResult> {
  const normalized = moduleApiName.toLowerCase();
  if (!DESK_MODULES.has(normalized)) {
    console.error(
      `[zohoMetadataFetcher] warning: "${moduleApiName}" is not in the known Desk module enum ` +
        `(${[...DESK_MODULES].join(', ')}). Trying anyway.`,
    );
  }
  const cfg = resolveZohoConfig('desk');
  const token = await fetchZohoAccessToken(cfg);
  const base = env.ZOHO_DESK_BASE_URL.replace(/\/+$/, '');
  let orgId = env.ZOHO_DESK_ORG_ID;
  if (!orgId) {
    const orgs = await getJson<{ data?: Array<{ id: string }> }>(
      `${base}/organizations`,
      zohoAuthHeader(token),
    );
    orgId = orgs.data?.[0]?.id ?? '';
  }
  if (!orgId) {
    throw new Error('[zohoMetadataFetcher] set ZOHO_DESK_ORG_ID (PROD org)');
  }
  const url = `${base}/organizationFields?module=${encodeURIComponent(normalized)}`;
  console.error(`[zohoMetadataFetcher] Desk PROD org=${orgId} → GET ${url}`);
  const body = await getJson<{ data?: DeskField[] }>(url, {
    ...zohoAuthHeader(token),
    orgId,
  });
  const fields = (body.data ?? [])
    .map(mapDeskField)
    .filter((f): f is FieldRow => f !== null)
    .sort((a, b) => a.apiName.localeCompare(b.apiName));
  return {
    service: 'desk',
    module: normalized,
    fetchedAt: nowIso(),
    fieldCount: fields.length,
    fields,
  };
}

function toMarkdown(result: FetchResult): string {
  const lines: string[] = [
    `# Zoho ${result.service.toUpperCase()} — \`${result.module}\` fields`,
    '',
    `Fetched at ${result.fetchedAt} (PROD credentials). **${result.fieldCount}** fields.`,
    '',
    '| API name | Data type | Label | Custom | Mandatory |',
    '| --- | --- | --- | --- | --- |',
  ];
  for (const f of result.fields) {
    const label = (f.label ?? '').replace(/\|/g, '\\|');
    lines.push(
      `| \`${f.apiName}\` | \`${f.dataType}\` | ${label} | ${f.custom ? 'yes' : ''} | ${f.mandatory ? 'yes' : ''} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function printTable(result: FetchResult): void {
  const nameW = Math.max(8, ...result.fields.map((f) => f.apiName.length));
  const typeW = Math.max(9, ...result.fields.map((f) => f.dataType.length));
  console.log(
    `${'api_name'.padEnd(nameW)}  ${'data_type'.padEnd(typeW)}  label`,
  );
  console.log(`${'-'.repeat(nameW)}  ${'-'.repeat(typeW)}  -----`);
  for (const f of result.fields) {
    console.log(
      `${f.apiName.padEnd(nameW)}  ${f.dataType.padEnd(typeW)}  ${f.label ?? ''}`,
    );
  }
  console.log(`\n${result.fieldCount} fields (${result.service}/${result.module})`);
}

async function main(): Promise<void> {
  const { service, module, jsonOnly, write } = parseArgs(process.argv.slice(2));
  const result =
    service === 'crm' ? await fetchCrmFields(module) : await fetchDeskFields(module);

  if (jsonOnly) {
    console.log(JSON.stringify(result.fields, null, 2));
  } else {
    printTable(result);
  }

  if (write) {
    const safeModule = result.module.replace(/[^a-zA-Z0-9_-]/g, '_');
    const name = `zoho-${result.service}-${safeModule}`;
    const paths = await writeMetadata(name, result, toMarkdown(result));
    console.error(`[zohoMetadataFetcher] wrote:\n  ${paths.jsonPath}\n  ${paths.mdPath}`);
  }
}

main().catch((err: unknown) => {
  console.error('[zohoMetadataFetcher] failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
