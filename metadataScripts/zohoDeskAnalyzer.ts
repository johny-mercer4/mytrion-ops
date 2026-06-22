/**
 * Zoho Desk metadata analyzer.
 *
 * Pulls org + departments + agents + teams + per-module field metadata (including each field's
 * allowedValues / picklist options and custom flag) so Desk tools and RAG target real API names.
 * ZOHO_DESK_BASE_URL is the full versioned root (e.g. https://desk.zoho.com/api/v1):
 *   - GET {base}/organizations
 *   - GET {base}/departments | /agents | /teams           (orgId header)
 *   - GET {base}/organizationFields?module={module}        (orgId header, per module)
 *
 * Requires a refresh token with Desk read scopes (e.g. `Desk.settings.READ`, `Desk.basic.READ`).
 * Set ZOHO_DESK_ORG_ID to pin an org, else the first org is used. Run: `pnpm meta:zoho-desk`.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { tryGetJson } from './lib/http.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';
import { fetchZohoAccessToken, resolveZohoConfig, zohoAuthHeader } from './lib/zohoAuth.js';

/** Desk modules whose field catalogs we sweep. Extend as needed. */
const DESK_MODULES = ['tickets', 'contacts', 'accounts', 'tasks', 'calls', 'events', 'products'] as const;
const MAX_PICKLIST_IN_MD = 25;

interface DeskOrg {
  id: string;
  companyName?: string;
  portalName?: string;
}

interface DeskNamed {
  id: string;
  name?: string;
  isEnabled?: boolean;
  email?: string;
}

interface DeskField {
  apiName?: string;
  name?: string;
  displayLabel?: string;
  type?: string;
  isCustomField?: boolean;
  isMandatory?: boolean;
  allowedValues?: Array<string | { value?: string; name?: string }>;
}

interface DeskFieldMeta {
  apiName: string;
  label: string;
  type: string;
  custom: boolean;
  mandatory: boolean;
  allowedValues?: string[];
}

function mapField(f: DeskField): DeskFieldMeta {
  const meta: DeskFieldMeta = {
    apiName: f.apiName ?? f.name ?? '',
    label: f.displayLabel ?? f.name ?? '',
    type: f.type ?? 'unknown',
    custom: f.isCustomField === true,
    mandatory: f.isMandatory === true,
  };
  const values = (f.allowedValues ?? [])
    .map((v) => (typeof v === 'string' ? v : (v.value ?? v.name ?? '')))
    .filter((v) => v !== '');
  if (values.length > 0) meta.allowedValues = values;
  return meta;
}

async function fetchNamedList(
  base: string,
  headers: Record<string, string>,
  path: string,
): Promise<Array<{ id: string; name: string }>> {
  const res = await tryGetJson<{ data: DeskNamed[] }>(`${base}/${path}`, headers);
  if (!res.ok) {
    console.warn(`[zoho-desk] ${path} skipped: ${res.error}`);
    return [];
  }
  return (res.data.data ?? []).map((d) => ({ id: d.id, name: d.name ?? d.email ?? '' }));
}

async function main(): Promise<WrittenPaths> {
  const cfg = resolveZohoConfig('desk');
  const token = await fetchZohoAccessToken(cfg);
  const authHeaders = zohoAuthHeader(token);
  const base = env.ZOHO_DESK_BASE_URL.replace(/\/+$/, '');

  // Resolve org id: configured, else first org returned.
  let orgId = env.ZOHO_DESK_ORG_ID;
  const orgsRes = await tryGetJson<{ data: DeskOrg[] }>(`${base}/organizations`, authHeaders);
  const orgs = orgsRes.ok ? (orgsRes.data.data ?? []) : [];
  if (!orgId && orgs[0]) orgId = orgs[0].id;
  if (!orgId) {
    throw new Error('[zoho-desk] no org id — set ZOHO_DESK_ORG_ID or grant org read scope');
  }
  const headers = { ...authHeaders, orgId };
  console.log(`[zoho-desk] org ${orgId} on ${base}`);

  const deptRes = await tryGetJson<{ data: DeskNamed[] }>(`${base}/departments`, headers);
  const departments = deptRes.ok
    ? (deptRes.data.data ?? []).map((d) => ({ id: d.id, name: d.name ?? '', enabled: d.isEnabled !== false }))
    : [];
  if (!deptRes.ok) console.warn(`[zoho-desk] departments skipped: ${deptRes.error}`);

  const agents = await fetchNamedList(base, headers, 'agents');
  const teams = await fetchNamedList(base, headers, 'teams');

  const modules: Array<{
    module: string;
    fieldCount: number;
    fields: DeskFieldMeta[];
    error?: string;
  }> = [];
  for (const module of DESK_MODULES) {
    const res = await tryGetJson<{ data: DeskField[] }>(`${base}/organizationFields?module=${module}`, headers);
    if (!res.ok) {
      console.warn(`[zoho-desk] fields for ${module} skipped: ${res.error}`);
      modules.push({ module, fieldCount: 0, fields: [], error: res.error });
      continue;
    }
    const fields = (res.data.data ?? []).map(mapField);
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
    agentCount: agents.length,
    agents,
    teamCount: teams.length,
    teams,
    modules,
  };

  const lines: string[] = [
    '# Zoho Desk metadata',
    '',
    `Generated: ${json.generatedAt}`,
    `Base: ${base} · Org: ${orgId}`,
    `Departments: ${departments.length} · Agents: ${agents.length} · Teams: ${teams.length}`,
    '',
    `## Departments (${departments.length})`,
    '',
    '| Id | Name | Enabled |',
    '| --- | --- | --- |',
    ...departments.map((d) => `| \`${d.id}\` | ${d.name} | ${d.enabled ? 'yes' : 'no'} |`),
    '',
  ];
  if (teams.length > 0) {
    lines.push(`## Teams (${teams.length})`, '', '| Id | Name |', '| --- | --- |');
    for (const t of teams) lines.push(`| \`${t.id}\` | ${t.name} |`);
    lines.push('');
  }
  for (const m of modules) {
    lines.push(`## Module: \`${m.module}\``);
    if (m.error) {
      lines.push('', `> fields unavailable: ${m.error}`, '');
      continue;
    }
    lines.push('', '| Field API name | Label | Type | Custom | Mandatory | Allowed values |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const f of m.fields) {
      const vals = f.allowedValues
        ? f.allowedValues.slice(0, MAX_PICKLIST_IN_MD).join(', ') +
          (f.allowedValues.length > MAX_PICKLIST_IN_MD ? `, …(+${f.allowedValues.length - MAX_PICKLIST_IN_MD})` : '')
        : '';
      lines.push(`| \`${f.apiName}\` | ${f.label} | ${f.type} | ${f.custom ? 'yes' : ''} | ${f.mandatory ? 'yes' : ''} | ${vals} |`);
    }
    lines.push('');
  }

  return writeMetadata('zoho-desk', json, lines.join('\n'));
}

runAnalyzer('zoho-desk', main);
