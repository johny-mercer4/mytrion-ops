/**
 * The native ticket path half of the comms smoke check (scripts/comms-repo-smoke.ts).
 *
 * Everything here needs a REAL Postgres to mean anything: single-transaction writes are asserted on
 * `xmin`, ticket numbers on a live sequence under concurrency, replay safety on a PARTIAL unique index,
 * and the reader filter / keyset cursor on a real planner. Each check says which Postgres behaviour it
 * depends on.
 *
 * Split from the entry script for the 600-line file cap; shared fixtures live in commsSmokeFixtures.ts.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../../src/db/client.js';
import {
  mytrionThreadMembers,
  mytrionThreads,
  mytrionTickets,
} from '../../src/db/schema/index.js';
import { commsThreadMemberRepo } from '../../src/repos/commsThreadMemberRepo.js';
import { commsTicketEventRepo } from '../../src/repos/commsTicketEventRepo.js';
import {
  commsTicketRepo,
  encodeTicketCursor,
  type CreatedTicket,
  type TicketWithThread,
} from '../../src/repos/commsTicketRepo.js';
import { readerOf, toTicketDto } from '../../src/modules/comms/dto.js';
import { markThreadRead, postReply } from '../../src/modules/comms/messageService.js';
import {
  CARD_FULL,
  OTHER_TENANT,
  RUN,
  TENANT,
  cs,
  ctxOf,
  dealOf,
  fileTicket,
  otherSalesAgent,
  sales,
  type Ok,
} from './commsSmokeFixtures.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

/**
 * The entry script owns the reporter (and therefore the failure count), so it is installed here once by
 * `runNativeTicketChecks` rather than threaded through every check's signature — which would add a
 * parameter to fifty call sites and obscure what each assertion actually says.
 */
let ok: Ok = () => {
  throw new Error('reporter not installed — call runNativeTicketChecks()');
};

/**
 * One create = one transaction, proved on `xmin`.
 *
 * POSTGRES-SPECIFIC: `xmin` is the MVCC system column holding the id of the transaction that produced
 * a row version. Four rows in three tables sharing one xmin is direct evidence that a single
 * transaction wrote them — something no mock or call-count assertion can establish. The journal row is
 * expected to carry a DIFFERENT xmin: `commsTicketEventRepo.append` accepts a tx handle but the native
 * create path appends after commit, and this asserts that as the actual shape rather than assuming it.
 */
