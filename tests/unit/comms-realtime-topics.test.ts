/**
 * Comms realtime topics. Coverage: the topic grammar, the subscribe matrix (including the two places
 * an admin must NOT be able to reach), that thread topics are denied synchronously and authorized
 * through the same reader filter as REST, and that a plain message never touches the admin firehose.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMMS_QUEUE_PREFIX,
  COMMS_THREAD_PREFIX,
  COMMS_USER_PREFIX,
  INBOX_ALL_TOPIC,
  canSubscribe,
  canSubscribeCommsThread,
  commsQueueTopic,
  commsThreadTopic,
  commsUserTopic,
  commsUserTopicOf,
  isValidTopic,
  realtimeHub,
  registerCommsThreadAuthorizer,
  type RealtimeSocket,
} from '../../src/modules/realtime/hub.js';
import { publishThreadEvent } from '../../src/modules/comms/publish.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

function ctxOf(over: Partial<TenantContext> = {}): TenantContext {
  return {
    tenantId: 'octane',
    userId: 'zoho:42',
    audience: 'internal',
    role: 'worker',
    scopes: [],
    departments: ['sales'],
    allDepartmentAccess: false,
    requestId: 'r',
    ...over,
  } as TenantContext;
}

function fakeSocket(): RealtimeSocket & { frames: string[] } {
  const frames: string[] = [];
  return { frames, readyState: 1, send: (d: string) => frames.push(d) };
}

afterEach(() => {
  // The authorizer is module-level state; leaving one registered would leak between suites.
  registerCommsThreadAuthorizer(async () => false);
});

describe('comms topic grammar', () => {
  it('accepts the three families', () => {
    expect(isValidTopic(commsThreadTopic('mth_abc123'))).toBe(true);
    expect(isValidTopic(commsQueueTopic('customer-service'))).toBe(true);
    expect(isValidTopic(commsUserTopic('42'))).toBe(true);
  });

  it('rejects shapes that would break prefix reasoning or inject', () => {
    // A ':' inside the id would make comms:thread:a:b parse — the older inbox grammar allows this and
    // comms deliberately does not.
    expect(isValidTopic('comms:thread:a:b')).toBe(false);
    expect(isValidTopic('comms:thread:../..')).toBe(false);
    expect(isValidTopic('comms:thread:')).toBe(false);
    expect(isValidTopic('comms:queue:Customer-Service')).toBe(false); // slugs are lowercase
    expect(isValidTopic('comms:queue:')).toBe(false);
    expect(isValidTopic(`comms:user:${'x'.repeat(121)}`)).toBe(false);
    expect(isValidTopic('comms:whatever:1')).toBe(false);
  });

  it('leaves the legacy inbox grammar untouched', () => {
    expect(isValidTopic('inbox:worker:42')).toBe(true);
    expect(isValidTopic(INBOX_ALL_TOPIC)).toBe(true);
  });
});

describe('comms:user — own lane only', () => {
  it('derives from the verified session', () => {
    expect(commsUserTopicOf(ctxOf())).toBe('comms:user:42');
    expect(canSubscribe(ctxOf(), 'comms:user:42')).toBe(true);
  });

  it("a worker cannot subscribe to someone else's lane", () => {
    expect(canSubscribe(ctxOf(), 'comms:user:77')).toBe(false);
  });

  it('AN ADMIN CANNOT EITHER — the comms branch is evaluated before the admin blanket-true', () => {
    // If the admin check were hoisted above the comms branches, this would silently become a live
    // tail of another person's conversations, direct messages included.
    const admin = ctxOf({ role: 'admin', allDepartmentAccess: true });
    expect(canSubscribe(admin, 'comms:user:77')).toBe(false);
    expect(canSubscribe(admin, 'comms:user:42')).toBe(true); // their own is fine
  });

  it('view-as gets NO comms lane at all', () => {
    const actingAs = ctxOf({ userId: 'zoho:77', impersonatorUserId: 'zoho:1' });
    expect(commsUserTopicOf(actingAs)).toBeNull();
    expect(canSubscribe(actingAs, 'comms:user:77')).toBe(false);
  });

  it('customer and system identities have no lane', () => {
    expect(commsUserTopicOf(ctxOf({ audience: 'customer', userId: 'client:cu_9' }))).toBeNull();
    expect(commsUserTopicOf(ctxOf({ userId: 'system' }))).toBeNull();
    expect(commsUserTopicOf(ctxOf({ userId: 'zoho:' }))).toBeNull();
  });
});

describe('comms:queue — department scoped', () => {
  it('a member of the department may subscribe', () => {
    expect(
      canSubscribe(ctxOf({ departments: ['customer-service'] }), 'comms:queue:customer-service'),
    ).toBe(true);
  });

  it('a non-member may not', () => {
    expect(canSubscribe(ctxOf({ departments: ['sales'] }), 'comms:queue:customer-service')).toBe(
      false,
    );
  });

  it('blanket access may — a queue is an operational surface, unlike a personal lane', () => {
    expect(canSubscribe(ctxOf({ allDepartmentAccess: true }), 'comms:queue:billing')).toBe(true);
    expect(canSubscribe(ctxOf({ role: 'admin' }), 'comms:queue:billing')).toBe(true);
  });

  it('a customer never reaches an internal queue', () => {
    const customer = ctxOf({
      audience: 'customer',
      userId: 'client:cu_9',
      role: 'viewer',
      departments: [],
    });
    expect(canSubscribe(customer, 'comms:queue:customer-service')).toBe(false);
  });
});

describe('comms:thread — denied synchronously, authorized by row', () => {
  it('canSubscribe always refuses a thread topic, even for an admin', () => {
    expect(canSubscribe(ctxOf(), commsThreadTopic('mth_1'))).toBe(false);
    expect(
      canSubscribe(ctxOf({ role: 'admin', allDepartmentAccess: true }), commsThreadTopic('mth_1')),
    ).toBe(false);
  });

  it('FAILS CLOSED when no authorizer is registered', async () => {
    registerCommsThreadAuthorizer(async () => false);
    expect(await canSubscribeCommsThread(ctxOf(), commsThreadTopic('mth_1'))).toBe(false);
  });

  it('delegates to the registered authorizer with the bare thread id', async () => {
    const spy = vi.fn(async () => true);
    registerCommsThreadAuthorizer(spy);
    expect(await canSubscribeCommsThread(ctxOf(), commsThreadTopic('mth_abc'))).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ userId: 'zoho:42' }), 'mth_abc');
  });

  it('refuses a malformed topic without consulting the authorizer (no wasted DB read)', async () => {
    const spy = vi.fn(async () => true);
    registerCommsThreadAuthorizer(spy);
    expect(await canSubscribeCommsThread(ctxOf(), 'comms:thread:a:b')).toBe(false);
    expect(await canSubscribeCommsThread(ctxOf(), 'comms:queue:sales')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('comms fan-out', () => {
  const thread = { id: 'mth_1', department: 'customer-service' };
  const members = [
    {
      memberKind: 'worker' as const,
      memberKey: '42',
      state: 'active' as const,
      notify: 'all' as const,
    },
    {
      memberKind: 'worker' as const,
      memberKey: '77',
      state: 'active' as const,
      notify: 'all' as const,
    },
  ];

  it("reaches the open thread AND the other participant's lane", () => {
    const open = fakeSocket();
    const otherLane = fakeSocket();
    realtimeHub.subscribe(open, commsThreadTopic('mth_1'));
    realtimeHub.subscribe(otherLane, commsUserTopic('77'));

    const res = publishThreadEvent(
      thread,
      members,
      { type: 'comms.thread.message', threadId: 'mth_1', seq: 3 },
      { excludeMemberKey: '42' },
    );

    expect(res).toEqual({ thread: 1, lanes: 1 });
    expect(JSON.parse(open.frames[0]!)).toMatchObject({
      kind: 'comms',
      type: 'comms.thread.message',
      seq: 3,
    });
    // The lane frame is what makes a badge correct for someone who does NOT have the thread open.
    expect(JSON.parse(otherLane.frames[0]!)).toMatchObject({ type: 'comms.thread.message' });

    realtimeHub.dropSocket(open);
    realtimeHub.dropSocket(otherLane);
  });

  it('skips the author, members who left, and notify=none', () => {
    const authorLane = fakeSocket();
    const leftLane = fakeSocket();
    const mutedLane = fakeSocket();
    realtimeHub.subscribe(authorLane, commsUserTopic('42'));
    realtimeHub.subscribe(leftLane, commsUserTopic('88'));
    realtimeHub.subscribe(mutedLane, commsUserTopic('99'));

    const res = publishThreadEvent(
      thread,
      [
        ...members.slice(0, 1),
        { memberKind: 'worker', memberKey: '88', state: 'left', notify: 'all' },
        { memberKind: 'worker', memberKey: '99', state: 'active', notify: 'none' },
      ],
      { type: 'comms.thread.message', threadId: 'mth_1' },
      { excludeMemberKey: '42' },
    );

    expect(res.lanes).toBe(0);
    expect(authorLane.frames).toHaveLength(0);
    expect(leftLane.frames).toHaveLength(0);
    expect(mutedLane.frames).toHaveLength(0);

    [authorLane, leftLane, mutedLane].forEach((s) => realtimeHub.dropSocket(s));
  });

  it('a carrier member gets no comms lane (they are reached over the mini-app topic)', () => {
    const lane = fakeSocket();
    realtimeHub.subscribe(lane, commsUserTopic('5832379'));
    const res = publishThreadEvent(
      thread,
      [{ memberKind: 'carrier', memberKey: '5832379', state: 'active', notify: 'all' }],
      { type: 'comms.thread.message', threadId: 'mth_1' },
    );
    expect(res.lanes).toBe(0);
    expect(lane.frames).toHaveLength(0);
    realtimeHub.dropSocket(lane);
  });

  it('A PLAIN MESSAGE NEVER TOUCHES THE ADMIN FIREHOSE', () => {
    // The regression guard for the inbox:all problem: publishInboxEvent double-publishes there, so
    // routing conversation through it would put every message in the company on one topic.
    const firehose = fakeSocket();
    realtimeHub.subscribe(firehose, INBOX_ALL_TOPIC);
    publishThreadEvent(thread, members, { type: 'comms.thread.message', threadId: 'mth_1' });
    expect(firehose.frames).toHaveLength(0);
    realtimeHub.dropSocket(firehose);
  });

  it('attachment events fan out identically — both drive the live widget', () => {
    const open = fakeSocket();
    realtimeHub.subscribe(open, commsThreadTopic('mth_1'));
    publishThreadEvent(thread, [], {
      type: 'comms.thread.attachment',
      threadId: 'mth_1',
      seq: 4,
      name: 'invoice.pdf',
    });
    expect(JSON.parse(open.frames[0]!)).toMatchObject({
      type: 'comms.thread.attachment',
      name: 'invoice.pdf',
    });
    realtimeHub.dropSocket(open);
  });
});

describe('prefix constants stay in step with the grammar', () => {
  it('the builders produce topics the validator accepts', () => {
    expect(commsThreadTopic('x').startsWith(COMMS_THREAD_PREFIX)).toBe(true);
    expect(commsQueueTopic('sales').startsWith(COMMS_QUEUE_PREFIX)).toBe(true);
    expect(commsUserTopic('1').startsWith(COMMS_USER_PREFIX)).toBe(true);
  });
});

/**
 * The `realtime.routes.ts` subscribe path — the half that is reachable without a live server.
 *
 * WHAT IS NOT COVERED HERE, AND WHY: the route's per-socket topic SET (which replaced a per-frame
 * counter so a reconnect-and-resubscribe stops burning budget against the 25-topic cap), the
 * re-check after the await, the `readyState !== 1` guard, and the `hello.commsTopic` field all live
 * inside the WebSocket handler closure — `MAX_TOPICS_PER_SOCKET` is module-private and the Set is a
 * local. Reaching them needs a real listener and a real `ws` client, i.e. the pattern in
 * tests/unit/realtime-inbox.test.ts, not this suite. They are NOT faked here. The three things this
 * block asserts are the invariants the route's logic RESTS on, each independently checkable.
 */
