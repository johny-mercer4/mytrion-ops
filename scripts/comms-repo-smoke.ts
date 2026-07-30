/**
 * Comms repo smoke check — exercises the parts that only a real Postgres can prove.
 *
 * The RBAC-leakage suite (tests/unit/comms-rbac-leakage.test.ts) asserts the SQL offline, which is
 * the right tool for scoping. It cannot prove concurrency: whether 25 simultaneous appends to one
 * thread produce contiguous unique `seq` values depends on an actual row lock, and a mock will
 * happily agree either way. Same for the monotonic read watermark and the "a hand-off never evicts
 * anyone" rule, which are both UPDATE-predicate behaviour.
 *
 * Usage (creates and drops its own database):
 *   docker compose up -d postgres
 *   docker exec octane-postgres psql -U octane -d postgres -c 'CREATE DATABASE comms_smoke'
 *   MYTRION_OPS_DATABASE_URL='postgresql://octane:octane@localhost:5433/comms_smoke' \
 *     pnpm exec drizzle-kit migrate
 *   MYTRION_OPS_DATABASE_URL='postgresql://octane:octane@localhost:5433/comms_smoke' \
 *     pnpm exec tsx scripts/comms-repo-smoke.ts
 *
 * It REFUSES to run against anything but a local database: the repo's committed .env points
 * MYTRION_OPS_DATABASE_URL at Render production, so an unguarded script here would write test
 * threads into prod.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { closeDb, db } from '../src/db/client.js';
import { mytrionThreadMessages, mytrionThreads, tenants } from '../src/db/schema/index.js';
import { commsMessageRepo } from '../src/repos/commsMessageRepo.js';
import { commsThreadMemberRepo } from '../src/repos/commsThreadMemberRepo.js';
import { commsThreadRepo } from '../src/repos/commsThreadRepo.js';
import type { TenantContext } from '../src/types/tenantContext.js';

const url = process.env.MYTRION_OPS_DATABASE_URL ?? process.env.DATABASE_URL ?? '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error(
    'REFUSING TO RUN: MYTRION_OPS_DATABASE_URL is not a local database.\n' +
      'This script writes threads and messages. Point it at a throwaway local DB — see the header.',
  );
  process.exit(1);
}

const TENANT = 'octane';
let failures = 0;

function ok(label: string, cond: boolean, extra = ''): void {
  if (!cond) failures += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? `  — ${extra}` : ''}`);
}

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: TENANT,
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'smoke',
    ...over,
  } as TenantContext;
}

async function main(): Promise<void> {
  await db
    .insert(tenants)
    .values({ id: TENANT, name: 'Octane', audience: 'internal' })
    .onConflictDoNothing();

  const sales = ctxOf();
  const cs = ctxOf({ userId: 'zoho:77', departments: ['customer-service'] });
  const otherSalesAgent = ctxOf({ userId: 'zoho:999', departments: ['sales'] });

  // A Sales agent raises a ticket for their client, targeted at Customer Service.
  const [thread] = await db
    .insert(mytrionThreads)
    .values({
      tenantId: TENANT,
      kind: 'ticket',
      visibility: 'department',
      department: 'customer-service',
      subject: 'Card declines at Pilot',
      createdByZohoUserId: '42',
    })
    .returning();
  const threadId = thread!.id;
  await commsThreadMemberRepo.add(sales, {
    threadId,
    memberKind: 'worker',
    memberKey: '42',
    memberName: 'Ali (Sales)',
    role: 'requester',
  });

  // --- seq allocation under concurrency ---
  await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      commsMessageRepo.append(sales, {
        threadId,
        body: `msg ${i}`,
        authorKind: 'worker',
        authorZohoUserId: '42',
      }),
    ),
  );
  const msgs = await db
    .select()
    .from(mytrionThreadMessages)
    .where(eq(mytrionThreadMessages.threadId, threadId));
  const seqs = msgs.map((m) => m.seq).sort((a, b) => a - b);
  ok(
    '25 concurrent appends → contiguous unique seqs 1..25',
    seqs.length === 25 && new Set(seqs).size === 25 && seqs[0] === 1 && seqs[24] === 25,
    `rows=${seqs.length} distinct=${new Set(seqs).size} min=${seqs[0]} max=${seqs[24]}`,
  );

  const [after] = await db.select().from(mytrionThreads).where(eq(mytrionThreads.id, threadId));
  ok(
    'thread counters agree with the message rows',
    after!.messageCount === 25 && after!.lastMessageSeq === 25,
    `count=${after!.messageCount} lastSeq=${after!.lastMessageSeq}`,
  );

  // --- read state ---
  const member = { memberKind: 'worker' as const, memberKey: '42' };
  const unread = await commsThreadMemberRepo.unreadTotals(sales, member);
  ok('requester sees 25 unread', unread[0]?.unread === 25, `unread=${unread[0]?.unread}`);
  await commsThreadMemberRepo.markRead(sales, threadId, member, 25);
  ok(
    'markRead(25) clears it',
    (await commsThreadMemberRepo.unreadTotals(sales, member)).length === 0,
  );
  await commsThreadMemberRepo.markRead(sales, threadId, member, 10);
  ok(
    'a LOWER seq is ignored — read messages cannot resurrect',
    (await commsThreadMemberRepo.unreadTotals(sales, member)).length === 0,
  );

  // --- scoping: department arm vs peers ---
  ok('CS agent reads it via the department arm', await commsThreadRepo.canReadThread(cs, threadId));
  ok(
    'another Sales agent CANNOT see it (only the raiser does)',
    !(await commsThreadRepo.canReadThread(otherSalesAgent, threadId)),
  );

  // --- lazy watcher must not demote an existing role ---
  await commsThreadMemberRepo.ensureWatcher(cs, threadId, {
    memberKind: 'worker',
    memberKey: '77',
    memberName: 'Dilnoza (CS)',
  });
  await commsThreadMemberRepo.ensureWatcher(sales, threadId, {
    memberKind: 'worker',
    memberKey: '42',
  });
  let members = await commsThreadMemberRepo.listByThread(sales, threadId);
  ok(
    'watcher joins lazily; the requester keeps its role',
    members.length === 2 && members.find((m) => m.memberKey === '42')?.role === 'requester',
    members.map((m) => `${m.memberKey}:${m.role}`).join(' '),
  );

  // --- the growing-group rule ---
  await commsThreadMemberRepo.transferAssignee(sales, threadId, {
    memberKind: 'worker',
    memberKey: '77',
    memberName: 'Dilnoza',
  });
  await commsThreadMemberRepo.transferAssignee(sales, threadId, {
    memberKind: 'worker',
    memberKey: '88',
    memberName: 'Bekzod',
  });
  members = await commsThreadMemberRepo.listByThread(sales, threadId);
  const roles = Object.fromEntries(members.map((m) => [m.memberKey, m.role]));
  ok('assignee moves to the newest holder', roles['88'] === 'assignee');
  ok('the PREVIOUS assignee stays an active participant', roles['77'] === 'participant');
  ok(
    'everyone involved is still in the conversation',
    members.length === 3,
    members.map((m) => `${m.memberKey}:${m.role}`).join(' '),
  );

  // --- internal notes are filtered in SQL, not in a DTO builder ---
  await commsMessageRepo.append(cs, {
    threadId,
    body: 'internal: check WEX first',
    authorKind: 'worker',
    authorZohoUserId: '77',
    isInternal: true,
  });
  const all = await commsMessageRepo.listByThread(sales, threadId, { limit: 200 });
  const visible = await commsMessageRepo.listByThread(sales, threadId, {
    limit: 200,
    excludeInternal: true,
  });
  ok(
    'excludeInternal drops the note at the query level',
    all.length === 26 && visible.length === 25,
    `all=${all.length} visible=${visible.length}`,
  );

  // --- reconnect gap-fill ---
  const tail = await commsMessageRepo.listByThread(sales, threadId, { afterSeq: 24 });
  ok(
    'afterSeq returns only newer messages (socket gap-fill)',
    tail.length === 2 && tail.every((m) => m.seq > 24),
    `seqs ${tail.map((m) => m.seq).join(',')}`,
  );

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
}

main()
  .then(async () => {
    await closeDb();
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    await closeDb();
    process.exit(1);
  });