async function checkCreateUnit(): Promise<CreatedTicket> {
  const body = 'Client wants the account reactivated after paying the outstanding invoice.';
  const created = await fileTicket(sales, {
    typeCode: 'C-7',
    subject: 'Reactivate Pilot Logistics',
    body,
    cardNumber: CARD_FULL,
  });
  const { ticket, thread, message, members } = created;

  ok(
    'target_department comes from the catalog row, not from any caller input',
    ticket.targetDepartment === 'customer-service' && thread.department === 'customer-service',
    `ticket=${ticket.targetDepartment} thread=${thread.department}`,
  );
  ok(
    'ticket number is allocated from the sequence and formatted per kind',
    /^T-\d{6}$/.test(ticket.number),
    ticket.number,
  );

  const xmins = await db.execute<{ src: string; x: string }>(sql`
    SELECT 'thread' AS src, xmin::text AS x FROM mytrion_threads WHERE id = ${thread.id}
    UNION ALL SELECT 'ticket', xmin::text FROM mytrion_tickets WHERE id = ${ticket.id}
    UNION ALL SELECT 'message', xmin::text FROM mytrion_thread_messages WHERE id = ${message.id}
    UNION ALL SELECT 'member', xmin::text FROM mytrion_thread_members WHERE thread_id = ${thread.id}
    UNION ALL SELECT 'event', xmin::text FROM mytrion_ticket_events WHERE ticket_id = ${ticket.id}
  `);
  const rows = [...xmins];
  const unit = rows.filter((r) => r.src !== 'event').map((r) => r.x);
  const journal = rows.filter((r) => r.src === 'event').map((r) => r.x);
  ok(
    'thread + ticket + message + requester member share ONE transaction (equal xmin)',
    unit.length === 4 && new Set(unit).size === 1,
    `rows=${unit.length} distinct xmin=${new Set(unit).size}`,
  );
  ok(
    "the 'created' journal row exists (appended after commit → its own xmin)",
    journal.length === 1 && journal[0] !== unit[0],
    `journal xmin=${journal[0]} unit xmin=${unit[0]}`,
  );

  const [threadRow] = await db.select().from(mytrionThreads).where(eq(mytrionThreads.id, thread.id));
  ok(
    'thread counters are already correct with NO second write',
    threadRow!.messageCount === 1 &&
      threadRow!.lastMessageSeq === 1 &&
      threadRow!.lastMessageId === message.id &&
      threadRow!.lastMessagePreview === body.slice(0, 160) &&
      threadRow!.updatedAt.getTime() === threadRow!.createdAt.getTime(),
    `count=${threadRow!.messageCount} seq=${threadRow!.lastMessageSeq} ` +
      `updated==created:${threadRow!.updatedAt.getTime() === threadRow!.createdAt.getTime()}`,
  );
  ok(
    'the opening message is seq 1, kind message, visible',
    message.seq === 1 && message.kind === 'message' && message.isInternal === false,
    `seq=${message.seq} kind=${message.kind}`,
  );
  ok(
    "requester member row is role='requester' with last_read_seq=1",
    members.length === 1 &&
      members[0]!.role === 'requester' &&
      members[0]!.lastReadSeq === 1 &&
      members[0]!.memberKey === '42',
    members.map((m) => `${m.memberKey}:${m.role}:${m.lastReadSeq}`).join(' '),
  );
  const events = await commsTicketEventRepo.listByTicket(sales, ticket.id);
  ok(
    "the journal opens with exactly one 'created' row",
    events.length === 1 && events[0]!.eventType === 'created' && events[0]!.toStatus === 'open',
    events.map((e) => e.eventType).join(','),
  );
  return created;
}

/**
 * 25 simultaneous creates.
 *
 * POSTGRES-SPECIFIC: `nextval` on `mytrion_comms_number_seq` is non-transactional, so concurrent
 * creates cannot collide on a number and none of them serialises behind another. A per-tenant counter
 * row would pass a mock and deadlock here.
 */
async function checkConcurrentCreates(): Promise<void> {
  const results = await Promise.all(
    Array.from({ length: 25 }, (_, i) =>
      fileTicket(sales, {
        typeCode: 'C-7',
        subject: `Concurrent ${i}`,
        body: `concurrent create ${i}`,
        deal: dealOf({ carrierId: `CONC-${RUN}` }),
      }),
    ),
  );
  const numbers = results.map((r) => r.ticket.number);
  ok(
    '25 concurrent creates → 25 DISTINCT numbers, all T-NNNNNN',
    numbers.length === 25 &&
      new Set(numbers).size === 25 &&
      numbers.every((n) => /^T-\d{6}$/.test(n)),
    `distinct=${new Set(numbers).size} sample=${numbers.slice(0, 3).join(',')}`,
  );

  const threadIds = results.map((r) => r.thread.id);
  const threadRows = await db
    .select({ id: mytrionThreads.id, count: mytrionThreads.messageCount })
    .from(mytrionThreads)
    .where(and(eq(mytrionThreads.tenantId, TENANT), inArray(mytrionThreads.id, threadIds)));
  ok(
    '25 threads exist, each with message_count = 1',
    threadRows.length === 25 && threadRows.every((t) => t.count === 1),
    `threads=${threadRows.length} bad=${threadRows.filter((t) => t.count !== 1).length}`,
  );
}