describe('realtime.routes subscribe branch — the offline-testable invariants', () => {
  it('the ASYNC GATE IS TAKEN FOR EXACTLY the thread family', () => {
    // The route branches on `topic.startsWith(COMMS_THREAD_PREFIX)`. If any other family matched that
    // prefix, it would skip `canSubscribe` — including the own-only comms lane, whose deny-an-admin
    // ordering is the whole point of that function.
    expect(commsThreadTopic('mth_1').startsWith(COMMS_THREAD_PREFIX)).toBe(true);
    for (const other of [
      commsQueueTopic('customer-service'),
      commsUserTopic('77'),
      INBOX_ALL_TOPIC,
      'inbox:worker:42',
    ]) {
      expect(other.startsWith(COMMS_THREAD_PREFIX), `${other} would skip canSubscribe`).toBe(false);
    }
  });

  it('the two gates are complementary — neither can authorize the other family', async () => {
    const admin = ctxOf({ role: 'admin', allDepartmentAccess: true });
    registerCommsThreadAuthorizer(async () => true);
    // The sync gate can never pass a thread topic (that is what made the chat feed unreachable before
    // the async branch existed)…
    expect(canSubscribe(admin, commsThreadTopic('mth_1'))).toBe(false);
    // …and the async gate refuses everything that is not a thread topic, even with a permissive
    // authorizer registered, so routing a lane through it could not open someone else's feed.
    expect(await canSubscribeCommsThread(admin, commsUserTopic('77'))).toBe(false);
    expect(await canSubscribeCommsThread(admin, commsQueueTopic('billing'))).toBe(false);
    expect(await canSubscribeCommsThread(admin, INBOX_ALL_TOPIC)).toBe(false);
  });

  it('a repeated hub subscribe is idempotent — one frame, not two', () => {
    // The route answers an already-held topic with a bare ack and no budget spend; that is only safe
    // because the hub itself de-duplicates, so a double subscribe cannot double-deliver.
    const socket = fakeSocket();
    const topic = commsUserTopic('42');
    realtimeHub.subscribe(socket, topic);
    realtimeHub.subscribe(socket, topic);
    publishThreadEvent(
      { id: 'mth_9', department: 'customer-service' },
      [{ memberKind: 'worker', memberKey: '42', state: 'active', notify: 'all' }],
      { type: 'comms.thread.message', threadId: 'mth_9' },
    );
    expect(socket.frames).toHaveLength(1);
    realtimeHub.dropSocket(socket);
  });

  it('the comms lane the route auto-subscribes is null for exactly the identities with no lane', () => {
    // `hello.commsTopic` is whatever this returns, so a client never has to reimplement the rule —
    // notably the view-as case, where a lane would tail the impersonated person's conversations.
    expect(commsUserTopicOf(ctxOf())).toBe('comms:user:42');
    expect(commsUserTopicOf(ctxOf({ userId: 'zoho:77', impersonatorUserId: 'zoho:1' }))).toBeNull();
    expect(commsUserTopicOf(ctxOf({ userId: 'system' }))).toBeNull();
    expect(commsUserTopicOf(ctxOf({ audience: 'customer', userId: 'client:cu_9' }))).toBeNull();
  });

  it('dropSocket clears both auto-subscribed lanes, so a reconnect starts clean', () => {
    const socket = fakeSocket();
    realtimeHub.subscribe(socket, 'inbox:worker:42');
    realtimeHub.subscribe(socket, commsUserTopic('42'));
    realtimeHub.dropSocket(socket);
    publishThreadEvent(
      { id: 'mth_9', department: 'customer-service' },
      [{ memberKind: 'worker', memberKey: '42', state: 'active', notify: 'all' }],
      { type: 'comms.thread.message', threadId: 'mth_9' },
    );
    expect(socket.frames).toHaveLength(0);
  });
});
