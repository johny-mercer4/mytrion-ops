/**
 * Zoho People metadata analyzer.
 *
 * People organizes records into "forms" (Employee, Department, Leave, etc.), each with
 * its own fields. We list forms and their field labels/API names:
 *   - GET {base}/people/api/forms                              (list forms)
 *   - GET {base}/people/api/forms/{formLinkName}/components    (fields, best-effort)
 *
 * The People API surface varies by edition; calls are best-effort and whatever metadata
 * returns is written. Requires a refresh token with People read scopes
 * (e.g. `ZOHOPEOPLE.forms.READ`). Run: `pnpm meta:zoho-people`.
 */
import 'dotenv/config';
import { env } from '../src/config/env.js';
import { tryGetJson } from './lib/http.js';
import { nowIso, runAnalyzer, writeMetadata, type WrittenPaths } from './lib/output.js';
import { fetchZohoAccessToken, resolveZohoConfig, zohoAuthHeader } from './lib/zohoAuth.js';

interface PeopleForm {
  formLinkName?: string;
  displayName?: string;
  formName?: string;
  componentName?: string;
}

interface PeopleComponent {
  labelName?: string;
  displayName?: string;
  apiName?: string;
  componentName?: string;
  type?: string;
  mandatory?: boolean | string;
}

function formApiName(f: PeopleForm): string {
  return f.formLinkName ?? f.componentName ?? f.formName ?? '';
}

async function main(): Promise<WrittenPaths> {
  const cfg = resolveZohoConfig('people');
  const token = await fetchZohoAccessToken(cfg);
  const headers = zohoAuthHeader(token);
  const base = env.ZOHO_PEOPLE_BASE_URL;

  console.log(`[zoho-people] listing forms from ${base}`);
  const formsRes = await tryGetJson<{ response?: { result?: PeopleForm[] }; forms?: PeopleForm[] }>(
    `${base}/people/api/forms`,
    headers,
  );
  if (!formsRes.ok) {
    throw new Error(`[zoho-people] forms list failed: ${formsRes.error}`);
  }
  // People wraps results inconsistently across editions — accept either shape.
  const forms = formsRes.data.forms ?? formsRes.data.response?.result ?? [];

  const result: Array<{
    form: string;
    displayName: string;
    fieldCount: number;
    fields: Array<{ apiName: string; label: string; type: string; mandatory: boolean }>;
    error?: string;
  }> = [];

  for (const form of forms) {
    const linkName = formApiName(form);
    const displayName = form.displayName ?? form.formName ?? linkName;
    if (!linkName) continue;
    const compRes = await tryGetJson<{ response?: { result?: PeopleComponent[] }; components?: PeopleComponent[] }>(
      `${base}/people/api/forms/${encodeURIComponent(linkName)}/components`,
      headers,
    );
    if (!compRes.ok) {
      console.warn(`[zoho-people] components for ${linkName} skipped: ${compRes.error}`);
      result.push({ form: linkName, displayName, fieldCount: 0, fields: [], error: compRes.error });
      continue;
    }
    const components = compRes.data.components ?? compRes.data.response?.result ?? [];
    const fields = components.map((c) => ({
      apiName: c.apiName ?? c.componentName ?? c.labelName ?? '',
      label: c.displayName ?? c.labelName ?? '',
      type: c.type ?? 'unknown',
      mandatory: c.mandatory === true || c.mandatory === 'true',
    }));
    result.push({ form: linkName, displayName, fieldCount: fields.length, fields });
    console.log(`[zoho-people]   ${linkName}: ${fields.length} fields`);
  }

  const json = { service: 'zoho-people', generatedAt: nowIso(), base, formCount: result.length, forms: result };

  const lines: string[] = [
    '# Zoho People metadata',
    '',
    `Generated: ${json.generatedAt}`,
    `Base: ${base}`,
    `Forms: ${result.length}`,
    '',
  ];
  for (const f of result) {
    lines.push(`## ${f.displayName} — \`${f.form}\``);
    if (f.error) {
      lines.push('', `> fields unavailable: ${f.error}`, '');
      continue;
    }
    lines.push('', '| Field API name | Label | Type | Mandatory |', '| --- | --- | --- | --- |');
    for (const field of f.fields) {
      lines.push(`| \`${field.apiName}\` | ${field.label} | ${field.type} | ${field.mandatory ? 'yes' : ''} |`);
    }
    lines.push('');
  }

  return writeMetadata('zoho-people', json, lines.join('\n'));
}

runAnalyzer('zoho-people', main);