/**
 * Replay safety on `mytrion_tickets_idem_uk`.
 *
 * POSTGRES-SPECIFIC and the reason the code is select-then-insert rather than an upsert: the index is
 * PARTIAL (`WHERE idempotency_key IS NOT NULL`), and Postgres refuses a partial index as an ON CONFLICT
 * arbiter unless the statement restates the predicate — which Drizzle cannot express. Both halves are
 * exercised: the sequential replay takes the pre-flight select, the concurrent replay loses the race and
 * has to be rescued by the 23505 catch.
 */
async function checkIdempotency(): Promise<void> {
  const key = `idem-seq-${RUN}`;
  const first = await fileTicket(sales, {
    typeCode: 'C-7',
    subject: 'Idempotent file',
    body: 'first attempt',
    idempotencyKey: key,
  });
  const replay = await fileTicket(sales, {
    typeCode: 'C-7',
    subject: 'Idempotent file',
    body: 'second attempt (same key)',
    idempotencyKey: key,
  });
  ok(
    'same idempotency_key twice → same ticket id, created:false',
    first.created && !replay.created && replay.ticket.id === first.ticket.id,
    `first=${first.ticket.number} replay=${replay.ticket.number} created=${replay.created}`,
  );
  const seqRows = await db
    .select({ id: mytrionTickets.id })
    .from(mytrionTickets)
    .where(and(eq(mytrionTickets.tenantId, TENANT), eq(mytrionTickets.idempotencyKey, key)));
  ok('the replay wrote NO second row', seqRows.length === 1, `rows=${seqRows.length}`);
  const replayEvents = await commsTicketEventRepo.listByTicket(sales, first.ticket.id);
  ok(
    'the replay did not journal a second create',
    replayEvents.length === 1,
    `events=${replayEvents.map((e) => e.eventType).join(',')}`,
  );

  const raceKey = `idem-race-${RUN}`;
  const raced = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      fileTicket(sales, {
        typeCode: 'C-7',
        subject: 'Raced file',
        body: `race attempt ${i}`,
        idempotencyKey: raceKey,
      }),
    ),
  );
  const ids = new Set(raced.map((r) => r.ticket.id));
  const winners = raced.filter((r) => r.created).length;
  ok(
    'concurrent replays of one key → one row, one winner, same id for all callers',
    ids.size === 1 && winners === 1,
    `distinct ids=${ids.size} created:true=${winners}`,
  );
  const raceRows = await db
    .select({ id: mytrionTickets.id })
    .from(mytrionTickets)
    .where(and(eq(mytrionTickets.tenantId, TENANT), eq(mytrionTickets.idempotencyKey, raceKey)));
  ok('the raced key holds exactly one row', raceRows.length === 1, `rows=${raceRows.length}`);
}

