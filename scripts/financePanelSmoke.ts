/**
 * Finance Mytrion touchpoint smoke (LIVE, read-only) — every finance touchpoint through
 * the real dispatcher against prod Zoho Deluge + servercrm, one by one, as a
 * finance-department worker. finance.balance_run (the only write) is validated to the
 * schema boundary only.
 *
 *   pnpm tsx scripts/financePanelSmoke.ts <zohoUserId> [userName]
 */
import 'dotenv/config';
import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { activeZohoFunctionsEnv, zohoFunctionsBaseUrl } from '../src/integrations/zohoFunctions.js';
import { dispatchTouchpoint } from '../src/modules/touchpoints/dispatcher.js';
import { getTouchpoint } from '../src/modules/touchpoints/catalog/index.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const zohoUserId = process.argv[2] ?? '6227679000093960901';
const userName = process.argv[3] ?? 'John Mercer';

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: `zoho:${zohoUserId}`,
  userName,
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: ['finance'],
  allDepartmentAccess: true,
  requestId: `smoke-${createId()}`,
};

function shape(v: unknown): string {
  if (Array.isArray(v)) return `array(${v.length})`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object);
    return `{${keys.slice(0, 9).join(',')}${keys.length > 9 ? ',…' : ''}}`;
  }
  return String(v).slice(0, 80);
}

let pass = 0;
let fail = 0;

async function run(key: string, params: Record<string, unknown> = {}): Promise<unknown> {
  process.stdout.write(`\n▶ ${key}\n`);
  try {
    const t0 = Date.now();
    const res = await dispatchTouchpoint(ctx, key, params);
    console.log(`  OK (${Date.now() - t0}ms): ${shape(res.data)}`);
    pass++;
    return res.data;
  } catch (err) {
    console.error(`  FAIL: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    fail++;
    return null;
  }
}

console.log(`Finance smoke — Deluge env: ${activeZohoFunctionsEnv()} → ${zohoFunctionsBaseUrl()}`);
console.log('='.repeat(64));

// Deluge (prod)
await run('finance.parent_snapshot');
await run('finance.smart_events', { limit: 3, offset: 0 });

// servercrm lists + counts
await run('finance.main_transactions', { limit: 2 });
await run('finance.main_transactions_count');
await run('finance.smart_audits', { limit: 2 });
await run('finance.smart_audits_count');
const clients = (await run('finance.clients', { limit: 2 })) as { data?: Array<{ carrier_id?: unknown }> } | null;
await run('finance.clients_count');
await run('finance.payments', { limit: 2 });
await run('finance.payments_count');
await run('finance.debtors', { limit: 2 });
await run('finance.debtors_count');

// analytics
await run('finance.analytics_fueling');
await run('finance.analytics_segments_aggregate');
await run('finance.analytics_segments_clients', { limit: 2 });
await run('finance.analytics_clients_fueling_on', { dayOfWeek: 1, limit: 2 });

// per-carrier drilldowns (use the first live client)
const cid = clients?.data?.[0]?.carrier_id;
if (cid != null) {
  await run('finance.analytics_fueling_carrier', { carrierId: String(cid) });
  await run('finance.client_invoices', { carrierId: String(cid), limit: 2 });
  await run('finance.client_payments', { carrierId: String(cid), limit: 2 });
  await run('finance.client_recent_transactions', { carrierId: String(cid), limit: 2 });
} else {
  console.log('\n▶ drilldowns — SKIPPED (no client rows)');
}

// The only write: schema boundary only, nothing fired.
process.stdout.write('\n▶ finance.balance_run (schema validation only, NO write)\n');
const tp = getTouchpoint('finance.balance_run');
if (tp && tp.paramsSchema.safeParse({}).success && tp.riskClass === 'write') {
  console.log('  OK: params accepted (riskClass=write)');
  pass++;
} else {
  console.error('  FAIL: schema/riskClass mismatch');
  fail++;
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
