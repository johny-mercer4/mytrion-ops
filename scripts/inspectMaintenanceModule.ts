import 'dotenv/config';
/**
 * Read-only inspection of the Zoho CRM `Maintenance` module — the discovery step for the
 * Postgres mirror (`maintenance_cases`) behind the CS Maintenance tab.
 *
 *   pnpm tsx scripts/inspectMaintenanceModule.ts
 *
 * Deliberately narrow: `pnpm meta:zoho-crm` walks EVERY module (dozens of API credits) and dumps
 * the whole org — including the user roster — into a gitignored file. This costs ~5 credits and
 * prints exactly the four things the schema needs and nothing else:
 *
 *   1. the field catalog, which is the only source for the unit-number and company-lookup api
 *      names (no repo references them) and for the real `Case_Type` picklist values;
 *   2. record volume + per-year spread, so the backfill's paging strategy is chosen from data
 *      rather than guessed (offset paging dies past MAX_COQL_OFFSET = 100k per criteria set);
 *   3. one raw record, the only way to see whether currency comes back as 1234.5 or "1,234.50"
 *      and what shape `Owner` / lookups / `Created_By` actually take;
 *   4. whether `Status` is blueprint-controlled — if it is, a plain updateRecord({Status}) is a
 *      silent no-op in Zoho. Harmless for us (Postgres owns writes) but worth knowing before
 *      anyone wires a write-back later.
 *
 * Writes nothing, anywhere. Prints a Markdown-ish report meant to be pasted into
 * docs/crm-maintenance-module.md.
 */
import { runCoql, zohoCrm } from '../src/integrations/zohoCrm.js';
import { zohoCrmRecords, type CrmFieldMeta } from '../src/integrations/zohoCrmRecords.js';

const MODULE = 'Maintenance';

/* eslint-disable no-console */
const log = (line = ''): void => console.log(line);

/** Field types that must never reach a COQL SELECT list — they 400 the whole query. */
const NOISE_TYPES = new Set(['subform', 'multiselectlookup', 'profileimage', 'ownerlookup_metadata']);

/** COQL returns the aggregate under the literal key `COUNT(id)`. */
const countOf = (row: Record<string, unknown> | undefined): number => {
  const v = row?.['COUNT(id)'] ?? row?.['count(id)'] ?? row?.['count'] ?? 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

async function scalarCount(where: string): Promise<number> {
  // A WHERE clause is MANDATORY — a bare `SELECT COUNT(id) FROM Maintenance` is a COQL
  // SYNTAX_ERROR, which is exactly why the CS Home maintenance tile once read 0.
  const { rows } = await runCoql(`SELECT COUNT(id) FROM ${MODULE} WHERE ${where}`);
  return countOf(rows[0]);
}

function picklistSummary(field: CrmFieldMeta): string {
  const values = (field.pick_list_values ?? [])
    .map((v) => v.actual_value ?? v.display_value ?? '')
    .filter((v) => v && v !== '-None-');
  if (values.length === 0) return '';
  return values.join(' | ');
}

async function reportFields(): Promise<CrmFieldMeta[]> {
  const fields = await zohoCrmRecords.getModuleFields(MODULE);
  log(`## Fields (${fields.length})`);
  log();
  log('| api_name | label | data_type | read_only | mandatory | lookup module |');
  log('| --- | --- | --- | --- | --- | --- |');
  for (const f of [...fields].sort((a, b) => a.api_name.localeCompare(b.api_name))) {
    const lookup = (f.lookup as { module?: { api_name?: string } } | undefined)?.module?.api_name ?? '';
    log(
      `| \`${f.api_name}\` | ${f.field_label ?? ''} | ${f.data_type ?? ''} | ` +
        `${f.read_only === true ? 'yes' : ''} | ${f.system_mandatory === true ? 'yes' : ''} | ${lookup} |`,
    );
  }

  const picklists = fields.filter((f) => (f.pick_list_values ?? []).length > 0);
  if (picklists.length > 0) {
    log();
    log('### Picklist values');
    log();
    for (const f of picklists) {
      log(`- \`${f.api_name}\` → ${picklistSummary(f) || '(only -None-)'}`);
    }
  }

  const noisy = fields.filter((f) => NOISE_TYPES.has(String(f.data_type)));
  if (noisy.length > 0) {
    log();
    log(`> Exclude from any COQL SELECT list (would 400): ${noisy.map((f) => `\`${f.api_name}\``).join(', ')}`);
  }

  // The three unknowns this script exists to answer. Surface them explicitly rather than making
  // the reader scan a 60-row table.
  log();
  log('### The unknowns');
  log();
  const guess = (test: (name: string, label: string) => boolean): string => {
    const hits = fields.filter((f) => test(f.api_name.toLowerCase(), (f.field_label ?? '').toLowerCase()));
    return hits.length > 0 ? hits.map((f) => `\`${f.api_name}\` (${f.data_type})`).join(', ') : 'NOT FOUND';
  };
  log(`- unit number → ${guess((n, l) => n.includes('unit') || l.includes('unit'))}`);
  log(
    `- company / account lookup → ${guess(
      (n, l) => n.includes('company') || n.includes('account') || l.includes('company') || l.includes('account'),
    )}`,
  );
  log(`- carrier id → ${guess((n) => n.includes('carrier'))}`);
  log(`- Case_Type values → ${picklistSummary(fields.find((f) => f.api_name === 'Case_Type') ?? { api_name: '' }) || 'NOT FOUND'}`);
  return fields;
}

