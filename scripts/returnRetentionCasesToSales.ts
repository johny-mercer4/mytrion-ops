/**
 * One-shot: move open Retention (phase_2) + Open Pool cases back to Sales Phase 1.
 *
 * Usage:
 *   corepack pnpm exec tsx scripts/returnRetentionCasesToSales.ts           # dry-run
 *   corepack pnpm exec tsx scripts/returnRetentionCasesToSales.ts --apply   # write
 *
 * Mapping:
 *   phase_2_retention → phase_1_agent / p1_dissatisfied (if outcome was dissatisfied) else p1_new
 *   p1_open_pool | p1_pool_claim_pending → phase_1_agent / p1_new
 * Assignee restored from pool_owner when assigned_agent is null.
 */
import 'dotenv/config';
import pg from 'pg';
import { dbSslOption } from '../src/db/client.js';

const APPLY = process.argv.includes('--apply');

async function main(): Promise<void> {
  const url = process.env.MYTRION_OPS_DATABASE_URL;
  if (!url) {
    console.error('MYTRION_OPS_DATABASE_URL is not set');
    process.exit(1);
  }
  const host = new URL(url).hostname;
  console.log(`DB ${host} · ${APPLY ? 'APPLY' : 'DRY-RUN'}`);

  const c = new pg.Client({
    connectionString: url,
    ssl: dbSslOption(url),
  });
  await c.connect();

  const before = await c.query(`
    SELECT phase_code, status_code, count(*)::int AS n
    FROM retention_cases
    WHERE closed_at IS NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log('\nOpen cases before:');
  console.table(before.rows);

  const targets = await c.query<{
    id: string;
    phase_code: string;
    status_code: string;
    agent_outcome: string | null;
    assigned_agent_zoho_user_id: string | null;
    pool_owner_zoho_user_id: string | null;
    agent_name: string | null;
  }>(`
    SELECT id::text, phase_code, status_code, agent_outcome,
           assigned_agent_zoho_user_id, pool_owner_zoho_user_id, agent_name
    FROM retention_cases
    WHERE closed_at IS NULL
      AND (
        phase_code = 'phase_2_retention'
        OR status_code IN ('p1_open_pool', 'p1_pool_claim_pending')
      )
    ORDER BY id
  `);

  console.log(`\nTargets: ${targets.rowCount ?? 0}`);
  if ((targets.rowCount ?? 0) === 0) {
    await c.end();
    return;
  }

  let toDissatisfied = 0;
  let toNew = 0;
  for (const row of targets.rows) {
    const fromRetention = row.phase_code === 'phase_2_retention';
    const nextStatus =
      fromRetention && row.agent_outcome === 'dissatisfied'
        ? 'p1_dissatisfied'
        : 'p1_new';
    if (nextStatus === 'p1_dissatisfied') toDissatisfied += 1;
    else toNew += 1;
  }
  console.log(`  → p1_dissatisfied: ${toDissatisfied}`);
  console.log(`  → p1_new: ${toNew}`);

  if (!APPLY) {
    console.log('\nDry-run only. Re-run with --apply to write.');
    await c.end();
    return;
  }

  await c.query('BEGIN');
  try {
    const updated = await c.query(`
      WITH targets AS (
        SELECT id, phase_code, status_code, agent_outcome,
               assigned_agent_zoho_user_id, pool_owner_zoho_user_id
        FROM retention_cases
        WHERE closed_at IS NULL
          AND (
            phase_code = 'phase_2_retention'
            OR status_code IN ('p1_open_pool', 'p1_pool_claim_pending')
          )
      ),
      patched AS (
        UPDATE retention_cases rc
        SET
          phase_code = 'phase_1_agent',
          status_code = CASE
            WHEN t.phase_code = 'phase_2_retention'
                 AND t.agent_outcome = 'dissatisfied'
              THEN 'p1_dissatisfied'
            ELSE 'p1_new'
          END,
          assigned_agent_zoho_user_id = COALESCE(
            t.assigned_agent_zoho_user_id,
            t.pool_owner_zoho_user_id,
            rc.assigned_agent_zoho_user_id
          ),
          pending_claimant_zoho_user_id = NULL,
          current_deadline_at = NULL,
          current_deadline_type = NULL,
          vacation_countdown_end = NULL,
          citi_folder_entered_at = NULL,
          citi_folder_hold_until = NULL,
          out_of_reach_attempts = CASE
            WHEN t.status_code IN ('p1_open_pool', 'p1_pool_claim_pending') THEN 0
            ELSE rc.out_of_reach_attempts
          END,
          phase_changed_at = NOW(),
          updated_at = NOW()
        FROM targets t
        WHERE rc.id = t.id
        RETURNING rc.id, t.status_code AS from_status, rc.status_code AS to_status
      )
      INSERT INTO retention_case_events (
        case_id, from_status, to_status, event_type, actor_zoho_user_id, notes, occurred_at
      )
      SELECT
        p.id,
        p.from_status,
        p.to_status,
        'status_change',
        NULL,
        'Ops reset — returned to Sales Phase 1 (escalations paused)',
        NOW()
      FROM patched p
      RETURNING case_id
    `);

    await c.query('COMMIT');
    console.log(`\nUpdated ${updated.rowCount ?? 0} cases + audit events.`);
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  }

  const after = await c.query(`
    SELECT phase_code, status_code, count(*)::int AS n
    FROM retention_cases
    WHERE closed_at IS NULL
    GROUP BY 1, 2
    ORDER BY 1, 2
  `);
  console.log('\nOpen cases after:');
  console.table(after.rows);

  await c.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