/** The reader filter over real rows — asserted on the returned ID SETS, not on counts. */
async function checkRbacOverRows(created: CreatedTicket): Promise<void> {
  const carrierId = `RBAC-${RUN}`;
  const mine = await fileTicket(sales, {
    typeCode: 'C-7',
    subject: 'RBAC subject',
    body: 'rbac body',
    deal: dealOf({ carrierId }),
  });
  const idsFor = async (ctx: TenantContext): Promise<string[]> =>
    (await commsTicketRepo.list(ctx, { carrierId, limit: 100 })).map((r) => r.ticket.id);

  const salesIds = await idsFor(sales);
  ok(
    'the raiser sees their own ticket (participant arm)',
    salesIds.length === 1 && salesIds[0] === mine.ticket.id,
    `ids=${salesIds.join(',')}`,
  );
  const peerIds = await idsFor(otherSalesAgent);
  ok(
    'another Sales agent who is not a member sees NOTHING',
    peerIds.length === 0 && !peerIds.includes(mine.ticket.id),
    `ids=[${peerIds.join(',')}]`,
  );
  const csRows = await commsTicketRepo.list(cs, { carrierId, limit: 100 });
  ok(
    "a CS agent sees it via the department arm (target_department='customer-service')",
    csRows.length === 1 && csRows[0]!.ticket.id === mine.ticket.id,
    `ids=${csRows.map((r) => r.ticket.id).join(',')}`,
  );
  ok(
    'the LEFT JOIN yields readSeq null for a queue reader with no member row',
    csRows[0]?.readSeq === null,
    `readSeq=${String(csRows[0]?.readSeq)}`,
  );
  // Even a blanket-access caller in another tenant: the tenant equality is unconditional in the filter.
  const foreign = await idsFor(
    ctxOf({
      tenantId: OTHER_TENANT,
      userId: 'zoho:42',
      departments: ['customer-service'],
      allDepartmentAccess: true,
    }),
  );
  ok(
    'a different tenant sees nothing, even with allDepartmentAccess',
    foreign.length === 0,
    `ids=[${foreign.join(',')}]`,
  );
  // getForReader must agree with list, id by id.
  ok(
    'getForReader agrees with list for all three readers',
    (await commsTicketRepo.getForReader(sales, mine.ticket.id)) !== undefined &&
      (await commsTicketRepo.getForReader(cs, mine.ticket.id)) !== undefined &&
      (await commsTicketRepo.getForReader(otherSalesAgent, mine.ticket.id)) === undefined,
  );
  // The Part-2 ticket from checkCreateUnit is on the same queue, so it must also be CS-visible.
  ok(
    'the create-unit ticket is reachable by thread for the CS reader',
    (await commsTicketRepo.getByThreadForReader(cs, created.thread.id))?.ticket.id ===
      created.ticket.id,
  );
}

/** postReply: seq, lazy watcher, first-response stamped exactly once, journal. */
async function checkReplyFlow(created: CreatedTicket): Promise<void> {
  const threadId = created.thread.id;
  const reply = await postReply(cs, { threadId, body: 'Reactivation started, WEX ticket opened.' });
  ok('CS reply appends seq 2', reply.message.seq === 2, `seq=${reply.message.seq}`);

  const members = await commsThreadMemberRepo.listByThread(sales, threadId);
  const roles = Object.fromEntries(members.map((m) => [m.memberKey, m.role]));
  ok(
    'the replier joins as a watcher WITHOUT demoting the requester',
    members.length === 2 && roles['42'] === 'requester' && roles['77'] === 'watcher',
    members.map((m) => `${m.memberKey}:${m.role}`).join(' '),
  );

  const afterFirst = await commsTicketRepo.getForReader(sales, created.ticket.id);
  const stampedAt = afterFirst?.ticket.firstResponseAt ?? null;
  ok('first_response_at is stamped by the first non-requester reply', stampedAt !== null);

  await postReply(cs, { threadId, body: 'Second reply, minutes later.' });
  const afterSecond = await commsTicketRepo.getForReader(sales, created.ticket.id);
  ok(
    'a second reply does NOT move first_response_at (IS NULL guard in the WHERE)',
    stampedAt !== null &&
      afterSecond?.ticket.firstResponseAt?.getTime() === stampedAt.getTime(),
    `first=${stampedAt?.toISOString()} after=${afterSecond?.ticket.firstResponseAt?.toISOString()}`,
  );

  const events = await commsTicketEventRepo.listByTicket(sales, created.ticket.id);
  const types = events.map((e) => e.eventType);
  ok(
    "each reply writes a 'commented' journal row",
    types.filter((t) => t === 'commented').length === 2 && types[0] === 'created',
    types.join(','),
  );
}