async function reportVolume(): Promise<void> {
  log();
  log('## Volume');
  log();
  const total = await scalarCount('Created_Time is not null');
  log(`- total records: **${total.toLocaleString()}**`);
  if (total >= 90_000) {
    log('- ⚠️ at/above 90k — the backfill MUST window on `Created_Time` (MAX_COQL_OFFSET = 100k per criteria set)');
  }

  const thisYear = new Date().getFullYear();
  log();
  log('| year | records |');
  log('| --- | --- |');
  for (let year = thisYear; year >= thisYear - 8; year--) {
    // AND is BINARY in COQL: a flat `a and b and c` fails "near where", so the bounds are one
    // parenthesised pair.
    const where =
      `(Created_Time >= '${year}-01-01T00:00:00+00:00' and ` +
      `Created_Time < '${year + 1}-01-01T00:00:00+00:00')`;
    const n = await scalarCount(where).catch(() => -1);
    log(`| ${year} | ${n < 0 ? 'query failed' : n.toLocaleString()} |`);
  }
}

async function reportSampleRecord(): Promise<void> {
  log();
  log('## One raw record (value shapes)');
  log();
  const { rows } = await runCoql(
    `SELECT id FROM ${MODULE} WHERE id is not null ORDER BY id DESC LIMIT 0, 1`,
  );
  const id = String(rows[0]?.id ?? '');
  if (!id) {
    log('_no records in the module_');
    return;
  }
  const record = await zohoCrmRecords.getRecord(MODULE, id);
  log('```json');
  log(JSON.stringify(record, null, 2));
  log('```');

  log();
  log('## Blueprint');
  log();
  const transitions = await zohoCrmRecords.getBlueprintTransitions(MODULE, id).catch(() => []);
  if (transitions.length === 0) {
    log('- no active blueprint transitions on this record → a plain field update is enough.');
  } else {
    log(`- ⚠️ ${transitions.length} blueprint transition(s) available — \`Status\` may be blueprint-gated:`);
    for (const t of transitions) {
      log(`  - ${JSON.stringify(t)}`);
    }
  }
}

async function reportOwnerNameShape(): Promise<void> {
  log();
  log('## Owner name resolution');
  log();
  // COQL returns Owner: {id, name} where `name` is the LAST NAME ONLY. The user directory carries
  // the full name against the same id space — this proves the mapper's fallback is needed.
  const { rows } = await runCoql(
    `SELECT Owner FROM ${MODULE} WHERE id is not null ORDER BY id DESC LIMIT 0, 3`,
  );
  const users = await zohoCrm.listActiveUsers().catch(() => []);
  const byId = new Map(users.filter((u) => u.zohoUserId).map((u) => [String(u.zohoUserId), u.name ?? '']));
  for (const r of rows) {
    const owner = r.Owner as { id?: string; name?: string } | null;
    const id = String(owner?.id ?? '');
    log(`- COQL name: "${owner?.name ?? ''}" → directory full name: "${byId.get(id) ?? '(not in directory)'}"`);
  }
}

async function main(): Promise<void> {
  log(`# Zoho CRM \`${MODULE}\` module — discovery`);
  log();
  log(`_generated by scripts/inspectMaintenanceModule.ts_`);
  log();
  await reportFields();
  await reportVolume();
  await reportSampleRecord();
  await reportOwnerNameShape();
  log();
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    console.error('\ninspectMaintenanceModule failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
