/**
 * Mytrion Inbox Messages client (/v1/inbox/messages) — our own copy of the Zoho CRM inbox,
 * replacing the Zoho-backed `inbox.list` touchpoint + the servercrm `crm_inbox_notification`
 * live path. Identity is server-injected from the session; admins View-as an agent via `owner_id`.
 */
import { request } from './transport';

/** One inbox message — mirrors the legacy `inbox.list` item so `loadInbox`'s mapping is unchanged. */
export interface InboxMessage {
  id: string;
  name: string | null;
  subject: string;
  content: string | null;
  type: string;
  priority: string;
  tag: string | null;
  sourceUrl: string | null;
  createdTime: string;
  ownerId: string;
  ownerName: string | null;
  ownerEmail: string | null;
  readAt: string | null;
}

export type InboxFilter = 'all' | 'unread' | 'task' | 'alert' | 'reminder';
export interface InboxCounts {
  all: number;
  unread: number;
  task: number;
  alert: number;
  reminder: number;
}
export interface InboxMessagePage {
  messages: InboxMessage[];
  counts: InboxCounts;
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
    cursor: string | null;
    nextCursor: string | null;
  };
}

/** The caller's inbox (owner-scoped server-side). `actAsId` = an admin View-as target's Zoho id. */
export async function listInboxMessages(input: {
  actAsId?: string;
  limit?: number;
  offset?: number;
  cursor?: string;
  query?: string;
  filter?: InboxFilter;
  tag?: string;
  signal?: AbortSignal;
} = {}): Promise<InboxMessagePage> {
  const res = (await request('GET', '/inbox/messages', {
    query: {
      ...(input.actAsId ? { owner_id: input.actAsId } : {}),
      limit: input.limit ?? 25,
      offset: input.offset ?? 0,
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(input.query?.trim() ? { q: input.query.trim() } : {}),
      filter: input.filter ?? 'all',
      ...(input.tag ? { tag: input.tag } : {}),
    },
    ...(input.signal ? { signal: input.signal } : {}),
  })) as Partial<InboxMessagePage>;
  const messages = res.messages ?? [];
  return {
    messages,
    counts: res.counts ?? { all: messages.length, unread: 0, task: 0, alert: 0, reminder: 0 },
    pagination: res.pagination ?? {
      limit: input.limit ?? 25,
      offset: input.offset ?? 0,
      total: messages.length,
      hasMore: false,
      cursor: input.cursor ?? null,
      nextCursor: null,
    },
  };
}

export async function getInboxCounts(actAsId?: string): Promise<InboxCounts> {
  const res = (await request('GET', '/inbox/messages/counts', {
    query: actAsId ? { owner_id: actAsId } : {},
  })) as { counts: InboxCounts };
  return res.counts;
}

export async function setInboxMessageRead(id: string, read: boolean, actAsId?: string): Promise<void> {
  await request('POST', `/inbox/messages/${encodeURIComponent(id)}/read`, {
    query: actAsId ? { owner_id: actAsId } : {},
    body: { read },
  });
}

export async function markAllInboxRead(actAsId?: string): Promise<void> {
  await request('POST', '/inbox/messages/read-all', {
    query: actAsId ? { owner_id: actAsId } : {},
    body: {},
  });
}

/** Delete one of the caller's inbox messages. */
export async function deleteInboxMessage(id: string, actAsId?: string): Promise<void> {
  await request('POST', `/inbox/messages/${encodeURIComponent(id)}/delete`, {
    query: actAsId ? { owner_id: actAsId } : {},
    body: {},
  });
}
