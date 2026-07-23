import 'dotenv/config';
import pg from 'pg';

function ageMin(a: unknown): string | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, number>;
  const ms =
    (o.hours || 0) * 3_600_000 +
    (o.minutes || 0) * 60_000 +
    (o.seconds || 0) * 1_000 +
    (o.milliseconds || 0);
  return `${Math.round(ms / 60_000)}m`;
}

async function main(): Promise<void> {
  const pool = new pg.Pool({
    connectionString: process.env.DWH_DATABASE_URL,
    ssl: false,
    max: 1,
    connectionTimeoutMillis: 8_000,
    options: '-c statement_timeout=8s',
    application_name: 'octane-probe',
  });

  const t0 = Date.now();
  try {
    const r = await pool.query('select count(*)::int as n from octane.dim_company');
    console.log('dim_company', { ok: true, ms: Date.now() - t0, n: r.rows[0].n });
  } catch (e) {
    console.log('dim_company', {
      ok: false,
      ms: Date.now() - t0,
      err: e instanceof Error ? e.message : String(e),
    });
  }

  const mashup = await pool.query(
    `select pid, wait_event, now()-query_start as age, left(query,80) as q
       from pg_stat_activity
      where application_name = 'Mashup Engine' and state = 'active'
      order by query_start`,
  );
  console.log('mashup_active', mashup.rows.length);
  for (const r of mashup.rows.slice(0, 6)) {
    console.log(' ', { pid: r.pid, wait: r.wait_event, age: ageMin(r.age), q: r.q });
  }

  const stuck = await pool.query(
    `select count(*)::int as n
       from pg_stat_activity
      where datname = current_database()
        and state = 'active'
        and query_start < now() - interval '10 minutes'`,
  );
  console.log('active_gt_10m', stuck.rows[0].n);

  const sales = await pool.query(
    `select count(*)::int as n
       from pg_stat_activity
      where datname = current_database()
        and state = 'active'
        and query ilike '%agent_carriers%'`,
  );
  console.log('sales_agent_carriers_stuck', sales.rows[0].n);

  const root = await pool.query(
    `select pid, application_name, state, wait_event,
            now()-query_start as age, left(query,100) as q
       from pg_stat_activity
      where pid = 3807`,
  );
  const r = root.rows[0];
  console.log(
    'root_blocker_3807',
    r
      ? { pid: r.pid, app: r.application_name, state: r.state, wait: r.wait_event, age: ageMin(r.age), q: r.q }
      : null,
  );

  const blocked = await pool.query(
    `select count(*)::int as n
       from pg_stat_activity
      where datname = current_database()
        and cardinality(pg_blocking_pids(pid)) > 0`,
  );
  console.log('blocked_sessions', blocked.rows[0].n);

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
