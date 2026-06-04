/**
 * Zoho Desk metadata analyzer.
 *
 * Pulls org + department + per-module field metadata so Desk tools target real API names:
 *   - GET {base}/api/v1/organizations
 *   - GET {base}/api/v1/departments                         (orgId header)
 *   - GET {base}/api/v1/organizationFields?module={module}  (orgId header, per module)
 *
 * Requires a refresh token with Desk read scopes (e.g. `Desk.settings.READ`,
 * `Desk.basic.READ`). Set ZOHO_DESK_ORG_ID to pin an org, else the first org is used.
 * Run: `pnpm meta:zoho-desk`.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { tryGetJson } from './lib/http.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';
import { fetchZohoAccessToken, resolveZohoConfig, zohoAuthHeader } from './lib/zohoAuth.js';

/** Desk modules whose field catalogs we sweep. Extend as needed. */
const DESK_MODULES = ['tickets', 'contacts', 'accounts', 'tasks', 'calls', 'products'] as const;

interface DeskOrg {
  id: string;
  companyName?: string;
  portalName?: string;
}

interface DeskDepartment {
  id: string;
  name?: string;
  isEnabled?: boolean;
}

interface DeskField {
  apiName?: string;
  name?: string;
  displayLabel?: string;
  type?: string;
  isCustomField?: boolean;
  isMandatory?: boolean;
}

async function main(): Promise<WrittenPaths> {
  const cfg = resolveZohoConfig('desk');
  const token = await fetchZohoAccessToken(cfg);
  const authHeaders = zohoAuthHeader(token);
  const base = env.ZOHO_DESK_BASE_URL;

  // Resolve org id: configured, else first org returned.
  let orgId = env.ZOHO_DESK_ORG_ID;
  const orgsRes = await tryGetJson<{ data: DeskOrg[] }>(`${base}/api/v1/organizations`, authHeaders);
  const orgs = orgsRes.ok ? (orgsRes.data.data ?? []) : [];
  if (!orgId && orgs[0]) orgId = orgs[0].id;
  if (!orgId) {
    throw new Error('[zoho-desk] no org id — set ZOHO_DESK_ORG_ID or grant org read scope');
  }
  const headers = { ...authHeaders, orgId };
  console.log(`[zoho-desk] org ${orgId} on ${base}`);

  const deptRes = await tryGetJson<{ data: DeskDepartment[] }>(`${base}/api/v1/departments`, headers);
  const departments = deptRes.ok
    ? (deptRes.data.data ?? []).map((d) => ({ id: d.id, name: d.name ?? '', enabled: d.isEnabled !== false }))
    : [];
  if (!deptRes.ok) console.warn(`[zoho-desk] departments skipped: ${deptRes.error}`);

  const modules: Array<{
    module: string;
    fieldCount: number;
    fields: Array<{ apiName: string; label: string; type: string; custom: boolean; mandatory: boolean }>;
    error?: string;
  }> = [];
  for (const module of DESK_MODULES) {
    const res = await tryGetJson<{ data: DeskField[] }>(
      `${base}/api/v1/organizationFields?module=${module}`,
      headers,
    );
    if (!res.ok) {
      console.warn(`[zoho-desk] fields for ${module} skipped: ${res.error}`);
      modules.push({ module, fieldCount: 0, fields: [], error: res.error });
      continue;
    }
    const fields = (res.data.data ?? []).map((f) => ({
      apiName: f.apiName ?? f.name ?? '',
      label: f.displayLabel ?? f.name ?? '',
      type: f.type ?? 'unknown',
      custom: f.isCustomField === true,
      mandatory: f.isMandatory === true,
    }));
    modules.push({ module, fieldCount: fields.length, fields });
    console.log(`[zoho-desk]   ${module}: ${fields.length} fields`);
  }

  const json = {
    service: 'zoho-desk',
    generatedAt: nowIso(),
    base,
    orgId,
    organizations: orgs.map((o) => ({ id: o.id, name: o.companyName ?? o.portalName ?? '' })),
    departments,
    modules,
  };

  const lines: string[] = [
    '# Zoho Desk metadata',
    '',
    `Generated: ${json.generatedAt}`,
    `Base: ${base}`,
    `Org: ${orgId}`,
    '',
    `## Departments (${departments.length})`,
    '',
    '| Id | Name | Enabled |',
    '| --- | --- | --- |',
    ...departments.map((d) => `| \`${d.id}\` | ${d.name} | ${d.enabled ? 'yes' : 'no'} |`),
    '',
  ];
  for (const m of modules) {
    lines.push(`## Module: \`${m.module}\``);
    if (m.error) {
      lines.push('', `> fields unavailable: ${m.error}`, '');
      continue;
    }
    lines.push('', '| Field API name | Label | Type | Custom | Mandatory |', '| --- | --- | --- | --- | --- |');
    for (const f of m.fields) {
      lines.push(`| \`${f.apiName}\` | ${f.label} | ${f.type} | ${f.custom ? 'yes' : ''} | ${f.mandatory ? 'yes' : ''} |`);
    }
    lines.push('');
  }

  return writeMetadata('zoho-desk', json, lines.join('\n'));
}

runAnalyzer('zoho-desk', main);
