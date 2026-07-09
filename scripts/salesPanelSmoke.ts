/**
 * Sales Mytrion panel smoke (LIVE, read-only) — exercises every panel touchpoint through
 * the real dispatcher (catalog → RBAC → identity injection → Zoho/servercrm), one by one,
 * as the given worker identity. Write touchpoints are validated to the schema boundary
 * only — nothing is created in CRM.
 *
 *   pnpm tsx scripts/salesPanelSmoke.ts <zohoUserId> <userName>
 */
import 'dotenv/config';
import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { dispatchTouchpoint } from '../src/modules/touchpoints/dispatcher.js';
import { getTouchpoint } from '../src/modules/touchpoints/catalog/index.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const zohoUserId = process.argv[2] ?? '';
const userName = process.argv[3] ?? 'Smoke Tester';
if (!zohoUserId) {
  console.error('usage: pnpm tsx scripts/salesPanelSmoke.ts <zohoUserId> [userName]');
  process.exit(1);
}

const ctx: TenantContext = {
  tenantId: DEFAULT_TENANT_ID,
  userId: `zoho:${zohoUserId}`,
  userName,
  audience: 'internal',
  role: 'admin',
  scopes: ['*'],
  departments: ['sales'],
  allDepartmentAccess: true,
  requestId: `smoke-${createId()}`,
};

function shape(v: unknown, depth = 0): string {
  if (Array.isArray(v)) return `array(${v.length})${v.length && depth < 1 ? ` of ${shape(v[0], depth + 1)}` : ''}`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as Record<string, unknown>);
    return `{${keys.slice(0, 10).join(',')}${keys.length > 10 ? ',…' : ''}}`;
  }
  return typeof v === 'string' ? `"${v.slice(0, 60)}"` : String(v);
}

let pass = 0;
let fail = 0;

async function run(label: string, key: string, params: Record<string, unknown>): Promise<unknown> {
  process.stdout.write(`\n▶ ${label} — ${key}\n`);
  try {
    const started = Date.now();
    const res = await dispatchTouchpoint(ctx, key, params);
    console.log(`  OK (${Date.now() - started}ms): ${shape(res.data)}`);
    pass++;
    return res.data;
  } catch (err) {
    console.error(`  FAIL: ${err instanceof Error ? err.message : err}`);
    fail++;
    return null;
  }
}

function validateOnly(label: string, key: string, params: Record<string, unknown>): void {
  process.stdout.write(`\n▶ ${label} — ${key} (schema validation only, NO write)\n`);
  const tp = getTouchpoint(key);
  if (!tp) {
    console.error('  FAIL: unknown touchpoint');
    fail++;
    return;
  }
  const parsed = tp.paramsSchema.safeParse(params);
  if (parsed.success) {
    console.log(`  OK: params accepted (riskClass=${tp.riskClass})`);
    pass++;
  } else {
    console.error(`  FAIL: ${parsed.error.issues[0]?.message}`);
    fail++;
  }
}

console.log(`Sales panel smoke as ${userName} (zoho:${zohoUserId})\n${'='.repeat(60)}`);

// -- Home --
await run('Home · snapshot', 'dashboard.home_snapshot', {});
await run('Home · announcements', 'inbox.announcements', {});
await run('Home · activity KPIs', 'activity.agent', { range: 'weekly' });

// -- Inbox --
const inbox = (await run('Inbox · messages', 'inbox.list', {})) as { messages?: unknown[] } | null;
console.log(`  inbox count: ${inbox?.messages?.length ?? 0}`);

// -- Data Center --
const clients = (await run('DataCenter · clients by agent', 'clients.by_agent', {})) as {
  data?: Array<{ carrier_id?: unknown }>;
} | null;
await run('DataCenter · datacenter leads', 'leads.datacenter', {});
const firstCarrier = clients?.data?.[0]?.carrier_id;
if (firstCarrier != null) {
  await run('DataCenter · client recent tx', 'clients.recent_transactions', {
    carrierId: String(firstCarrier),
    limit: 3,
  });
} else {
  console.log('\n▶ DataCenter · client recent tx — SKIPPED (agent has no clients)');
}

// -- Dashboard --
await run('Dashboard · agent sales', 'dashboard.agent_sales', {});
await run('Dashboard · company', 'dashboard.company', {});
await run('Dashboard · debtors', 'dashboard.debtors', {});
await run('Dashboard · leaderboard', 'activity.leaderboard', { range: 'weekly', metric: 'value_total', limit: 5 });

// -- Carriers --
await run('Carriers · prospect search', 'sales.carriers_search', { query: 'trucking', limit: 5 });

// -- Writes: validated to the boundary, never fired --
validateOnly('Create · lead', 'leads.create', {
  createPayload: { salutation: 'Mr.', firstName: 'Test', lastName: 'Smoke', companyName: 'Smoke Co', phone: '5555550100' },
});
validateOnly('Create · escalation', 'tickets.create_escalation', {
  escalationReason: 'Question',
  questionSubject: 'smoke',
  description: 'smoke',
  attachmentUrl: '',
});
validateOnly('Inbox · delete message', 'inbox.delete_message', { recordId: '123' });

console.log(`\n${'='.repeat(60)}\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
