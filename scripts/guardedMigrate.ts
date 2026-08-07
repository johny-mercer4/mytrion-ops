/**
 * `pnpm db:migrate` with a blast-radius guard.
 *
 * `.env` on a developer machine has historically pointed at the Render PRODUCTION database, so a
 * routine "let me apply my migration locally" was one command away from migrating production. This
 * wrapper refuses a non-local host unless the caller opts in explicitly with
 * `ALLOW_REMOTE_DB_MIGRATE=1`, then delegates to `drizzle-kit migrate` unchanged.
 *
 * Production is unaffected: Render applies migrations in-process at boot through
 * `runMigrationsOnBoot()` (DB_MIGRATE_ON_BOOT=1), which never runs this script.
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);
const OVERRIDE = 'ALLOW_REMOTE_DB_MIGRATE';

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function main(): number {
  const url = process.env['MYTRION_OPS_DATABASE_URL'];
  if (!url) {
    process.stderr.write('MYTRION_OPS_DATABASE_URL is not set — nothing to migrate.\n');
    return 1;
  }

  const host = hostOf(url);
  const isLocal = LOCAL_HOSTS.has(host);
  const allowed = process.env[OVERRIDE] === '1';

  if (!isLocal && !allowed) {
    process.stderr.write(
      `\nRefusing to migrate a non-local database.\n\n` +
        `  host: ${host || '<unparseable>'}\n\n` +
        `MYTRION_OPS_DATABASE_URL does not point at localhost. On this project that usually means\n` +
        `it points at the Render production database, and 'drizzle-kit migrate' would apply your\n` +
        `pending migrations there.\n\n` +
        `If you meant to migrate locally, point the URL at your local Postgres (docker compose up -d\n` +
        `postgres serves it on :5433) — see .env.example.\n\n` +
        `If you really do intend to migrate ${host}, re-run with:\n\n` +
        `  ${OVERRIDE}=1 pnpm db:migrate\n\n`,
    );
    return 1;
  }

  if (!isLocal) {
    process.stderr.write(`${OVERRIDE}=1 — migrating remote host ${host}\n`);
  }

  // No `shell: true` — pnpm puts node_modules/.bin on PATH for script children, and a shell here
  // would concatenate rather than escape the args (Node DEP0190).
  const result = spawnSync('drizzle-kit', ['migrate'], { stdio: 'inherit' });
  if (result.error) {
    process.stderr.write(`failed to run drizzle-kit: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

process.exitCode = main();