/** An internal note is not an answer: kind='note', and no first-response stamp. */
async function checkInternalNote(): Promise<{ threadId: string; messageCount: number }> {
  const filed = await fileTicket(sales, {
    typeCode: 'Q-1',
    subject: 'Invoice for Pilot',
    body: 'Client asks for the March invoice.',
    deal: dealOf({ carrierId: `NOTE-${RUN}` }),
  });
  ok(
    "Q-1 routes to its own catalog queue ('billing'), not the C-7 one",
    filed.ticket.targetDepartment === 'billing',
    String(filed.ticket.targetDepartment),
  );
  const threadId = filed.thread.id;
  const billing = ctxOf({ userId: 'zoho:55', departments: ['billing'], userName: 'Nodir (Billing)' });

  // The requester's own reply is not a response to anybody.
  await postReply(sales, { threadId, body: 'Bumping this.' });
  let row = await commsTicketRepo.getForReader(sales, filed.ticket.id);
  ok(
    "the requester's own reply does not stamp first_response_at",
    row?.ticket.firstResponseAt === null,
    String(row?.ticket.firstResponseAt),
  );

  // Journal delta, not the whole trail: the requester's own visible reply above correctly wrote a
  // 'commented' row, so only what the NOTE itself appends distinguishes the two paths.
  const before = (await commsTicketEventRepo.listByTicket(sales, filed.ticket.id)).length;
  const note = await postReply(billing, {
    threadId,
    body: 'internal: check the prepaid balance before answering',
    isInternal: true,
  });
  row = await commsTicketRepo.getForReader(sales, filed.ticket.id);
  const events = await commsTicketEventRepo.listByTicket(sales, filed.ticket.id);
  ok(
    "an internal note writes kind='note' / is_internal and does NOT stamp first_response_at",
    note.message.kind === 'note' &&
      note.message.isInternal === true &&
      row?.ticket.firstResponseAt === null,
    `kind=${note.message.kind} internal=${note.message.isInternal} stamp=${String(row?.ticket.firstResponseAt)}`,
  );
  const delta = events.slice(before).map((e) => e.eventType);
  ok(
    "the note journals exactly one 'note_added' row and no 'commented'",
    delta.length === 1 && delta[0] === 'note_added',
    `trail=${events.map((e) => e.eventType).join(',')} delta=${delta.join(',')}`,
  );

  const visible = await postReply(billing, { threadId, body: 'Invoice sent to the client.' });
  row = await commsTicketRepo.getForReader(sales, filed.ticket.id);
  ok(
    'the next VISIBLE reply from the same agent does stamp it',
    row?.ticket.firstResponseAt !== null,
    String(row?.ticket.firstResponseAt),
  );
  return { threadId, messageCount: visible.message.seq };
}

/** markThreadRead: clamped to message_count, and monotonic (the repo's WHERE refuses a lower seq). */
async function checkReadWatermark(thread: { threadId: string; messageCount: number }): Promise<void> {
  const storedFor = async (key: string): Promise<number | undefined> => {
    const [row] = await db
      .select({ seq: mytrionThreadMembers.lastReadSeq })
      .from(mytrionThreadMembers)
      .where(
        and(
          eq(mytrionThreadMembers.tenantId, TENANT),
          eq(mytrionThreadMembers.threadId, thread.threadId),
          eq(mytrionThreadMembers.memberKey, key),
        ),
      );
    return row?.seq;
  };

  const clamped = await markThreadRead(sales, thread.threadId, 9_999);
  ok(
    'markThreadRead clamps a runaway client to message_count',
    clamped.seq === thread.messageCount && (await storedFor('42')) === thread.messageCount,
    `returned=${clamped.seq} stored=${String(await storedFor('42'))} count=${thread.messageCount}`,
  );
  const lower = await markThreadRead(sales, thread.threadId, 1);
  ok(
    'a LOWER seq is ignored — the stored watermark does not move backwards',
    lower.seq === 1 && (await storedFor('42')) === thread.messageCount,
    `returned=${lower.seq} stored=${String(await storedFor('42'))}`,
  );
}

/**
 * Keyset paging over `(created_at, id)`.
 *
 * POSTGRES-SPECIFIC: the cursor is a ROW COMPARISON against a `timestamptz` cast, which only a real
 * planner evaluates. Offset paging would pass a mock and then re-show or skip rows the moment another
 * ticket is filed, so the assertion is on the union of the pages' IDS, not on their sizes.
 */
