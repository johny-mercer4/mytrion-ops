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
}

/** The caller's inbox (owner-scoped server-side). `actAsId` = an admin View-as target's Zoho id. */
export async function listInboxMessages(actAsId?: string): Promise<{ messages: InboxMessage[] }> {
  const res = (await request('GET', '/inbox/messages', {
    query: actAsId ? { owner_id: actAsId, limit: 200 } : { limit: 200 },
  })) as { messages?: InboxMessage[] };
  return { messages: res.messages ?? [] };
}

/** Delete one of the caller's inbox messages. */
export async function deleteInboxMessage(id: string): Promise<void> {
  await request('POST', `/inbox/messages/${encodeURIComponent(id)}/delete`);
}
