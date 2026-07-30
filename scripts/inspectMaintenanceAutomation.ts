import 'dotenv/config';
/**
 * Read-only inspection of the AUTOMATION attached to the Zoho CRM `Maintenance` module — workflow
 * rules and the actions they fire.
 *
 *   pnpm tsx scripts/inspectMaintenanceAutomation.ts
 *
 * Why this exists: `scripts/inspectMaintenanceModule.ts` captured the module's *data* (fields,
 * picklists, volume) and that is what `maintenance_cases` mirrors. It captured none of the module's
 * *behaviour*. Zoho workflow rules fire on Zoho records only, so every rule on this module stopped
 * applying the moment cases began being created in Postgres — silently, because a rule that does not
 * run produces no error, just a field that never gets set or a notification nobody receives.
 *
 * Writes nothing. Prints each rule's trigger, conditions and actions so the behaviour can be
 * reimplemented deliberately rather than inferred from field names.
 *
 * Endpoints (Zoho CRM v6 settings API, all GET):
 *   /settings/automation/workflow_rules?module=Maintenance   list + per-rule detail
 *   /settings/automation/actions/field_updates              field-update action bodies
 *   /settings/automation/actions/webhooks                   webhook action bodies
 *   /settings/automation/actions/email_notifications        email action bodies
 *
 * A 204/404 on any of these means "none configured" (or the token lacks
 * ZohoCRM.settings.ALL scope) — reported, not thrown, so one missing scope cannot hide the rest.
 */
import { authHeaders, baseUrl } from '../src/integrations/zohoAuth.js';

const MODULE = 'Maintenance';

/* eslint-disable no-console */
const log = (line = ''): void => console.log(line);

interface Fetched {
  status: number;
  json: Record<string, unknown> | null;
}

async function get(path: string): Promise<Fetched> {
  const headers = await authHeaders('zoho_crm');
  const res = await fetch(`${baseUrl('zoho_crm')}${path}`, { headers });
  if (res.status === 204) return { status: 204, json: null };
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { status: res.status, json: { raw: text.slice(0, 400) } };
  }
}

/** Print an arbitrary nested value compactly — rule bodies vary a lot by rule type. */
function dump(value: unknown, indent = '    '): void {
  const text = JSON.stringify(value, null, 2) ?? 'null';
  for (const line of text.split('\n')) log(`${indent}${line}`);
}

async function main(): Promise<void> {
  log(`\n# Automation on the Zoho CRM \`${MODULE}\` module\n`);

  const list = await get(
    `/settings/automation/workflow_rules?module=${encodeURIComponent(MODULE)}`,
  );
  if (list.status !== 200 || !list.json) {
    log(`workflow_rules → HTTP ${list.status} (no rules readable)`);
    if (list.json) dump(list.json, '  ');
    log('\nIf this is 401/403 the token is missing ZohoCRM.settings.ALL — the rules may still exist.');
    return;
  }

  const rules = (list.json.workflow_rules ?? []) as Array<Record<string, unknown>>;
  log(`## Rules (${rules.length})\n`);

  for (const r of rules) {
    const id = String(r.id ?? '');
    log(`### ${String(r.name ?? '(unnamed)')}`);
    log(`- id: ${id}`);
    log(`- active: ${String(r.active ?? '?')}`);
    log(`- description: ${String(r.description ?? '—')}`);
    log(`- execute_when: ${JSON.stringify(r.execute_when ?? r.when ?? null)}`);
    log('');

    // The list payload is a summary; the per-rule GET carries conditions + actions.
    const detail = await get(`/settings/automation/workflow_rules/${encodeURIComponent(id)}`);
    if (detail.status === 200 && detail.json) {
      const full = ((detail.json.workflow_rules as Array<Record<string, unknown>>) ?? [])[0] ?? {};
      log('  full rule:');
      dump(full);
    } else {
      log(`  detail → HTTP ${detail.status}`);
    }
    log('');
  }

  for (const [label, path] of [
    ['field updates', '/settings/automation/actions/field_updates'],
    ['webhooks', '/settings/automation/actions/webhooks'],
    ['email notifications', '/settings/automation/actions/email_notifications'],
  ] as const) {
    const res = await get(`${path}?module=${encodeURIComponent(MODULE)}`);
    log(`## Actions — ${label} (HTTP ${res.status})`);
    if (res.json) dump(res.json, '  ');
    log('');
  }
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('\ninspectMaintenanceAutomation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
