/**
 * One-shot: run retention case-sync with current .env (pilot flag respected) and print counts.
 * Usage: corepack pnpm exec tsx scripts/runRetentionSyncOnce.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, closeDb } from '../src/db/client.js';
import { env } from '../src/config/env.js';
import { runRetentionCaseSync } from '../src/modules/jobs/workers/retentionCaseSync.js';

async function main(): Promise<void> {
  console.log(
    JSON.stringify(
      {
        pilotOnly: env.FF_RETENTION_PILOT_ONLY,
        jobsEnabled: env.FF_JOBS_ENABLED,
        workerMode: env.JOBS_WORKER_MODE,
        dwhConfigured: Boolean(env.DWH_DATABASE_URL),
      },
      null,
      2,
    ),
  );

  const cols = await db.execute(sql`
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'retention_cases'
     order by ordinal_position
  `);
  const colNames = ((cols as { rows?: Array<{ column_name: string }> }).rows ?? []).map(
    (r) => r.column_name,
  );
  console.log('retention_cases columns:', colNames.join(', ') || '(none / wrong schema)');

  const before = await db.execute(sql`
    select count(*)::int as open_p1,
           count(distinct assigned_agent_zoho_user_id)::int as agents
      from retention_cases
     where closed_at is null and phase_code = 'phase_1_agent'
  `);
  console.log('before open p1', (before as { rows?: unknown[] }).rows?.[0] ?? before);

  const lookbackDays = Number(process.env.SYNC_LOOKBACK_DAYS ?? 90);
  const limit = Number(process.env.SYNC_LIMIT ?? 500);
  console.log('running syncRetentionCases...', { lookbackDays, limit });
  const summary = await runRetentionCaseSync({
    trigger: 'manual',
    lookbackDays,
    limit,
  });
  console.log('sync summary', summary);

  const after = await db.execute(sql`
    select phase_code, status_code, count(*)::int as n
      from retention_cases
     where closed_at is null
     group by 1, 2
     order by 1, 2
  `);
  console.log('after open by phase/status', (after as { rows?: unknown[] }).rows ?? after);

  const topAgents = await db.execute(sql`
    select assigned_agent_zoho_user_id as agent, count(*)::int as n
      from retention_cases
     where closed_at is null and phase_code = 'phase_1_agent'
     group by 1
     order by n desc
     limit 15
  `);
  console.log('top agents', (topAgents as { rows?: unknown[] }).rows ?? topAgents);

  const pool = await db.execute(sql`
    select status_code, count(*)::int as n
      from retention_cases
     where status_code in ('p1_open_pool','p1_pool_claim_pending')
     group by 1
  `);
  console.log('open pool', (pool as { rows?: unknown[] }).rows ?? pool);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
