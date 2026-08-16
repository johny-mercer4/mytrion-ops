/**
 * One-off: backfill weekly Mytrion Watch snapshots so the portfolio timeline has depth.
 *
 * PRODUCTION semantics — the debtor exclusion stays ON. This writes real history, not the backtest
 * study (which removed that filter and was deliberately never persisted).
 *
 * Re-running a date is an upsert, so this is safe to stop and restart.
 */
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { watchService } from '../src/modules/mytrionWatch/watchService.js';
import { databaseHost } from '../src/config/env.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const ctx = {
  tenantId: DEFAULT_TENANT_ID, userId: 'system:watch-backfill', audience: 'internal', role: 'admin',
  scopes: [], departments: ['verification'], allDepartmentAccess: true, requestId: 'backfill',
} as TenantContext;

/** Mondays from FROM to TO inclusive. */
function mondays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(from + 'T00:00:00Z');
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  const end = new Date(to + 'T00:00:00Z').getTime();
  while (d.getTime() <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 7); }
  return out;
}

const dates = mondays(process.env.FROM ?? '2025-09-15', process.env.TO ?? '2026-08-10');
const host = databaseHost();
console.log(`target ${host} — ${dates.length} weekly snapshots`);
// `LOCAL_OPS_DATABASE_URL` silently redirects writes to a local docker Postgres under
// NODE_ENV=development, and a run that reports "scored 716" against the wrong database looks exactly
// like a successful one — it cost a full repair cycle before anyone noticed. There is no local DB in
// this project, only prod.
if (host === 'localhost' || host === '127.0.0.1') {
  console.error('REFUSING: resolved to a local database. Re-run with LOCAL_OPS_DATABASE_URL= to force prod.');
  process.exit(1);
}
let ok = 0, failed = 0;
for (const [i, date] of dates.entries()) {
  try {
    const r = await watchService.runScoring(ctx, { scoringDate: date, trigger: 'manual' });
    ok += 1;
    console.log(`[${i + 1}/${dates.length}] ${date}  scored ${r.scored}  ${r.durationMs}ms`);
  } catch (e) {
    failed += 1;
    console.log(`[${i + 1}/${dates.length}] ${date}  FAILED ${e instanceof Error ? e.message.slice(0, 120) : ''}`);
  }
}
console.log(`\ndone: ${ok} written, ${failed} failed`);
process.exit(0);
