/**
 * Zoho People metadata analyzer — forms (= modules) + field apiName + data type.
 *
 * Endpoints (ZOHO_PEOPLE_BASE_URL, default https://people.zoho.com/api):
 *   GET {base}/forms
 *   GET {base}/forms/{formLinkName}/components
 *
 * Usage:
 *   pnpm meta:zoho-people
 *   pnpm meta:zoho-people -- --module=employee
 *   pnpm meta:zoho-people -- --module=employee,department --list
 *
 * Requires ZOHOPEOPLE.forms.READ (or .ALL). See .claude/skills/zoho-people-api/SKILL.md.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';
import { parsePeopleCliArgs, peopleCliHelp } from './lib/peopleArgs.js';
import {
  fetchFormFields,
  filterForms,
  formApiName,
  listPeopleForms,
  toFormMeta,
  type PeopleFormMeta,
} from './lib/peopleForms.js';
import { fetchZohoAccessToken, resolveZohoConfig, zohoAuthHeader } from './lib/zohoAuth.js';

const MAX_PICKLIST_IN_MD = 25;

async function main(): Promise<WrittenPaths> {
  const args = parsePeopleCliArgs();
  if (args.help) {
    console.log(peopleCliHelp('meta'));
    process.exit(0);
  }

  const cfg = resolveZohoConfig('people');
  const token = await fetchZohoAccessToken(cfg);
  const headers = zohoAuthHeader(token);
  const base = env.ZOHO_PEOPLE_BASE_URL.replace(/\/+$/, '');

  console.log(`[zoho-people] listing forms from ${base}`);
  const allForms = await listPeopleForms(base, headers);
  const forms = filterForms(allForms, args.modules);
  console.log(
    `[zoho-people] ${forms.length}/${allForms.length} form(s)` +
      (args.modules.length ? ` matching ${args.modules.join(',')}` : ''),
  );

  const result: PeopleFormMeta[] = [];

  for (const form of forms) {
    const linkName = formApiName(form);
    if (!linkName) continue;

    if (args.listOnly) {
      result.push(toFormMeta(form, []));
      console.log(`[zoho-people]   ${linkName} — ${form.displayName ?? linkName}`);
      continue;
    }

    const { fields, error } = await fetchFormFields(base, headers, linkName);
    if (error) {
      console.warn(`[zoho-people] components for ${linkName} skipped: ${error}`);
      result.push(toFormMeta(form, [], error));
      continue;
    }
    result.push(toFormMeta(form, fields));
    console.log(`[zoho-people]   ${linkName}: ${fields.length} fields`);
  }

  const outName =
    args.modules.length === 1 && args.modules[0]
      ? `zoho-people-${args.modules[0].replace(/[^\w.-]+/g, '_')}`
      : 'zoho-people';

  const json = {
    service: 'zoho-people',
    generatedAt: nowIso(),
    base,
    filter: args.modules.length ? args.modules : null,
    listOnly: args.listOnly,
    formCount: result.length,
    forms: result.map((f) => ({
      apiName: f.apiName,
      displayName: f.displayName,
      isCustom: f.isCustom,
      viewName: f.viewName ?? null,
      fieldCount: f.fieldCount,
      fields: f.fields.map((field) => ({
        apiName: field.apiName,
        label: field.label,
        dataType: field.dataType,
        mandatory: field.mandatory,
        ...(field.componentId ? { componentId: field.componentId } : {}),
        ...(field.maxLength !== undefined ? { maxLength: field.maxLength } : {}),
        ...(field.options ? { options: field.options } : {}),
      })),
      ...(f.error ? { error: f.error } : {}),
    })),
  };

  const lines: string[] = [
    '# Zoho People metadata',
    '',
    `Generated: ${json.generatedAt}`,
    `Base: ${base}`,
    `Forms: ${result.length}` +
      (args.modules.length ? ` (filter: ${args.modules.join(', ')})` : '') +
      (args.listOnly ? ' — list only' : ''),
    '',
    'Each form is a People "module". Field **apiName** = `labelname`; **dataType** = `comptype`.',
    '',
  ];

  for (const f of result) {
    lines.push(`## ${f.displayName} — \`${f.apiName}\``);
    if (f.viewName) lines.push('', `Default view: \`${f.viewName}\``);
    if (f.error) {
      lines.push('', `> fields unavailable: ${f.error}`, '');
      continue;
    }
    if (args.listOnly) {
      lines.push('', `_Use without --list to fetch fields._`, '');
      continue;
    }
    lines.push(
      '',
      '| Field API name | Label | Data type | Mandatory | Options |',
      '| --- | --- | --- | --- | --- |',
    );
    for (const field of f.fields) {
      const opts = field.options
        ? field.options.slice(0, MAX_PICKLIST_IN_MD).join(', ') +
          (field.options.length > MAX_PICKLIST_IN_MD
            ? `, …(+${field.options.length - MAX_PICKLIST_IN_MD})`
            : '')
        : '';
      lines.push(
        `| \`${field.apiName}\` | ${field.label} | ${field.dataType} | ${field.mandatory ? 'yes' : ''} | ${opts} |`,
      );
    }
    lines.push('');
  }

  return writeMetadata(outName, json, lines.join('\n'));
}

runAnalyzer('zoho-people', main);
