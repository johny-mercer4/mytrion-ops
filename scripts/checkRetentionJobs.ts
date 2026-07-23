/**
 * Inspect pg-boss retention job schedules + recent runs (no secrets printed).
 * Usage: corepack pnpm exec tsx scripts/checkRetentionJobs.ts
 */
import 'dotenv/config';
import { sql } from 'drizzle-orm';
import { db, closeDb } from '../src/db/client.js';
import { env } from '../src/config/env.js';

async function main(): Promise<void> {
  const schema = env.PGBOSS_SCHEMA || 'pgboss';
  console.log(
    JSON.stringify(
      {
        pilotOnly: env.FF_RETENTION_PILOT_ONLY,
        jobsEnabled: env.FF_JOBS_ENABLED,
        workerMode: env.JOBS_WORKER_MODE,
        pgbossSchema: schema,
      },
      null,
      2,
    ),
  );

  const schedules = await db.execute(sql.raw(`
    select name, cron, timezone
      from ${schema}.schedule
     where name like 'automation.retention%'
     order by name
  `));
  console.log('schedules', (schedules as { rows?: unknown[] }).rows ?? schedules);

  const recent = await db.execute(sql.raw(`
    select name, state, created_on, started_on, completed_on,
           left(coalesce(output::text, ''), 240) as output_preview
      from ${schema}.job
     where name like 'automation.retention%'
     order by created_on desc
     limit 12
  `));
  console.log('recent jobs', (recent as { rows?: unknown[] }).rows ?? recent);

  const openP1 = await db.execute(sql`
    select count(*)::int as open_p1,
           count(distinct assigned_agent_zoho_user_id)::int as agents
      from retention_cases
     where closed_at is null and phase_code = 'phase_1_agent'
  `);
  console.log('open p1', (openP1 as { rows?: unknown[] }).rows?.[0] ?? openP1);

  const daniel = await db.execute(sql`
    select count(*)::int as n
      from retention_cases
     where closed_at is null
       and assigned_agent_zoho_user_id = '6227679000031473048'
  `);
  console.log('daniel brown open', (daniel as { rows?: unknown[] }).rows?.[0] ?? daniel);
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error(err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
