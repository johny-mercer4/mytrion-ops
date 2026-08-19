/**
 * @mention notify — the security property, offline.
 *
 * A watcher can read the whole conversation, so a mention MUST NOT be a way to ping (and thereby surface
 * the thread to) someone who is not already on it. `postReply` therefore validates the client's `mentions`
 * array against the thread's worker members before emitting any `comms.thread.mention` user event. These
 * tests pin exactly that: a mentioned member is notified; a mentioned NON-member is silently dropped; and
 * the author never mentions themselves.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TenantContext } from '../../src/types/tenantContext.js';

const threadRepo = vi.hoisted(() => ({
  getForReader: vi.fn(),
}));
const messageRepo = vi.hoisted(() => ({ append: vi.fn() }));
const memberRepo = vi.hoisted(() => ({
  ensureWatcher: vi.fn(async () => undefined),
  markRead: vi.fn(async () => undefined),
  listByThread: vi.fn(),
}));
const ticketRepo = vi.hoisted(() => ({ getByThreadForReader: vi.fn(async () => undefined) }));
const ticketState = vi.hoisted(() => ({ stampFirstResponse: vi.fn(async () => undefined) }));
const ticketEvents = vi.hoisted(() => ({ append: vi.fn(async () => undefined) }));
const publish = vi.hoisted(() => ({
  publishSafely: vi.fn((_label: string, fn: () => void) => fn()),
  publishThreadEvent: vi.fn(() => ({ thread: 0, lanes: 0 })),
  publishUserEvent: vi.fn((_zohoUserId: string, _payload: Record<string, unknown>) => 0),
}));

vi.mock('../../src/repos/commsThreadRepo.js', () => ({
  actorZohoUserIdOf: (ctx: { userId?: string }) =>
    ctx.userId?.startsWith('zoho:') ? ctx.userId.slice('zoho:'.length) : null,
  commsThreadRepo: threadRepo,
}));
vi.mock('../../src/repos/commsMessageRepo.js', () => ({ commsMessageRepo: messageRepo }));
vi.mock('../../src/repos/commsThreadMemberRepo.js', () => ({ commsThreadMemberRepo: memberRepo }));
vi.mock('../../src/repos/commsTicketRepo.js', () => ({ commsTicketRepo: ticketRepo }));
vi.mock('../../src/repos/commsTicketStateRepo.js', () => ({ commsTicketStateRepo: ticketState }));
vi.mock('../../src/repos/commsTicketEventRepo.js', () => ({ commsTicketEventRepo: ticketEvents }));
vi.mock('../../src/modules/comms/publish.js', () => publish);

import { postReply } from '../../src/modules/comms/messageService.js';

const ctx = { tenantId: 'octane', userId: 'zoho:42', userName: 'Ali' } as unknown as TenantContext;

beforeEach(() => {
  vi.clearAllMocks();
  threadRepo.getForReader.mockResolvedValue({ id: 'mth_1', department: 'customer-service', state: 'open' });
  messageRepo.append.mockResolvedValue({ id: 'mtm_2', seq: 2, isInternal: false, createdAt: new Date() });
  // Ali (author, 42), Dilnoza (77, active), Kamola (88, LEFT). The requester carrier row is a non-worker.
  memberRepo.listByThread.mockResolvedValue([
    { memberKind: 'worker', memberKey: '42', state: 'active' },
    { memberKind: 'worker', memberKey: '77', state: 'active' },
    { memberKind: 'worker', memberKey: '88', state: 'left' },
    { memberKind: 'carrier', memberKey: 'cu_1', state: 'active' },
  ]);
});

const mentionEvents = () =>
  publish.publishUserEvent.mock.calls.filter(
    (c) => (c[1] as { type?: string }).type === 'comms.thread.mention',
  );

describe('postReply @mention notify', () => {
  it('notifies a mentioned worker who is a member of the thread', async () => {
    await postReply(ctx, { threadId: 'mth_1', body: 'looping in @Dilnoza', mentions: ['77'] });
    const events = mentionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.[0]).toBe('77');
    expect(events[0]?.[1]).toMatchObject({ threadId: 'mth_1', byZohoUserId: '42' });
  });

  it('DROPS a mention of someone who is not on the thread — no IDOR via the mentions array', async () => {
    // 999 is not a member; mentioning them must not ping (and thus reveal) the thread to them.
    await postReply(ctx, { threadId: 'mth_1', body: 'hi @stranger', mentions: ['999'] });
    expect(mentionEvents()).toHaveLength(0);
  });

  it('drops a mention of a member who has LEFT the thread', async () => {
    await postReply(ctx, { threadId: 'mth_1', body: 'bye @Kamola', mentions: ['88'] });
    expect(mentionEvents()).toHaveLength(0);
  });

  it('never notifies the author for mentioning themselves', async () => {
    await postReply(ctx, { threadId: 'mth_1', body: 'note to self @Ali', mentions: ['42'] });
    expect(mentionEvents()).toHaveLength(0);
  });
});