async function checkKeysetPaging(): Promise<void> {
  const carrierId = `PAGE-${RUN}`;
  const createdIds: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const filed = await fileTicket(sales, {
      typeCode: 'C-7',
      subject: `Paged ${i}`,
      body: `paged body ${i}`,
      deal: dealOf({ carrierId }),
    });
    createdIds.push(filed.ticket.id);
  }

  // The options object is built without the key when there is no cursor: under
  // exactOptionalPropertyTypes, `{ cursor: undefined }` is not the same type as an absent `cursor`.
  const page = async (cursor?: string): Promise<TicketWithThread[]> =>
    commsTicketRepo.list(
      sales,
      cursor === undefined ? { carrierId, limit: 2 } : { carrierId, limit: 2, cursor },
    );

  const pages: { id: string; at: number }[][] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 4; i += 1) {
    const rows = await page(cursor);
    if (rows.length === 0) break;
    pages.push(rows.map((r) => ({ id: r.ticket.id, at: r.ticket.createdAt.getTime() })));
    const last = rows[rows.length - 1]!;
    cursor = encodeTicketCursor({ createdAt: last.ticket.createdAt, id: last.ticket.id });
  }
  const walked = pages.flat();
  const ids = walked.map((r) => r.id);
  ok(
    'paging walks every row exactly once — no repeat, no skip',
    ids.length === 5 && new Set(ids).size === 5 && createdIds.every((id) => ids.includes(id)),
    `pages=[${pages.map((p) => p.length).join(',')}] distinct=${new Set(ids).size}`,
  );
  ok(
    'the walk is newest-first across the cursor boundary (no reordering between pages)',
    walked.every((row, i) => i === 0 || walked[i - 1]!.at >= row.at),
    `createdAt sequence=${walked.map((r) => r.at).join('>')}`,
  );
  const exhausted = await page(cursor);
  ok('the cursor past the last row returns an empty page', exhausted.length === 0);
}

/** The two serialization leaks, checked against a row that really carries a full card number. */
async function checkDtoBoundary(created: CreatedTicket): Promise<void> {
  const [stored] = await db
    .select({ card: mytrionTickets.cardNumber, last4: mytrionTickets.cardLast4 })
    .from(mytrionTickets)
    .where(eq(mytrionTickets.id, created.ticket.id));
  ok(
    'the full card number IS stored (so the DTO check below is meaningful)',
    stored?.card === CARD_FULL && stored?.last4 === '1234',
    `last4=${String(stored?.last4)}`,
  );

  const row = await commsTicketRepo.getForReader(sales, created.ticket.id);
  const workerDto = JSON.stringify(toTicketDto(row!, readerOf(sales)));
  const customerDto = toTicketDto(row!, readerOf(ctxOf({ audience: 'customer' })));
  ok(
    'no DTO serializes the full card number; cardLast4 survives',
    !workerDto.includes(CARD_FULL) &&
      !JSON.stringify(customerDto).includes(CARD_FULL) &&
      workerDto.includes('"cardLast4":"1234"'),
  );
  ok(
    'last_message_preview is omitted for a customer-audience reader and present for a worker',
    !('lastMessagePreview' in customerDto) && workerDto.includes('lastMessagePreview'),
    Object.keys(customerDto).filter((k) => k === 'lastMessagePreview').join(',') || 'omitted',
  );
}

/** Run the native ticket path checks in dependency order, reporting through the caller's reporter. */
export async function runNativeTicketChecks(reporter: Ok): Promise<void> {
  ok = reporter;
  const created = await checkCreateUnit();
  await checkConcurrentCreates();
  await checkIdempotency();
  await checkRbacOverRows(created);
  await checkReplyFlow(created);
  const noteThread = await checkInternalNote();
  await checkReadWatermark(noteThread);
  await checkKeysetPaging();
  await checkDtoBoundary(created);
}
