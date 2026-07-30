import 'dotenv/config';
/**
 * ONE-TIME migration of the Zoho CRM `Maintenance` module into `maintenance_cases`.
 *
 *   pnpm tsx scripts/migrateMaintenanceFromZoho.ts --dry-run
 *   pnpm tsx scripts/migrateMaintenanceFromZoho.ts
 *   pnpm tsx scripts/migrateMaintenanceFromZoho.ts --from=2026-01-01 --to=2026-07-30
 *
 * After this runs, Postgres is the source of truth: the CS Maintenance tab creates and edits cases
 * directly, and nothing reads Maintenance out of Zoho again. There is no scheduled sync by design.
 *
 * Safely RE-RUNNABLE. The upsert is keyed on the Zoho record id and deliberately does not touch the
 * created_by/updated_by columns, so re-importing refreshes the Zoho-sourced facts without clobbering
 * an edit an agent made in Mytrion. That makes this the manual escape hatch if records ever need
 * pulling in again (e.g. cases the carrier-facing self-service widget wrote straight into Zoho).
 *
 * READS Zoho, WRITES only maintenance_cases. Check which database MYTRION_OPS_DATABASE_URL points at
 * before running — the script prints the host it is about to write to and refuses --dry-run writes.
 */
import { closeDb } from '../src/db/client.js';
import { databaseUrl } from '../src/config/env.js';
import { zohoCrm } from '../src/integrations/zohoCrm.js';
import {
  countMaintenanceRecords,
  createdWindow,
  drainMaintenance,
  MATCH_ALL,
} from '../src/integrations/csMaintenanceRecords.js';
import { mapMaintenanceRow } from '../src/modules/customerService/maintenanceFields.js';
import { maintenanceCaseRepo } from '../src/repos/maintenanceCaseRepo.js';
import type { NewMaintenanceCase } from '../src/db/schema/maintenance_cases.js';

/* eslint-disable no-console */

interface Args {
  dryRun: boolean;
  limit: number | undefined;
  from: string | undefined;
  to: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
  const limitRaw = get('limit');
  const limit = limitRaw ? Number(limitRaw) : undefined;
  return {
    dryRun: argv.includes('--dry-run'),
    limit: limit !== undefined && Number.isFinite(limit) && limit > 0 ? limit : undefined,
    from: get('from'),
    to: get('to'),
  };
}

/** Host only — never print credentials. */
function dbHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(unparseable)';
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const where = args.from && args.to ? createdWindow(args.from, args.to) : MATCH_ALL;

  console.log('\n  Maintenance → Postgres migration');
  console.log('  ' + '─'.repeat(58));
  console.log(`  target DB      ${dbHost(databaseUrl)}`);
  console.log(`  mode           ${args.dryRun ? 'DRY RUN (no writes)' : 'WRITE'}`);
  console.log(`  window         ${where === MATCH_ALL ? 'all records' : `${args.from} → ${args.to}`}`);
  if (args.limit) console.log(`  limit          ${args.limit}`);

  const [zohoCount, existing] = await Promise.all([
    countMaintenanceRecords(where),
    maintenanceCaseRepo.countAll(),
  ]);
  console.log(`  in Zoho        ${zohoCount.toLocaleString()}`);
  console.log(`  already in PG  ${existing.toLocaleString()}`);
  console.log('  ' + '─'.repeat(58));

  // One directory call for the whole run. COQL returns Owner.name as the LAST NAME ONLY, so every
  // row's owner is resolved through this map (per-record lookups would be ~2.7k extra API calls).
  const users = await zohoCrm.listActiveUsers().catch((err: unknown) => {
    console.warn(`  ⚠️  user directory unavailable (${err instanceof Error ? err.message : err});`);
    console.warn('      owner names will fall back to Zoho\'s last-name-only value.');
    return [];
  });
  const ownerNames = new Map<string, string>();
  for (const u of users) {
    const name = (u.name ?? '').trim();
    if (u.zohoUserId && name) ownerNames.set(String(u.zohoUserId), name);
  }
  console.log(`  resolved ${ownerNames.size} owner name(s) from the directory`);

  const drain = await drainMaintenance({
    where,
    ...(args.limit !== undefined ? { maxRows: args.limit } : {}),
  });
  console.log(`  drained ${drain.rows.length.toLocaleString()} row(s) in ${drain.pages} page(s)` +
    `${drain.truncated ? ' — TRUNCATED (hit a limit/budget)' : ''}`);

  /*
   * DEACTIVATED owners need a second pass.
   *
   * `listActiveUsers()` returns only active users, and for a deactivated owner COQL hands back
   * `{"id":"…","name":null}` — so the mapper's last-name fallback has nothing to fall back TO and the
   * name lands null. The UI then shows the raw 19-digit id as the owner. On the live org that was 4
   * users covering 766 cases (28%) — deliberately not named here.
   *
   * `getUserById` resolves them individually, so collect the ids the roster missed and fetch just
   * those — a handful of calls, not one per record.
   */
  const unresolved = new Set<string>();
  for (const row of drain.rows) {
    const id = String((row.Owner as { id?: unknown } | null)?.id ?? '');
    if (id && !ownerNames.has(id)) unresolved.add(id);
  }
  if (unresolved.size > 0) {
    console.log(`  ${unresolved.size} owner(s) missing from the active roster — resolving individually`);
    for (const id of unresolved) {
      const u = await zohoCrm.getUserById(id).catch(() => null);
      const name = (u?.name ?? '').trim();
      if (name) {
        ownerNames.set(id, name);
        console.log(`    ${id} → ${name}`);
      } else {
        console.warn(`    ${id} → could not resolve; the id will render as the owner`);
      }
    }
  }

  // Map EVERYTHING first, collecting per-record failures, then issue one batched write. A single
  // malformed record must be reported, not abort the whole import halfway through.
  const mapped: NewMaintenanceCase[] = [];
  const errors: Array<{ zohoRecordId: string; message: string }> = [];
  for (const row of drain.rows) {
    try {
      mapped.push(mapMaintenanceRow(row, ownerNames));
    } catch (err) {
      errors.push({
        zohoRecordId: String(row.id ?? '(no id)'),
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  console.log(`  mapped ${mapped.length.toLocaleString()} row(s), ${errors.length} error(s)`);

  if (args.dryRun) {
    console.log('\n  DRY RUN — nothing written. Sample of the first 2 mapped rows:\n');
    console.log(JSON.stringify(mapped.slice(0, 2), null, 2));
  } else {
    const { written, chunks } = await maintenanceCaseRepo.upsertMany(mapped, { chunkSize: 200 });
    const after = await maintenanceCaseRepo.countAll();
    console.log(`  upserted ${written.toLocaleString()} row(s) in ${chunks} chunk(s)`);
    console.log(`  maintenance_cases now holds ${after.toLocaleString()} row(s)`);
  }

  if (errors.length > 0) {
    console.log('\n  Per-record errors:');
    for (const e of errors.slice(0, 20)) console.log(`   - ${e.zohoRecordId}: ${e.message}`);
    if (errors.length > 20) console.log(`   … and ${errors.length - 20} more`);
  }
  console.log('');
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err: unknown) => {
    console.error('\nmigrateMaintenanceFromZoho failed:', err instanceof Error ? err.message : err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
