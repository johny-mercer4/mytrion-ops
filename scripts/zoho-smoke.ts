import 'dotenv/config';
/**
 * Live connectivity smoke test for the Zoho tool integrations + RAG. Read-only.
 *
 *   pnpm zoho:smoke
 *
 * For each capability it prints OK / FAIL / SKIP and a tiny sample. SKIP means the relevant
 * secrets aren't set in .env (so it's safe to run in any environment — it never hard-fails on a
 * missing token). RAG does a full round-trip: ingest a throwaway doc → retrieve it → delete it.
 * Nothing is written to Zoho; the only DB writes are the RAG doc, which is removed at the end.
 */
import { env } from '../src/config/env.js';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { closeDb } from '../src/db/client.js';
import { scopesForRole } from '../src/modules/auth/permissions.js';
import type { TenantContext } from '../src/types/tenantContext.js';
import { getOrg, runCoql } from '../src/integrations/zohoCrm.js';
import { listDepartments, listTickets } from '../src/integrations/zohoDesk.js';
import { searchEmployees } from '../src/integrations/zohoPeople.js';
import { ingestDocument } from '../src/modules/knowledge/ingestService.js';
import { retrieve } from '../src/modules/knowledge/retriever.js';
import { knowledgeRepo } from '../src/repos/knowledgeRepo.js';

type Status = 'OK' | 'FAIL' | 'SKIP';
interface Line {
  name: string;
  status: Status;
  detail: string;
}
const results: Line[] = [];

function record(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
}

function smokeContext(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'smoke',
    audience: 'internal',
    role: 'admin',
    scopes: scopesForRole('admin'),
    departments: [],
    allDepartmentAccess: true,
    requestId: 'zoho-smoke',
  };
}

/** Run a check unless a required secret is missing (then SKIP). Never throws. */
async function check(name: string, requiredEnv: string[], fn: () => Promise<string>): Promise<void> {
  const missing = requiredEnv.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    record(name, 'SKIP', `missing env: ${missing.join(', ')}`);
    return;
  }
  try {
    record(name, 'OK', await fn());
  } catch (err) {
    record(name, 'FAIL', err instanceof Error ? err.message : String(err));
  }
}

const CRM_SECRETS = ['ZOHO_CRM_REFRESH_TOKEN'];
const DESK_SECRETS = ['ZOHO_DESK_REFRESH_TOKEN', 'ZOHO_DESK_ORG_ID'];
const PEOPLE_SECRETS = ['ZOHO_PEOPLE_REFRESH_TOKEN'];
const RAG_SECRETS = ['MYTRION_OPS_DATABASE_URL', 'OPENAI_API_KEY'];

/** CRM module to probe with COQL; override with SMOKE_CRM_MODULE if our org renamed/uses another. */
const CRM_MODULE = process.env.SMOKE_CRM_MODULE || 'Leads';

async function runCrm(): Promise<void> {
  await check('Zoho CRM — GET /org', CRM_SECRETS, async () => {
    const org = await getOrg();
    return `company=${org.company_name ?? org.companyName ?? '?'} id=${org.id ?? '?'}`;
  });
  await check('Zoho CRM — COQL query', CRM_SECRETS, async () => {
    // COQL requires a WHERE clause; `id is not null` is the universal "match anything" predicate.
    const out = await runCoql(`select id from ${CRM_MODULE} where id is not null limit 0, 1`);
    return `${CRM_MODULE}: ${out.count} row(s), moreRecords=${out.moreRecords}`;
  });
}

async function runDesk(): Promise<void> {
  await check('Zoho Desk — list departments', DESK_SECRETS, async () => {
    const depts = await listDepartments(5);
    return `${depts.length} department(s)${depts[0]?.name ? ` (e.g. ${depts[0].name})` : ''}`;
  });
  await check('Zoho Desk — list tickets', DESK_SECRETS, async () => {
    const tickets = await listTickets({ limit: 3 });
    return `${tickets.length} recent ticket(s)${tickets[0]?.subject ? ` (e.g. "${tickets[0].subject}")` : ''}`;
  });
}

async function runPeople(): Promise<void> {
  await check('Zoho People — search employees', PEOPLE_SECRETS, async () => {
    const employees = await searchEmployees({ limit: 3 });
    return `${employees.length} employee(s)`;
  });
}

async function runRag(): Promise<void> {
  const missing = RAG_SECRETS.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    record('RAG — ingest → retrieve → delete', 'SKIP', `missing env: ${missing.join(', ')}`);
    return;
  }
  const ctx = smokeContext();
  let docId: string | null = null;
  try {
    const marker = 'OctaneSmokeTestCanary';
    const ingest = await ingestDocument(ctx, {
      title: 'zoho-smoke-canary',
      content: `${marker}: the carrier debtors balance lives in the CRM Accounts module for this org.`,
      source: 'zoho-smoke',
      mimeType: 'text/markdown',
    });
    docId = ingest.docId;
    const hits = await retrieve(ctx, 'where do carrier debtors balances live?', 3);
    const found = hits.some((h) => h.content.includes(marker));
    record(
      'RAG — ingest → retrieve → delete',
      found ? 'OK' : 'FAIL',
      found ? `embedded + retrieved (top score ${hits[0]?.score?.toFixed(3) ?? '?'})` : 'canary not retrieved',
    );
  } catch (err) {
    record('RAG — ingest → retrieve → delete', 'FAIL', err instanceof Error ? err.message : String(err));
  } finally {
    if (docId) await knowledgeRepo.deleteDoc(ctx, docId).catch(() => undefined);
  }
}

function print(): void {
  const icon: Record<Status, string> = { OK: '✅', FAIL: '❌', SKIP: '⚪️' };
  // eslint-disable-next-line no-console
  console.log('\n  Zoho tooling + RAG smoke test\n  ' + '─'.repeat(48));
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`  ${icon[r.status]}  ${r.name.padEnd(34)} ${r.detail}`);
  }
  // eslint-disable-next-line no-console
  console.log('  ' + '─'.repeat(48));
}

async function main(): Promise<void> {
  // Touch env so a malformed .env fails loudly before any network call.
  void env.NODE_ENV;
  await runCrm();
  await runDesk();
  await runPeople();
  await runRag();
  print();
}

main()
  .then(() => closeDb())
  .then(() => {
    const failed = results.some((r) => r.status === 'FAIL');
    process.exit(failed ? 1 : 0);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('zoho-smoke crashed:', err);
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
